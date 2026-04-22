import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertOrgWriteAccess,
  canManageAnyOrgJobs,
  requireAppApiActor,
} from "@/lib/app-api-permissions";
import {
  assertWorkerCanViewInvoice,
  resolveInvoicePdfLogo,
  resolveInvoiceTerms,
} from "@/lib/invoice-delivery";
import {
  formatCurrency,
  formatInvoiceNumber,
  getInvoiceActionContext,
  getInvoiceReadJobContext,
} from "@/lib/invoices";
import { normalizeInvoiceTemplate } from "@/lib/invoice-template";
import { buildInvoicePdfV2 } from "@/lib/invoice-pdf";
import { formatDateTimeForDisplay } from "@/lib/calendar/dates";
import { sendEmail } from "@/lib/mailer";
import { capturePortalError, trackPortalEvent } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: {
    invoiceId: string;
  };
};

type SendInvoicePayload = {
  message?: unknown;
};

function formatDate(value: Date): string {
  return formatDateTimeForDisplay(value, {
    month: "long",
    day: "numeric",
    year: "numeric",
  }, {
    fallback: "",
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function POST(req: Request, { params }: RouteContext) {
  try {
    const actor = await requireAppApiActor();
    const payload = (await req.json().catch(() => null)) as SendInvoicePayload | null;
    const customMessage = typeof payload?.message === "string" ? payload.message.trim() : "";

    if (customMessage.length > 4000) {
      throw new AppApiError("Custom invoice message is too long.", 400);
    }

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
        sentAt: true,
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

    assertOrgWriteAccess(actor, invoice.orgId);

    const invoiceActionContext = getInvoiceActionContext({
      legacyLeadId: invoice.legacyLeadId,
      sourceJobId: invoice.sourceJobId,
      sourceJob: invoice.sourceJob,
    });

    if (!actor.internalUser && !canManageAnyOrgJobs(actor) && actor.calendarAccessRole === "WORKER") {
      await assertWorkerCanViewInvoice({
        actorId: actor.id,
        orgId: invoice.orgId,
        invoiceId: invoice.id,
        leadId: invoiceActionContext.leadId,
      });
    }

    if (!invoice.customer.email?.trim()) {
      throw new AppApiError("Customer email is required before sending an invoice.", 400);
    }

    const [terms, logo] = await Promise.all([
      resolveInvoiceTerms(invoice.id),
      resolveInvoicePdfLogo({
        invoiceId: invoice.id,
        orgId: invoice.orgId,
        logoPhotoId: invoice.org.logoPhotoId,
      }),
    ]);

    const jobContext = getInvoiceReadJobContext({
      legacyLeadId: invoice.legacyLeadId,
      sourceJobId: invoice.sourceJobId,
      legacyLead: invoice.legacyLead,
      sourceJob: invoice.sourceJob,
    });

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
      jobLabel: jobContext.primaryLabel,
      lineItems: invoice.lineItems,
      subtotal: invoice.subtotal,
      taxRate: invoice.taxRate,
      taxAmount: invoice.taxAmount,
      total: invoice.total,
      amountPaid: invoice.amountPaid,
      balanceDue: invoice.balanceDue,
      notes: invoice.notes,
    });

    const orgName = invoice.org.legalName?.trim() || invoice.org.name;
    const formattedInvoiceNumber = formatInvoiceNumber(invoice.invoiceNumber);
    const totalDue = invoice.balanceDue.gt(0) ? invoice.balanceDue : invoice.total;
    const totalLabel = formatCurrency(totalDue);
    const dueDateLabel = formatDate(invoice.dueDate);
    const safeBusinessName = escapeHtml(orgName);
    const safeCustomerName = escapeHtml(invoice.customer.name);
    const safeInvoiceNumber = escapeHtml(formattedInvoiceNumber);
    const safeTotal = escapeHtml(totalLabel);
    const safeDueDate = escapeHtml(dueDateLabel);
    const safePhone = escapeHtml(invoice.org.phone?.trim() || "your business phone");
    const safeCustomMessage = customMessage ? escapeHtml(customMessage).replaceAll("\n", "<br />") : "";
    const subject = `Invoice #${formattedInvoiceNumber} from ${orgName}`;

    const textBody = [
      `Hi ${invoice.customer.name},`,
      "",
      `Please find your invoice #${formattedInvoiceNumber} for ${totalLabel} attached.`,
      "",
      `Due date: ${dueDateLabel}`,
      customMessage ? "" : null,
      customMessage || null,
      "",
      invoice.org.phone?.trim()
        ? `Questions? Reply to this email or call ${invoice.org.phone.trim()}.`
        : "Questions? Reply to this email.",
      "",
      "Thank you,",
      orgName,
    ]
      .filter((line): line is string => typeof line === "string")
      .join("\n");

    const htmlBody = `
      <p>Hi ${safeCustomerName},</p>
      <p>Please find your invoice #${safeInvoiceNumber} for ${safeTotal} attached.</p>
      <p>Due date: ${safeDueDate}</p>
      ${safeCustomMessage ? `<p>${safeCustomMessage}</p>` : ""}
      <p>Questions? Reply to this email or call ${safePhone}.</p>
      <p>Thank you,<br />${safeBusinessName}</p>
    `;

    await sendEmail({
      from: invoice.org.email?.trim() ? `${orgName} <${invoice.org.email.trim()}>` : undefined,
      to: invoice.customer.email.trim(),
      subject,
      text: textBody,
      html: htmlBody,
      attachments: [
        {
          filename: `Invoice-${formattedInvoiceNumber}.pdf`,
          content: Buffer.from(pdfBuffer),
          contentType: "application/pdf",
        },
      ],
    });

    const now = new Date();
    const updated = await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        sentAt: now,
        ...(invoice.status === "DRAFT" ? { status: "SENT" } : {}),
      },
      select: {
        sentAt: true,
        status: true,
      },
    });

    await trackPortalEvent("Invoice Sent", {
      orgId: invoice.orgId,
      invoiceId: invoice.id,
      actorId: actor.id,
    });

    return NextResponse.json({
      ok: true,
      success: true,
      sentAt: updated.sentAt?.toISOString() || now.toISOString(),
      status: updated.status,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "POST /api/invoices/[invoiceId]/send",
      invoiceId: params.invoiceId,
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return NextResponse.json({ ok: false, error: "Failed to update invoice send status." }, { status: 500 });
    }

    const message = error instanceof Error ? error.message : "Failed to send invoice.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
