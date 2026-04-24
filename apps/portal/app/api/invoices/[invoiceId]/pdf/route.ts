import { NextResponse } from "next/server";
import { Buffer } from "node:buffer";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { PNG } from "pngjs";
import type { InvoiceTerms } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertOrgReadAccess,
  canManageAnyOrgJobs,
  requireAppApiActor,
} from "@/lib/app-api-permissions";
import {
  buildInvoiceWorkerLeadAccessWhere,
  DEFAULT_INVOICE_TERMS,
  formatInvoiceNumber,
  getInvoiceActionContext,
  getInvoiceReadJobContext,
  normalizeInvoiceTerms,
} from "@/lib/invoices";
import { normalizeInvoiceTemplate } from "@/lib/invoice-template";
import { buildInvoicePdfV2, type InvoicePdfImageSource } from "@/lib/invoice-pdf";
import { getPhotoStorageRecord } from "@/lib/photo-storage";
import { isR2Configured, requireR2 } from "@/lib/r2";
import { capturePortalError, trackPortalEvent } from "@/lib/telemetry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    invoiceId: string;
  }>;
};

function decodeInlineInvoicePdfLogo(input: string): Buffer | null {
  const trimmed = input.trim();
  const match = trimmed.match(/^data:image\/[a-z0-9.+-]+;base64,([\s\S]+)$/i);
  if (!match) {
    return null;
  }

  try {
    const base64 = (match[1] || "").replace(/\s+/g, "");
    const data = Buffer.from(base64, "base64");
    if (data.length === 0) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

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
      if (normalized.length === 0) {
        console.warn("Invoice PDF skipped org logo because PNG normalization returned no bytes.", {
          invoiceId: input.invoiceId,
          orgId: input.orgId,
          logoPhotoId: input.logoPhotoId,
          source: input.source,
        });
        return null;
      }

      return { data: normalized, format: "png" };
    }

    if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
      return { data, format: "jpg" };
    }

    if (
      data.length >= 12
      && data.subarray(0, 4).toString("ascii") === "RIFF"
      && data.subarray(8, 12).toString("ascii") === "WEBP"
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

async function hasInvoiceTermsColumn(): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'Invoice'
        AND column_name = 'terms'
    ) AS "exists"
  `;

  return rows[0]?.exists === true;
}

async function resolveInvoiceTerms(invoiceId: string): Promise<InvoiceTerms> {
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

async function assertWorkerCanViewInvoice(input: {
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

export async function GET(req: Request, props: RouteContext) {
  const params = await props.params;
  try {
    const url = new URL(req.url);
    const inline = url.searchParams.get("inline") === "1";

    const actor = await requireAppApiActor();
    const invoice = await prisma.invoice.findUnique({
      where: { id: params.invoiceId },
      select: {
        id: true,
        orgId: true,
        legacyLeadId: true,
        sourceJobId: true,
        invoiceNumber: true,
        status: true,
        subtotal: true,
        taxRate: true,
        taxAmount: true,
        total: true,
        amountPaid: true,
        balanceDue: true,
        issueDate: true,
        dueDate: true,
        notes: true,
        org: {
          select: {
            id: true,
            name: true,
            legalName: true,
            addressLine1: true,
            addressLine2: true,
            city: true,
            state: true,
            zip: true,
            phone: true,
            email: true,
            website: true,
            licenseNumber: true,
            ein: true,
            invoicePaymentInstructions: true,
            invoiceTemplate: true,
            logoPhotoId: true,
          },
        },
        customer: {
          select: {
            name: true,
            phoneE164: true,
            email: true,
            addressLine: true,
          },
        },
        legacyLead: {
          select: {
            id: true,
            contactName: true,
            businessName: true,
            phoneE164: true,
            city: true,
          },
        },
        sourceJob: {
          select: {
            id: true,
            leadId: true,
            customerName: true,
            serviceType: true,
            projectType: true,
          },
        },
        lineItems: {
          select: {
            description: true,
            quantity: true,
            unitPrice: true,
            lineTotal: true,
          },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        },
      },
    });

    if (!invoice) {
      throw new AppApiError("Invoice not found.", 404);
    }

    const terms = await resolveInvoiceTerms(invoice.id);
    const invoiceActionContext = getInvoiceActionContext({
      legacyLeadId: invoice.legacyLeadId,
      sourceJobId: invoice.sourceJobId,
      sourceJob: invoice.sourceJob,
    });

    assertOrgReadAccess(actor, invoice.orgId);

    if (!actor.internalUser && !canManageAnyOrgJobs(actor) && actor.calendarAccessRole === "WORKER") {
      await assertWorkerCanViewInvoice({
        actorId: actor.id,
        orgId: invoice.orgId,
        invoiceId: invoice.id,
        leadId: invoiceActionContext.leadId,
      });
    }

    const jobContext = getInvoiceReadJobContext({
      legacyLeadId: invoice.legacyLeadId,
      sourceJobId: invoice.sourceJobId,
      legacyLead: invoice.legacyLead,
      sourceJob: invoice.sourceJob,
    });
    const jobLabel = jobContext.primaryLabel;

    let logo: InvoicePdfImageSource | null = null;
    if (invoice.org.logoPhotoId) {
      try {
        const photo = await getPhotoStorageRecord({
          photoId: invoice.org.logoPhotoId,
          orgId: invoice.orgId,
        });

        if (photo?.imageDataUrl) {
          const decodedLogo = decodeInlineInvoicePdfLogo(photo.imageDataUrl);
          if (!decodedLogo) {
            console.warn("Invoice PDF skipped inline org logo because it could not be decoded for PDF rendering.", {
              invoiceId: invoice.id,
              orgId: invoice.orgId,
              logoPhotoId: invoice.org.logoPhotoId,
            });
          } else {
            logo = await normalizeInvoicePdfLogo({
              data: decodedLogo,
              invoiceId: invoice.id,
              orgId: invoice.orgId,
              logoPhotoId: invoice.org.logoPhotoId,
              source: "inline",
            });
          }
        } else if (photo && isR2Configured()) {
          const { r2, bucket } = requireR2();
          const object = await r2.send(
            new GetObjectCommand({
              Bucket: bucket,
              Key: photo.key,
            }),
          );
          const objectBytes = await readObjectBodyToBuffer(object.Body);
          if (!objectBytes) {
            console.warn("Invoice PDF skipped object-storage org logo because the file body could not be read.", {
              invoiceId: invoice.id,
              orgId: invoice.orgId,
              logoPhotoId: invoice.org.logoPhotoId,
              logoKey: photo.key,
            });
          } else {
            logo = await normalizeInvoicePdfLogo({
              data: objectBytes,
              invoiceId: invoice.id,
              orgId: invoice.orgId,
              logoPhotoId: invoice.org.logoPhotoId,
              source: "object-storage",
            });
          }
        } else if (photo) {
          console.warn("Invoice PDF skipped org logo because no inline data was available and object storage is not configured.", {
            invoiceId: invoice.id,
            orgId: invoice.orgId,
            logoPhotoId: invoice.org.logoPhotoId,
            logoKey: photo.key,
          });
        }
      } catch (error) {
        console.error("Invoice PDF failed to prepare org logo. Continuing without logo.", {
          invoiceId: invoice.id,
          orgId: invoice.orgId,
          logoPhotoId: invoice.org.logoPhotoId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const pdfBuffer = await buildInvoicePdfV2({
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      terms,
      template: normalizeInvoiceTemplate(invoice.org.invoiceTemplate),
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      org: {
        name: invoice.org.name,
        legalName: invoice.org.legalName,
        addressLine1: invoice.org.addressLine1,
        addressLine2: invoice.org.addressLine2,
        city: invoice.org.city,
        state: invoice.org.state,
        zip: invoice.org.zip,
        phone: invoice.org.phone,
        email: invoice.org.email,
        website: invoice.org.website,
        licenseNumber: invoice.org.licenseNumber,
        ein: invoice.org.ein,
        invoicePaymentInstructions: invoice.org.invoicePaymentInstructions,
        logo,
      },
      customer: {
        name: invoice.customer.name,
        phoneE164: invoice.customer.phoneE164,
        email: invoice.customer.email,
        addressLine: invoice.customer.addressLine,
      },
      jobLabel,
      lineItems: invoice.lineItems,
      subtotal: invoice.subtotal,
      taxRate: invoice.taxRate,
      taxAmount: invoice.taxAmount,
      total: invoice.total,
      amountPaid: invoice.amountPaid,
      balanceDue: invoice.balanceDue,
      notes: invoice.notes,
    });

    const fileName = `${formatInvoiceNumber(invoice.invoiceNumber)}.pdf`;

    await trackPortalEvent("Invoice Printed", {
      orgId: invoice.orgId,
      invoiceId: invoice.id,
      actorId: actor.id,
    });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "GET /api/invoices/[invoiceId]/pdf",
      invoiceId: params.invoiceId,
    });
    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to generate invoice PDF.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
