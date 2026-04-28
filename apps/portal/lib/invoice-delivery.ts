import "server-only";

import { Buffer } from "node:buffer";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { PNG } from "pngjs";
import { Prisma, type BillingInvoiceStatus, type InvoiceCollectionAttemptOutcome, type InvoiceCollectionAttemptSource, type InvoiceTerms } from "@prisma/client";
import { AppApiError } from "@/lib/app-api-permissions";
import { formatDateTimeForDisplay } from "@/lib/calendar/dates";
import { canSendInvoiceReminder } from "@/lib/invoice-collections";
import { normalizeInvoiceTemplate } from "@/lib/invoice-template";
import { buildInvoicePdfV2 } from "@/lib/invoice-pdf";
import { sendEmail } from "@/lib/mailer";
import { prisma } from "@/lib/prisma";
import { ensureInvoiceCheckoutSessionForInvoice } from "@/lib/stripe-invoice-payments";
import { trackPortalEvent } from "@/lib/telemetry";
import {
  buildInvoiceWorkerLeadAccessWhere,
  DEFAULT_INVOICE_TERMS,
  formatCurrency,
  formatInvoiceNumber,
  getInvoiceReadJobContext,
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

const invoiceDeliverySelect = {
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
  checkoutSessions: {
    select: {
      status: true,
      lastError: true,
    },
    orderBy: [{ createdAt: "desc" }],
    take: 1,
  },
} satisfies Prisma.InvoiceSelect;

type InvoiceDeliveryRecord = Prisma.InvoiceGetPayload<{
  select: typeof invoiceDeliverySelect;
}>;

export type SendInvoiceDeliveryMode = "invoice" | "reminder";

export type SendInvoiceDeliveryResult = {
  ok: true;
  reminderCount?: number;
  reminderSentAt?: string;
  sentAt: string;
  status: BillingInvoiceStatus;
  success: true;
};

function formatInvoiceDeliveryDate(value: Date): string {
  return formatDateTimeForDisplay(
    value,
    {
      month: "long",
      day: "numeric",
      year: "numeric",
    },
    {
      fallback: "",
    },
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeInvoiceCollectionAttemptReason(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

async function getInvoiceForDelivery(
  invoiceId: string,
): Promise<InvoiceDeliveryRecord> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: invoiceDeliverySelect,
  });

  if (!invoice) {
    throw new AppApiError("Invoice not found.", 404);
  }

  return invoice;
}

export async function recordInvoiceCollectionAttempt(input: {
  orgId: string;
  invoiceId: string;
  actorUserId?: string | null;
  source: InvoiceCollectionAttemptSource;
  outcome: InvoiceCollectionAttemptOutcome;
  reason?: string | null;
  metadataJson?: Prisma.InputJsonValue;
  dedupeWindowMinutes?: number;
}) {
  const normalizedReason = normalizeInvoiceCollectionAttemptReason(input.reason);
  const dedupeWindowMinutes = Math.max(0, input.dedupeWindowMinutes || 0);

  if (dedupeWindowMinutes > 0) {
    const cutoff = new Date(Date.now() - dedupeWindowMinutes * 60 * 1000);
    const existing = await prisma.invoiceCollectionAttempt.findFirst({
      where: {
        invoiceId: input.invoiceId,
        source: input.source,
        outcome: input.outcome,
        reason: normalizedReason,
        createdAt: { gte: cutoff },
      },
      select: {
        id: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (existing) {
      return existing;
    }
  }

  return prisma.invoiceCollectionAttempt.create({
    data: {
      orgId: input.orgId,
      invoiceId: input.invoiceId,
      actorUserId: input.actorUserId || null,
      source: input.source,
      outcome: input.outcome,
      reason: normalizedReason,
      metadataJson: input.metadataJson,
    },
    select: {
      id: true,
    },
  });
}

export async function sendInvoiceDelivery(input: {
  invoiceId: string;
  baseUrl: string;
  customMessage?: string;
  sendMode?: SendInvoiceDeliveryMode;
  refreshPayLink?: boolean;
  actorUserId?: string | null;
  source?: InvoiceCollectionAttemptSource;
}) {
  const customMessage = input.customMessage?.trim() || "";
  const sendMode = input.sendMode === "reminder" ? "reminder" : "invoice";
  const refreshPayLink = input.refreshPayLink === true;
  const source =
    input.source === "AUTOMATION" ? "AUTOMATION" : "MANUAL";
  let emailSent = false;

  if (customMessage.length > 4000) {
    throw new AppApiError("Custom invoice message is too long.", 400);
  }

  const invoice = await getInvoiceForDelivery(input.invoiceId);

  if (!invoice.customer.email?.trim()) {
    throw new AppApiError(
      "Customer email is required before sending an invoice.",
      400,
    );
  }

  if (
    sendMode === "reminder" &&
    !canSendInvoiceReminder({
      status: invoice.status,
      balanceDue: invoice.balanceDue,
    })
  ) {
    throw new AppApiError(
      "This invoice is not ready for a payment reminder yet.",
      400,
    );
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
  const dueDateLabel = formatInvoiceDeliveryDate(invoice.dueDate);
  const safeBusinessName = escapeHtml(orgName);
  const safeCustomerName = escapeHtml(invoice.customer.name);
  const safeCustomMessage = customMessage
    ? escapeHtml(customMessage).replaceAll("\n", "<br />")
    : "";
  const isReminder = sendMode === "reminder";
  const isOverdue = invoice.dueDate.getTime() < Date.now();
  const subject = isReminder
    ? `Payment reminder: Invoice #${formattedInvoiceNumber} from ${orgName}`
    : `Invoice #${formattedInvoiceNumber} from ${orgName}`;
  let payLinkUrl: string | null = null;
  let shouldRefreshPayLink = refreshPayLink;

  if (invoice.balanceDue.gt(0)) {
    const latestCheckoutSession = invoice.checkoutSessions[0] || null;
    shouldRefreshPayLink =
      refreshPayLink ||
      (sendMode === "reminder" &&
        source === "AUTOMATION" &&
        latestCheckoutSession?.status === "OPEN" &&
        Boolean(latestCheckoutSession.lastError?.trim()));

    try {
      const checkout = await ensureInvoiceCheckoutSessionForInvoice({
        orgId: invoice.orgId,
        invoiceId: invoice.id,
        baseUrl: input.baseUrl,
        forceNew: shouldRefreshPayLink,
      });
      payLinkUrl = checkout.checkoutUrl;
    } catch (error) {
      if (shouldRefreshPayLink) {
        throw new AppApiError(
          error instanceof Error
            ? error.message
            : "Could not generate a fresh payment link for this invoice email.",
          400,
        );
      }
      console.warn("[invoice-send] unable to attach pay link", {
        invoiceId: invoice.id,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  const safePayLinkUrl = payLinkUrl ? escapeHtml(payLinkUrl) : null;
  const introLine = isReminder
    ? `This is a reminder that invoice #${formattedInvoiceNumber} still has a remaining balance of ${totalLabel}.`
    : `Please find your invoice #${formattedInvoiceNumber} for ${totalLabel} attached.`;
  const dueLine = isReminder
    ? isOverdue
      ? `This invoice is now past due. Original due date: ${dueDateLabel}`
      : `Due date: ${dueDateLabel}`
    : `Due date: ${dueDateLabel}`;
  const questionsLine = invoice.org.phone?.trim()
    ? `Questions? Reply to this email or call ${invoice.org.phone.trim()}.`
    : "Questions? Reply to this email.";
  const safeQuestionsLine = escapeHtml(questionsLine);
  const closingLine = isReminder
    ? "Thank you for taking care of this."
    : "Thank you,";

  const textBody = [
    `Hi ${invoice.customer.name},`,
    "",
    introLine,
    "",
    dueLine,
    payLinkUrl ? "" : null,
    payLinkUrl ? `Pay online securely: ${payLinkUrl}` : null,
    customMessage ? "" : null,
    customMessage || null,
    "",
    questionsLine,
    "",
    closingLine,
    orgName,
  ]
    .filter((line): line is string => typeof line === "string")
    .join("\n");

  const htmlBody = `
      <p>Hi ${safeCustomerName},</p>
      <p>${escapeHtml(introLine)}</p>
      <p>${escapeHtml(dueLine)}</p>
      ${
        safePayLinkUrl
          ? `<p><a href="${safePayLinkUrl}" style="display:inline-block;padding:12px 18px;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">Pay Invoice Online</a></p><p>Or copy this secure payment link into your browser:<br /><a href="${safePayLinkUrl}">${safePayLinkUrl}</a></p>`
          : ""
      }
      ${safeCustomMessage ? `<p>${safeCustomMessage}</p>` : ""}
      <p>${safeQuestionsLine}</p>
      <p>${escapeHtml(closingLine)}<br />${safeBusinessName}</p>
    `;

  try {
    await sendEmail({
      from: invoice.org.email?.trim()
        ? `${orgName} <${invoice.org.email.trim()}>`
        : undefined,
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
    emailSent = true;

    const now = new Date();
    const updated = await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        ...(sendMode === "invoice" ? { sentAt: now } : {}),
        ...(sendMode === "invoice" && invoice.status === "DRAFT"
          ? { status: "SENT" }
          : {}),
        ...(sendMode === "reminder"
          ? {
              lastReminderSentAt: now,
              reminderCount: {
                increment: 1,
              },
            }
          : {}),
      },
      select: {
        lastReminderSentAt: true,
        reminderCount: true,
        sentAt: true,
        status: true,
      },
    });

    await trackPortalEvent(
      sendMode === "reminder" ? "Invoice Reminder Sent" : "Invoice Sent",
      {
        orgId: invoice.orgId,
        invoiceId: invoice.id,
        actorId: input.actorUserId || null,
        source,
      },
    );

    if (sendMode === "reminder") {
      await recordInvoiceCollectionAttempt({
        orgId: invoice.orgId,
        invoiceId: invoice.id,
        actorUserId: input.actorUserId || null,
        source,
        outcome: "SENT",
        metadataJson: {
          refreshPayLink: shouldRefreshPayLink,
          payLinkIncluded: Boolean(payLinkUrl),
          reminderCount: updated.reminderCount,
        },
      });
    }

    return {
      ok: true,
      reminderCount: updated.reminderCount,
      reminderSentAt: updated.lastReminderSentAt?.toISOString(),
      success: true,
      sentAt: updated.sentAt?.toISOString() || now.toISOString(),
      status: updated.status,
    } satisfies SendInvoiceDeliveryResult;
  } catch (error) {
    if (emailSent) {
      const followup = new AppApiError(
        "Invoice email may already have been sent. Refresh the invoice before retrying.",
        500,
      ) as AppApiError & { emailPossiblySent?: boolean };
      followup.emailPossiblySent = true;
      throw followup;
    }

    throw error;
  }
}
