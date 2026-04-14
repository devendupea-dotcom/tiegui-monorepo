import "server-only";

import { Buffer } from "node:buffer";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { PNG } from "pngjs";
import type { InvoiceTerms } from "@prisma/client";
import { AppApiError } from "@/lib/app-api-permissions";
import { prisma } from "@/lib/prisma";
import {
  buildInvoiceWorkerLeadAccessWhere,
  DEFAULT_INVOICE_TERMS,
  normalizeInvoiceTerms,
} from "@/lib/invoices";
import { type InvoicePdfImageSource } from "@/lib/invoice-pdf";
import { getPhotoStorageRecord } from "@/lib/photo-storage";
import { isR2Configured, requireR2 } from "@/lib/r2";

async function readObjectBodyToBuffer(body: unknown): Promise<Buffer | null> {
  if (!body) {
    return null;
  }

  if (Buffer.isBuffer(body)) {
    return body;
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  if (typeof body === "object" && body && "transformToByteArray" in body && typeof body.transformToByteArray === "function") {
    const bytes = await body.transformToByteArray();
    return Buffer.from(bytes);
  }

  if (typeof body === "object" && body && Symbol.asyncIterator in body) {
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array | Buffer | string>) {
      if (typeof chunk === "string") {
        chunks.push(Buffer.from(chunk));
      } else if (Buffer.isBuffer(chunk)) {
        chunks.push(chunk);
      } else {
        chunks.push(Buffer.from(chunk));
      }
    }
    return chunks.length > 0 ? Buffer.concat(chunks) : null;
  }

  return null;
}

function decodeInlineInvoicePdfLogo(input: string): Buffer | null {
  const trimmed = input.trim();
  const match = trimmed.match(/^data:image\/[a-z0-9.+-]+;base64,([\s\S]+)$/i);
  if (!match) {
    return null;
  }

  try {
    const base64 = (match[1] || "").replace(/\s+/g, "");
    const data = Buffer.from(base64, "base64");
    return data.length > 0 ? data : null;
  } catch {
    return null;
  }
}

async function normalizeInvoicePdfLogo(input: {
  data: Buffer;
  invoiceId: string;
  orgId: string;
  logoPhotoId: string;
  source: "inline" | "object-storage";
}): Promise<InvoicePdfImageSource | null> {
  try {
    const data = Buffer.from(input.data);

    if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
      const normalized = Buffer.from(PNG.sync.write(PNG.sync.read(data, { checkCRC: false })));
      return normalized.length > 0 ? { data: normalized, format: "png" } : null;
    }

    if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
      return { data, format: "jpg" };
    }

    if (
      data.length >= 12 &&
      data.subarray(0, 4).toString("ascii") === "RIFF" &&
      data.subarray(8, 12).toString("ascii") === "WEBP"
    ) {
      console.warn("Invoice PDF skipped org logo because WEBP is not supported by the PDF renderer.", {
        invoiceId: input.invoiceId,
        orgId: input.orgId,
        logoPhotoId: input.logoPhotoId,
        source: input.source,
      });
      return null;
    }

    console.warn("Invoice PDF skipped org logo because the image format is unsupported for PDF rendering.", {
      invoiceId: input.invoiceId,
      orgId: input.orgId,
      logoPhotoId: input.logoPhotoId,
      source: input.source,
    });
    return null;
  } catch (error) {
    console.warn("Invoice PDF skipped org logo because normalization failed.", {
      invoiceId: input.invoiceId,
      orgId: input.orgId,
      logoPhotoId: input.logoPhotoId,
      source: input.source,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

let invoiceTermsColumnPromise: Promise<boolean> | null = null;

async function hasInvoiceTermsColumn(): Promise<boolean> {
  if (!invoiceTermsColumnPromise) {
    invoiceTermsColumnPromise = prisma
      .$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'Invoice'
            AND column_name = 'terms'
        ) AS "exists"
      `
      .then((rows) => rows[0]?.exists === true)
      .catch(() => false);
  }

  return invoiceTermsColumnPromise;
}

export async function resolveInvoiceTerms(invoiceId: string): Promise<InvoiceTerms> {
  if (!(await hasInvoiceTermsColumn())) {
    return DEFAULT_INVOICE_TERMS;
  }

  const rows = await prisma.$queryRaw<Array<{ terms: string | null }>>`
    SELECT "terms"::text AS "terms"
    FROM "Invoice"
    WHERE "id" = ${invoiceId}
    LIMIT 1
  `;

  return normalizeInvoiceTerms(rows[0]?.terms);
}

export async function assertWorkerCanViewInvoice(input: {
  actorId: string;
  orgId: string;
  invoiceId: string;
  leadId: string | null;
}) {
  if (!input.leadId) {
    throw new AppApiError("Workers can only access invoices linked to assigned jobs.", 403);
  }

  const allowed = await prisma.lead.findFirst({
    where: {
      id: input.leadId,
      orgId: input.orgId,
      ...buildInvoiceWorkerLeadAccessWhere({
        actorId: input.actorId,
        invoiceId: input.invoiceId,
      }),
    },
    select: { id: true },
  });

  if (!allowed) {
    throw new AppApiError("Workers can only access invoices for assigned jobs.", 403);
  }
}

export async function resolveInvoicePdfLogo(input: {
  invoiceId: string;
  orgId: string;
  logoPhotoId?: string | null;
}): Promise<InvoicePdfImageSource | null> {
  if (!input.logoPhotoId) {
    return null;
  }

  try {
    const photo = await getPhotoStorageRecord({
      photoId: input.logoPhotoId,
      orgId: input.orgId,
    });

    if (photo?.imageDataUrl) {
      const decodedLogo = decodeInlineInvoicePdfLogo(photo.imageDataUrl);
      if (!decodedLogo) {
        return null;
      }

      return normalizeInvoicePdfLogo({
        data: decodedLogo,
        invoiceId: input.invoiceId,
        orgId: input.orgId,
        logoPhotoId: input.logoPhotoId,
        source: "inline",
      });
    }

    if (photo && isR2Configured()) {
      const { r2, bucket } = requireR2();
      const object = await r2.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: photo.key,
        }),
      );
      const objectBytes = await readObjectBodyToBuffer(object.Body);
      if (!objectBytes) {
        return null;
      }

      return normalizeInvoicePdfLogo({
        data: objectBytes,
        invoiceId: input.invoiceId,
        orgId: input.orgId,
        logoPhotoId: input.logoPhotoId,
        source: "object-storage",
      });
    }
  } catch (error) {
    console.error("Invoice PDF failed to prepare org logo. Continuing without logo.", {
      invoiceId: input.invoiceId,
      orgId: input.orgId,
      logoPhotoId: input.logoPhotoId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return null;
}
