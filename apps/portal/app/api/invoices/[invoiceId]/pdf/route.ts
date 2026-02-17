import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertOrgReadAccess,
  canManageAnyOrgJobs,
  requireAppApiActor,
} from "@/lib/app-api-permissions";
import { buildInvoicePdfDocument, formatInvoiceNumber } from "@/lib/invoices";
import { capturePortalError, trackPortalEvent } from "@/lib/telemetry";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: {
    invoiceId: string;
  };
};

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

export async function GET(_req: Request, { params }: RouteContext) {
  try {
    const actor = await requireAppApiActor();
    const invoice = await prisma.invoice.findUnique({
      where: { id: params.invoiceId },
      include: {
        org: {
          select: { id: true, name: true },
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

    const pdfBuffer = buildInvoicePdfDocument({
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      orgName: invoice.org.name,
      customerName: invoice.customer.name,
      customerPhone: invoice.customer.phoneE164,
      customerEmail: invoice.customer.email,
      customerAddress: invoice.customer.addressLine,
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
        "Content-Disposition": `attachment; filename="${fileName}"`,
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
