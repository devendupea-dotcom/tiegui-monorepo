import { NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { InvoiceTerms } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertOrgReadAccess,
  canManageAnyOrgJobs,
  requireAppApiActor,
} from "@/lib/app-api-permissions";
import { DEFAULT_INVOICE_TERMS, formatInvoiceNumber, normalizeInvoiceTerms } from "@/lib/invoices";
import { buildInvoicePdfV2 } from "@/lib/invoice-pdf";
import { getPhotoStorageRecord } from "@/lib/photo-storage";
import { isR2Configured, requireR2 } from "@/lib/r2";
import { capturePortalError, trackPortalEvent } from "@/lib/telemetry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: {
    invoiceId: string;
  };
};

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
  jobId: string | null;
}) {
  if (!input.jobId) {
    throw new AppApiError("Workers can only access invoices linked to assigned jobs.", 403);
  }

  const allowed = await prisma.lead.findFirst({
    where: {
      id: input.jobId,
      orgId: input.orgId,
      OR: [
        { assignedToUserId: input.actorId },
        { createdByUserId: input.actorId },
        { events: { some: { assignedToUserId: input.actorId } } },
        { events: { some: { workerAssignments: { some: { workerUserId: input.actorId } } } } },
        { invoices: { some: { id: input.invoiceId } } },
      ],
    },
    select: { id: true },
  });

  if (!allowed) {
    throw new AppApiError("Workers can only access invoices for assigned jobs.", 403);
  }
}

export async function GET(req: Request, { params }: RouteContext) {
  try {
    const url = new URL(req.url);
    const inline = url.searchParams.get("inline") === "1";

    const actor = await requireAppApiActor();
    const invoice = await prisma.invoice.findUnique({
      where: { id: params.invoiceId },
      select: {
        id: true,
        orgId: true,
        jobId: true,
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
        job: {
          select: {
            id: true,
            contactName: true,
            businessName: true,
            phoneE164: true,
            city: true,
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

    assertOrgReadAccess(actor, invoice.orgId);

    if (!actor.internalUser && !canManageAnyOrgJobs(actor) && actor.calendarAccessRole === "WORKER") {
      await assertWorkerCanViewInvoice({
        actorId: actor.id,
        orgId: invoice.orgId,
        invoiceId: invoice.id,
        jobId: invoice.jobId,
      });
    }

    const jobLabel = invoice.job
      ? invoice.job.contactName || invoice.job.businessName || invoice.job.phoneE164
      : null;

    let logoUrl: string | null = null;
    if (invoice.org.logoPhotoId) {
      try {
        const photo = await getPhotoStorageRecord({
          photoId: invoice.org.logoPhotoId,
          orgId: invoice.orgId,
        });

        if (photo?.imageDataUrl) {
          logoUrl = photo.imageDataUrl;
        } else if (photo && isR2Configured()) {
          const { r2, bucket } = requireR2();
          logoUrl = await getSignedUrl(
            r2,
            new GetObjectCommand({
              Bucket: bucket,
              Key: photo.key,
            }),
            { expiresIn: 60 },
          );
        }
      } catch (error) {
        console.error("Invoice PDF failed to load org logo. Continuing without logo.", error);
      }
    }

    const pdfBuffer = await buildInvoicePdfV2({
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      terms,
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
        logoUrl,
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
