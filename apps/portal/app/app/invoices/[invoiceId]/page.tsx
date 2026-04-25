import Link from "next/link";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import type {
  BillingInvoiceStatus,
  InvoicePaymentMethod,
  InvoiceTerms,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  billingInvoiceStatusOptions,
  buildInvoiceWorkerLeadAccessWhere,
  computeLineTotal,
  formatCurrency,
  formatInvoiceNumber,
  getInvoiceActionContext,
  getInvoiceActionRevalidationPaths,
  getInvoiceReadJobContext,
  manualInvoicePaymentMethodOptions,
  invoiceTermsOptions,
  parseMoneyInput,
  parseTaxRatePercent,
  recomputeInvoiceTotals,
  shouldRenderInvoicePaidIndicator,
  taxRateToPercent,
  toMoneyDecimal,
} from "@/lib/invoices";
import {
  canSendInvoiceReminder,
  hasInvoiceReminderHistory,
  readInvoiceCollectionAttemptMetadata,
  summarizeInvoiceCollectionHistory,
} from "@/lib/invoice-collections";
import { normalizeInvoiceTemplate } from "@/lib/invoice-template";
import { resolveOrganizationLogoUrlBestEffort } from "@/lib/organization-logo";
import { sendMetaCapiPurchaseForInvoice } from "@/lib/meta-capi";
import {
  cancelOpenInvoiceCheckoutSessionsForInvoice,
  ensureInvoiceCheckoutSessionForInvoice,
  isInvoiceOnlinePaymentReady,
} from "@/lib/stripe-invoice-payments";
import { isStripeWebhookConfigured } from "@/lib/stripe-client";
import {
  DEFAULT_CALENDAR_TIMEZONE,
  formatDateTimeForDisplay,
  localDateFromUtc,
  toUtcFromLocalDateTime,
} from "@/lib/calendar/dates";
import SendInvoiceModal from "@/components/invoices/send-invoice-modal";
import { formatDateTime, formatLabel } from "@/lib/hq";
import { getConfiguredBaseUrl } from "@/lib/urls";
import {
  getParam,
  requireAppOrgActor,
  resolveAppScope,
  withOrgQuery,
} from "../../_lib/portal-scope";
import { requireAppPageViewer } from "../../_lib/portal-viewer";
import InvoicePreview from "../../_components/invoice-preview";

export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{
    invoiceId: string;
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function appendQuery(path: string, key: string, value: string): string {
  const joiner = path.includes("?") ? "&" : "?";
  return `${path}${joiner}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

async function getServerActionBaseUrl(): Promise<string> {
  const headerStore = await headers();
  const forwardedProto = headerStore
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const forwardedHost = headerStore
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const host =
    forwardedHost || headerStore.get("host")?.split(",")[0]?.trim() || null;

  if (host) {
    return `${forwardedProto || "https"}://${host}`;
  }

  return getConfiguredBaseUrl() || "http://localhost:3001";
}

function toDateInputValue(value: Date | null | undefined): string {
  if (!value) return "";
  return localDateFromUtc(value, DEFAULT_CALENDAR_TIMEZONE);
}

function parseDateInput(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return toUtcFromLocalDateTime({
      date: trimmed,
      time: "12:00",
      timeZone: DEFAULT_CALENDAR_TIMEZONE,
    });
  } catch {
    return null;
  }
}

function isAllowedManualStatus(value: string): value is BillingInvoiceStatus {
  return billingInvoiceStatusOptions.some((status) => status === value);
}

function isInvoiceTerms(value: string): value is InvoiceTerms {
  return invoiceTermsOptions.some((option) => option === value);
}

function formatInvoiceTermsLabel(value: InvoiceTerms): string {
  switch (value) {
    case "NET_7":
      return "Net 7";
    case "NET_15":
      return "Net 15";
    case "NET_30":
      return "Net 30";
    case "DUE_ON_RECEIPT":
    default:
      return "Due on receipt";
  }
}

function isManualPaymentMethod(value: string): value is InvoicePaymentMethod {
  return manualInvoicePaymentMethodOptions.some((option) => option === value);
}

function buildAddressLines(input: {
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): string[] {
  const locality = [input.city, input.state, input.zip]
    .map((part) => (part || "").trim())
    .filter(Boolean)
    .join(", ");
  return [input.addressLine1, input.addressLine2, locality]
    .map((part) => (part || "").trim())
    .filter(Boolean);
}

function formatCollectionsQueueStageLabel(value: string | null) {
  switch (value) {
    case "due_now":
      return "Due Now";
    case "upcoming":
      return "Upcoming";
    case "maxed":
      return "Limit Reached";
    case "disabled":
      return "Queue Off";
    default:
      return null;
  }
}

function formatCollectionAttemptDetailSummary(input: {
  outcome: "SENT" | "SKIPPED" | "FAILED";
  reason?: string | null;
}) {
  const reason = input.reason?.trim();
  if (reason) {
    return reason;
  }

  if (input.outcome === "SENT") {
    return "Reminder sent successfully.";
  }

  if (input.outcome === "SKIPPED") {
    return "Reminder was skipped.";
  }

  return "Reminder send failed.";
}

function formatInvoiceSentDate(value: Date): string {
  return formatDateTimeForDisplay(value, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function revalidateInvoiceMutationPaths(input: {
  invoiceId: string;
  leadId?: string | null;
}) {
  for (const path of getInvoiceActionRevalidationPaths(input)) {
    revalidatePath(path);
  }
}

async function invalidateInvoicePayLinksAfterMutation(input: {
  invoiceId: string;
  reason: string;
}) {
  try {
    await cancelOpenInvoiceCheckoutSessionsForInvoice(input);
  } catch (error) {
    console.warn("[invoice-detail] failed to invalidate stale pay links", {
      invoiceId: input.invoiceId,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

async function requireInvoiceActionAccess(formData: FormData) {
  const invoiceId = String(formData.get("invoiceId") || "").trim();
  const orgId = String(formData.get("orgId") || "").trim();
  const returnPathRaw = String(formData.get("returnPath") || "").trim();
  const fallbackPath = "/app/invoices";

  if (!invoiceId || !orgId) {
    redirect(fallbackPath);
  }

  const actor = await requireAppOrgActor(`/app/invoices/${invoiceId}`, orgId);

  if (!actor.internalUser && actor.calendarAccessRole === "READ_ONLY") {
    redirect(appendQuery(returnPathRaw || fallbackPath, "error", "readonly"));
  }

  const invoice = await prisma.invoice.findFirst({
    where: {
      id: invoiceId,
      orgId,
    },
    select: {
      id: true,
      orgId: true,
      legacyLeadId: true,
      sourceJobId: true,
      status: true,
      dueDate: true,
      taxRate: true,
      total: true,
      amountPaid: true,
      balanceDue: true,
      sourceJob: {
        select: {
          id: true,
          leadId: true,
        },
      },
    },
  });

  if (!invoice) {
    redirect(fallbackPath);
  }

  const invoiceActionContext = getInvoiceActionContext({
    legacyLeadId: invoice.legacyLeadId,
    sourceJobId: invoice.sourceJobId,
    sourceJob: invoice.sourceJob,
  });

  if (!actor.internalUser && actor.calendarAccessRole === "WORKER") {
    if (!invoiceActionContext.leadId) {
      redirect(
        appendQuery(
          returnPathRaw || fallbackPath,
          "error",
          "worker-permission",
        ),
      );
    }

    const workerAllowed = await prisma.lead.findFirst({
      where: {
        id: invoiceActionContext.leadId,
        orgId,
        ...buildInvoiceWorkerLeadAccessWhere({
          actorId: actor.id,
          invoiceId: invoice.id,
        }),
      },
      select: { id: true },
    });

    if (!workerAllowed) {
      redirect(
        appendQuery(
          returnPathRaw || fallbackPath,
          "error",
          "worker-permission",
        ),
      );
    }
  }

  const returnPath = returnPathRaw.startsWith("/app/invoices/")
    ? returnPathRaw
    : fallbackPath;
  return {
    invoice,
    invoiceActionContext,
    orgId,
    returnPath,
    actorId: actor.id ?? null,
    internalUser: actor.internalUser,
  };
}

async function saveInvoiceMetaAction(formData: FormData) {
  "use server";

  const scoped = await requireInvoiceActionAccess(formData);
  const issueDateRaw = String(formData.get("issueDate") || "").trim();
  const dueDateRaw = String(formData.get("dueDate") || "").trim();
  const statusRaw = String(formData.get("status") || "")
    .trim()
    .toUpperCase();
  const termsRaw = String(formData.get("terms") || "")
    .trim()
    .toUpperCase();
  const taxRatePercentRaw = String(formData.get("taxRatePercent") || "").trim();
  const notes = String(formData.get("notes") || "").trim();

  const issueDate = parseDateInput(issueDateRaw);
  const dueDate = parseDateInput(dueDateRaw);
  const taxRate = parseTaxRatePercent(taxRatePercentRaw);

  if (!isInvoiceTerms(termsRaw)) {
    redirect(appendQuery(scoped.returnPath, "error", "meta-terms"));
  }

  if (!issueDate || !dueDate) {
    redirect(appendQuery(scoped.returnPath, "error", "meta-date"));
  }

  if (dueDate < issueDate) {
    redirect(appendQuery(scoped.returnPath, "error", "meta-due"));
  }

  if (!taxRate) {
    redirect(appendQuery(scoped.returnPath, "error", "meta-tax"));
  }

  if (!isAllowedManualStatus(statusRaw)) {
    redirect(appendQuery(scoped.returnPath, "error", "meta-status"));
  }

  if (notes.length > 8000) {
    redirect(appendQuery(scoped.returnPath, "error", "meta-notes"));
  }

  await prisma.$transaction(async (tx) => {
    await tx.invoice.update({
      where: { id: scoped.invoice.id },
      data: {
        issueDate,
        dueDate,
        terms: termsRaw,
        status: statusRaw,
        taxRate,
        notes: notes || null,
      },
    });
    await recomputeInvoiceTotals(tx, scoped.invoice.id);
  });

  if (!taxRate.equals(scoped.invoice.taxRate)) {
    await invalidateInvoicePayLinksAfterMutation({
      invoiceId: scoped.invoice.id,
      reason: "Invoice tax changed after this payment link was created.",
    });
  }

  await sendMetaCapiPurchaseForInvoice({ invoiceId: scoped.invoice.id });

  revalidateInvoiceMutationPaths({
    invoiceId: scoped.invoice.id,
    leadId: scoped.invoiceActionContext.leadId,
  });

  redirect(appendQuery(scoped.returnPath, "saved", "meta"));
}

async function addLineItemAction(formData: FormData) {
  "use server";

  const scoped = await requireInvoiceActionAccess(formData);
  const description = String(formData.get("description") || "").trim();
  const quantityRaw = String(formData.get("quantity") || "").trim();
  const unitPriceRaw = String(formData.get("unitPrice") || "").trim();

  if (!description || description.length > 200) {
    redirect(appendQuery(scoped.returnPath, "error", "line-description"));
  }

  const quantity = parseMoneyInput(quantityRaw);
  const unitPrice = parseMoneyInput(unitPriceRaw);

  if (
    !quantity ||
    quantity.lte(0) ||
    quantity.gt(10000) ||
    !unitPrice ||
    unitPrice.lt(0)
  ) {
    redirect(appendQuery(scoped.returnPath, "error", "line-values"));
  }

  await prisma.$transaction(async (tx) => {
    const maxSort = await tx.invoiceLineItem.aggregate({
      where: { invoiceId: scoped.invoice.id },
      _max: { sortOrder: true },
    });

    await tx.invoiceLineItem.create({
      data: {
        invoiceId: scoped.invoice.id,
        description,
        quantity,
        unitPrice,
        lineTotal: computeLineTotal(quantity, unitPrice),
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
      },
    });

    await recomputeInvoiceTotals(tx, scoped.invoice.id);
  });

  await invalidateInvoicePayLinksAfterMutation({
    invoiceId: scoped.invoice.id,
    reason: "Invoice line items changed after this payment link was created.",
  });

  await sendMetaCapiPurchaseForInvoice({ invoiceId: scoped.invoice.id });

  revalidateInvoiceMutationPaths({
    invoiceId: scoped.invoice.id,
    leadId: scoped.invoiceActionContext.leadId,
  });

  redirect(appendQuery(scoped.returnPath, "saved", "line"));
}

async function updateLineItemAction(formData: FormData) {
  "use server";

  const scoped = await requireInvoiceActionAccess(formData);
  const lineItemId = String(formData.get("lineItemId") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const quantityRaw = String(formData.get("quantity") || "").trim();
  const unitPriceRaw = String(formData.get("unitPrice") || "").trim();

  if (!lineItemId || !description || description.length > 200) {
    redirect(appendQuery(scoped.returnPath, "error", "line-update"));
  }

  const quantity = parseMoneyInput(quantityRaw);
  const unitPrice = parseMoneyInput(unitPriceRaw);

  if (
    !quantity ||
    quantity.lte(0) ||
    quantity.gt(10000) ||
    !unitPrice ||
    unitPrice.lt(0)
  ) {
    redirect(appendQuery(scoped.returnPath, "error", "line-values"));
  }

  await prisma.$transaction(async (tx) => {
    const existing = await tx.invoiceLineItem.findFirst({
      where: {
        id: lineItemId,
        invoiceId: scoped.invoice.id,
      },
      select: { id: true },
    });
    if (!existing) {
      throw new Error("Line item not found.");
    }

    await tx.invoiceLineItem.update({
      where: { id: lineItemId },
      data: {
        description,
        quantity,
        unitPrice,
        lineTotal: computeLineTotal(quantity, unitPrice),
      },
    });

    await recomputeInvoiceTotals(tx, scoped.invoice.id);
  });

  await invalidateInvoicePayLinksAfterMutation({
    invoiceId: scoped.invoice.id,
    reason: "Invoice line items changed after this payment link was created.",
  });

  revalidateInvoiceMutationPaths({
    invoiceId: scoped.invoice.id,
    leadId: scoped.invoiceActionContext.leadId,
  });

  redirect(appendQuery(scoped.returnPath, "saved", "line-update"));
}

async function deleteLineItemAction(formData: FormData) {
  "use server";

  const scoped = await requireInvoiceActionAccess(formData);
  const lineItemId = String(formData.get("lineItemId") || "").trim();

  if (!lineItemId) {
    redirect(appendQuery(scoped.returnPath, "error", "line-delete"));
  }

  await prisma.$transaction(async (tx) => {
    await tx.invoiceLineItem.deleteMany({
      where: {
        id: lineItemId,
        invoiceId: scoped.invoice.id,
      },
    });
    await recomputeInvoiceTotals(tx, scoped.invoice.id);
  });

  await invalidateInvoicePayLinksAfterMutation({
    invoiceId: scoped.invoice.id,
    reason: "Invoice line items changed after this payment link was created.",
  });

  revalidateInvoiceMutationPaths({
    invoiceId: scoped.invoice.id,
    leadId: scoped.invoiceActionContext.leadId,
  });

  redirect(appendQuery(scoped.returnPath, "saved", "line-delete"));
}

async function recordPaymentAction(formData: FormData) {
  "use server";

  const scoped = await requireInvoiceActionAccess(formData);
  const amountRaw = String(formData.get("amount") || "").trim();
  const dateRaw = String(formData.get("date") || "").trim();
  const methodRaw = String(formData.get("method") || "")
    .trim()
    .toUpperCase();
  const note = String(formData.get("note") || "").trim();

  const amount = parseMoneyInput(amountRaw);
  const date = parseDateInput(dateRaw);

  if (!amount || amount.lte(0)) {
    redirect(appendQuery(scoped.returnPath, "error", "payment-amount"));
  }

  if (!date) {
    redirect(appendQuery(scoped.returnPath, "error", "payment-date"));
  }

  if (!isManualPaymentMethod(methodRaw)) {
    redirect(appendQuery(scoped.returnPath, "error", "payment-method"));
  }

  if (note.length > 500) {
    redirect(appendQuery(scoped.returnPath, "error", "payment-note"));
  }

  await prisma.$transaction(async (tx) => {
    await tx.invoicePayment.create({
      data: {
        invoiceId: scoped.invoice.id,
        amount,
        date,
        method: methodRaw,
        note: note || null,
      },
    });
    await recomputeInvoiceTotals(tx, scoped.invoice.id);
  });

  await invalidateInvoicePayLinksAfterMutation({
    invoiceId: scoped.invoice.id,
    reason: "A manual payment was recorded after this payment link was created.",
  });

  revalidateInvoiceMutationPaths({
    invoiceId: scoped.invoice.id,
    leadId: scoped.invoiceActionContext.leadId,
  });

  redirect(appendQuery(scoped.returnPath, "saved", "payment"));
}

async function markInvoicePaidAction(formData: FormData) {
  "use server";

  const scoped = await requireInvoiceActionAccess(formData);
  const note = String(formData.get("note") || "").trim();

  await prisma.$transaction(async (tx) => {
    const current = await tx.invoice.findUnique({
      where: { id: scoped.invoice.id },
      select: {
        id: true,
        balanceDue: true,
      },
    });

    if (!current || current.balanceDue.lte(0)) {
      return;
    }

    await tx.invoicePayment.create({
      data: {
        invoiceId: scoped.invoice.id,
        amount: current.balanceDue,
        date: new Date(),
        method: "OTHER",
        note: note || "Marked paid manually in portal",
      },
    });

    await recomputeInvoiceTotals(tx, scoped.invoice.id);
  });

  await invalidateInvoicePayLinksAfterMutation({
    invoiceId: scoped.invoice.id,
    reason: "This invoice was marked paid after this payment link was created.",
  });

  revalidateInvoiceMutationPaths({
    invoiceId: scoped.invoice.id,
    leadId: scoped.invoiceActionContext.leadId,
  });

  redirect(appendQuery(scoped.returnPath, "saved", "paid"));
}

async function generateInvoicePayLinkAction(formData: FormData) {
  "use server";

  const scoped = await requireInvoiceActionAccess(formData);
  const forceNew = String(formData.get("forceNew") || "").trim() === "1";

  try {
    await ensureInvoiceCheckoutSessionForInvoice({
      orgId: scoped.orgId,
      invoiceId: scoped.invoice.id,
      baseUrl: await getServerActionBaseUrl(),
      forceNew,
    });
  } catch {
    redirect(
      appendQuery(
        scoped.returnPath,
        "error",
        forceNew ? "pay-link-refresh-failed" : "pay-link-failed",
      ),
    );
  }

  revalidateInvoiceMutationPaths({
    invoiceId: scoped.invoice.id,
    leadId: scoped.invoiceActionContext.leadId,
  });

  redirect(
    appendQuery(
      scoped.returnPath,
      "saved",
      forceNew ? "pay-link-refresh" : "pay-link",
    ),
  );
}

export default async function InvoiceDetailPage(props: RouteParams) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const requestedOrgId = getParam(searchParams?.orgId);
  const saved = getParam(searchParams?.saved);
  const error = getParam(searchParams?.error);
  const focusTarget = getParam(searchParams?.focus);

  const scope = await resolveAppScope({
    nextPath: `/app/invoices/${params.invoiceId}`,
    requestedOrgId,
  });
  const viewer = await requireAppPageViewer({
    nextPath: `/app/invoices/${params.invoiceId}`,
    orgId: scope.orgId,
  });

  const invoice = await prisma.invoice.findFirst({
    where: {
      id: params.invoiceId,
      orgId: scope.orgId,
    },
    include: {
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
          stripeConnection: {
            select: {
              status: true,
            },
          },
        },
      },
      customer: {
        select: {
          id: true,
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
          status: true,
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
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
      payments: {
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      },
      collectionAttempts: {
        include: {
          actor: {
            select: {
              name: true,
              email: true,
            },
          },
        },
        orderBy: [{ createdAt: "desc" }],
        take: 12,
      },
      checkoutSessions: {
        orderBy: [{ createdAt: "desc" }],
        take: 5,
      },
    },
  });

  if (!invoice) {
    if (scope.internalUser && !requestedOrgId) {
      const fallback = await prisma.invoice.findUnique({
        where: { id: params.invoiceId },
        select: { orgId: true },
      });

      if (fallback) {
        redirect(
          `/app/invoices/${params.invoiceId}?orgId=${encodeURIComponent(fallback.orgId)}`,
        );
      }
    }

    notFound();
  }

  const invoiceActionContext = getInvoiceActionContext({
    legacyLeadId: invoice.legacyLeadId,
    sourceJobId: invoice.sourceJobId,
    sourceJob: invoice.sourceJob,
  });

  if (!viewer.internalUser && viewer.calendarAccessRole === "WORKER") {
    if (!invoiceActionContext.leadId) {
      notFound();
    }
    const workerAllowed = await prisma.lead.findFirst({
      where: {
        id: invoiceActionContext.leadId,
        orgId: scope.orgId,
        ...buildInvoiceWorkerLeadAccessWhere({
          actorId: viewer.id,
          invoiceId: invoice.id,
        }),
      },
      select: { id: true },
    });
    if (!workerAllowed) {
      notFound();
    }
  }

  const invoicePath = withOrgQuery(
    `/app/invoices/${invoice.id}`,
    scope.orgId,
    scope.internalUser,
  );
  const invoicesPath = withOrgQuery(
    "/app/invoices",
    scope.orgId,
    scope.internalUser,
  );
  const pdfDownloadPath = `/api/invoices/${invoice.id}/pdf`;
  const pdfPreviewPath = `${pdfDownloadPath}?inline=1`;
  const jobContext = getInvoiceReadJobContext({
    legacyLeadId: invoice.legacyLeadId,
    sourceJobId: invoice.sourceJobId,
    legacyLead: invoice.legacyLead,
    sourceJob: invoice.sourceJob,
  });
  const operationalJobPath = jobContext.operationalJobId
    ? withOrgQuery(
        `/app/jobs/records/${jobContext.operationalJobId}`,
        scope.orgId,
        scope.internalUser,
      )
    : null;
  const crmJobPath = jobContext.crmLeadId
    ? withOrgQuery(
        `/app/jobs/${jobContext.crmLeadId}?tab=invoice`,
        scope.orgId,
        scope.internalUser,
      )
    : null;
  const paymentDefault = Number(
    toMoneyDecimal(invoice.balanceDue).toString(),
  ).toFixed(2);
  const webhookConfigured = isStripeWebhookConfigured();
  const onlinePaymentReady = isInvoiceOnlinePaymentReady({
    stripeConnectionStatus: invoice.org.stripeConnection?.status || null,
    webhookConfigured,
    balanceDue: invoice.balanceDue,
  });
  const activeCheckoutSession =
    invoice.checkoutSessions.find(
      (session) =>
        session.status === "OPEN" &&
        (!session.expiresAt || session.expiresAt.getTime() > Date.now()),
    ) || null;
  const latestCheckoutSession = invoice.checkoutSessions[0] || null;
  const checkoutFailureSession =
    activeCheckoutSession?.lastError
      ? activeCheckoutSession
      : latestCheckoutSession?.lastError
        ? latestCheckoutSession
        : null;
  const checkoutNeedsAttention = Boolean(
    checkoutFailureSession ||
      latestCheckoutSession?.status === "EXPIRED" ||
      latestCheckoutSession?.status === "CANCELED",
  );
  const hasTax = invoice.taxAmount.gt(0) || invoice.taxRate.gt(0);
  const isPaidInvoice = shouldRenderInvoicePaidIndicator({
    status: invoice.status,
  });
  const reminderReady = canSendInvoiceReminder({
    status: invoice.status,
    balanceDue: invoice.balanceDue,
  });
  const displayStatus = invoice.status;
  const balanceBadgeClass = isPaidInvoice
    ? "status-paid"
    : invoice.balanceDue.gt(0)
      ? "status-overdue"
      : "";
  const sentAtLabel = invoice.sentAt
    ? formatInvoiceSentDate(invoice.sentAt)
    : null;
  const reminderHistoryLabel = hasInvoiceReminderHistory({
    reminderCount: invoice.reminderCount,
    lastReminderSentAt: invoice.lastReminderSentAt,
  })
    ? invoice.lastReminderSentAt
      ? `Last reminder sent on ${formatInvoiceSentDate(invoice.lastReminderSentAt)}${invoice.reminderCount > 1 ? ` • ${invoice.reminderCount} total reminders` : ""}`
      : `${invoice.reminderCount} reminder${invoice.reminderCount === 1 ? "" : "s"} sent`
    : null;
  const latestCollectionAttempt = invoice.collectionAttempts[0] || null;
  const collectionActivitySummary = summarizeInvoiceCollectionHistory(
    invoice.collectionAttempts,
  );
  const collectionsActivityPath = `${invoicePath}#collections-activity`;
  const jobLabel = jobContext.primaryLabel;
  const logoUrl = await resolveOrganizationLogoUrlBestEffort({
    orgId: invoice.org.id,
    logoPhotoId: invoice.org.logoPhotoId,
  });
  const previewData = {
    invoiceNumber: formatInvoiceNumber(invoice.invoiceNumber),
    issueDate: invoice.issueDate.toISOString(),
    dueDate: invoice.dueDate.toISOString(),
    status: invoice.status,
    jobTitle: jobLabel,
    termsLabel: formatInvoiceTermsLabel(invoice.terms),
    business: {
      name: invoice.org.legalName?.trim() || invoice.org.name,
      logoUrl,
      addressLines: buildAddressLines({
        addressLine1: invoice.org.addressLine1,
        addressLine2: invoice.org.addressLine2,
        city: invoice.org.city,
        state: invoice.org.state,
        zip: invoice.org.zip,
      }),
      phone: invoice.org.phone,
    },
    customer: {
      name: invoice.customer.name,
      addressLines: [invoice.customer.addressLine || ""].filter(Boolean),
    },
    lineItems: invoice.lineItems.map((lineItem) => ({
      description: lineItem.description,
      quantity: lineItem.quantity.toString(),
      unitPrice: lineItem.unitPrice.toString(),
      subtotal: lineItem.lineTotal.toString(),
    })),
    subtotal: invoice.subtotal.toString(),
    taxLabel: hasTax ? `Tax (${taxRateToPercent(invoice.taxRate)}%)` : null,
    taxAmount: hasTax ? invoice.taxAmount.toString() : null,
    total: invoice.total.toString(),
    notes: invoice.notes,
    paymentTerms: invoice.org.invoicePaymentInstructions,
  };

  return (
    <div className="invoice-detail-shell">
      <section className="card invoice-card">
        <div className="invoice-header-row">
          <div className="stack-cell">
            <Link className="table-link" href={invoicesPath}>
              ← Back to Invoices
            </Link>
            <h2>{formatInvoiceNumber(invoice.invoiceNumber)}</h2>
            <p className="muted">
              {invoice.customer.name} • {invoice.org.name}
            </p>
            <p className="muted" style={{ marginTop: 6 }}>
              {onlinePaymentReady
                ? "Online card payments are ready. Send the invoice email to include a hosted Stripe pay link, or generate one here to share manually."
                : "Payment collection is still tracked manually in this workspace. Until Stripe is fully ready, sending the invoice emails a PDF only."}
            </p>
            <div className="quick-meta">
              <span
                className={`badge invoice-status-badge status-${displayStatus.toLowerCase()}`}
              >
                {formatLabel(displayStatus)}
              </span>
              <span className="badge">
                Total {formatCurrency(invoice.total)}
              </span>
              <span
                className={`badge${balanceBadgeClass ? ` ${balanceBadgeClass}` : ""}`}
              >
                Balance {formatCurrency(invoice.balanceDue)}
              </span>
              <span
                className={`badge ${onlinePaymentReady ? "status-paid" : "status-overdue"}`}
              >
                Online pay {onlinePaymentReady ? "ready" : "not ready"}
              </span>
              {checkoutNeedsAttention ? (
                <span className="badge status-overdue">Payment follow-up needed</span>
              ) : null}
            </div>
            {sentAtLabel ? (
              <p className="invoice-sent-meta">Sent on {sentAtLabel}</p>
            ) : null}
            {reminderHistoryLabel ? (
              <p className="invoice-sent-meta">{reminderHistoryLabel}</p>
            ) : null}
            {latestCollectionAttempt ? (
              <p className="invoice-sent-meta">
                Latest collections activity: {formatLabel(latestCollectionAttempt.source)}{" "}
                {formatLabel(latestCollectionAttempt.outcome).toLowerCase()} on{" "}
                {formatDateTime(latestCollectionAttempt.createdAt)}
              </p>
            ) : null}
          </div>
          <div className="quick-links">
            {operationalJobPath ? (
              <Link className="btn secondary" href={operationalJobPath}>
                Open Operational Job
              </Link>
            ) : null}
            {!operationalJobPath && crmJobPath ? (
              <Link className="btn secondary" href={crmJobPath}>
                Open Lead
              </Link>
            ) : null}
            {operationalJobPath && crmJobPath ? (
              <Link className="btn secondary" href={crmJobPath}>
                Open Lead
              </Link>
            ) : null}
            <a className="btn secondary" href={pdfDownloadPath}>
              Download PDF
            </a>
            {activeCheckoutSession ? (
              <a
                className="btn secondary"
                href={activeCheckoutSession.checkoutUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open Pay Link
              </a>
            ) : (
              <form action={generateInvoicePayLinkAction}>
                <input type="hidden" name="invoiceId" value={invoice.id} />
                <input type="hidden" name="orgId" value={scope.orgId} />
                <input type="hidden" name="returnPath" value={invoicePath} />
                <button
                  className="btn secondary"
                  type="submit"
                  disabled={!onlinePaymentReady}
                >
                  Generate Pay Link
                </button>
              </form>
            )}
            {invoice.collectionAttempts.length > 0 ? (
              <Link className="btn secondary" href={collectionsActivityPath}>
                Collections Activity
              </Link>
            ) : null}
            <SendInvoiceModal
              businessName={invoice.org.legalName?.trim() || invoice.org.name}
              customerEmail={invoice.customer.email}
              customerName={invoice.customer.name}
              invoiceNumber={formatInvoiceNumber(invoice.invoiceNumber)}
              onlinePaymentsAvailable={onlinePaymentReady}
              previewHref={pdfPreviewPath}
              sendHref={`/api/invoices/${invoice.id}/send`}
            />
            {reminderReady ? (
              <SendInvoiceModal
                businessName={invoice.org.legalName?.trim() || invoice.org.name}
                customerEmail={invoice.customer.email}
                customerName={invoice.customer.name}
                defaultRefreshPayLink={onlinePaymentReady && checkoutNeedsAttention}
                invoiceNumber={formatInvoiceNumber(invoice.invoiceNumber)}
                mode="reminder"
                onlinePaymentsAvailable={onlinePaymentReady}
                previewHref={pdfPreviewPath}
                sendHref={`/api/invoices/${invoice.id}/send`}
              />
            ) : null}
            <form action={markInvoicePaidAction}>
              <input type="hidden" name="invoiceId" value={invoice.id} />
              <input type="hidden" name="orgId" value={scope.orgId} />
              <input type="hidden" name="returnPath" value={invoicePath} />
              <input
                type="hidden"
                name="note"
                value="Marked paid manually from invoice detail."
              />
              <button
                className="btn secondary"
                type="submit"
                disabled={invoice.balanceDue.lte(0)}
              >
                Mark Paid Manually
              </button>
            </form>
          </div>
        </div>
      </section>

      <section className="card invoice-card invoice-pdf-preview">
        <div className="invoice-header-row">
          <div className="stack-cell">
            <h2>Client-Ready Invoice</h2>
            <p className="muted">
              Official layout preview using your saved invoice template
              preference.
            </p>
          </div>
          <div className="quick-links">
            <a
              className="btn secondary"
              href={pdfPreviewPath}
              target="_blank"
              rel="noreferrer"
            >
              Preview PDF
            </a>
            <a className="btn primary" href={pdfDownloadPath}>
              Download PDF
            </a>
          </div>
        </div>

        <div className="invoice-sheet-wrap">
          <InvoicePreview
            template={normalizeInvoiceTemplate(invoice.org.invoiceTemplate)}
            invoice={previewData}
          />
        </div>
      </section>

      <section className="grid two-col">
        <article
          className="card"
          id="invoice-details"
          style={{ scrollMarginTop: 24 }}
        >
          <h2>Invoice Details</h2>
          <form
            action={saveInvoiceMetaAction}
            className="auth-form"
            style={{ marginTop: 12 }}
          >
            <input type="hidden" name="invoiceId" value={invoice.id} />
            <input type="hidden" name="orgId" value={scope.orgId} />
            <input type="hidden" name="returnPath" value={invoicePath} />

            <label>
              Status
              <select
                name="status"
                defaultValue={invoice.status}
                autoFocus={focusTarget === "details"}
              >
                {billingInvoiceStatusOptions.map((status) => (
                  <option key={status} value={status}>
                    {formatLabel(status)}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Issue Date
              <input
                type="date"
                name="issueDate"
                defaultValue={toDateInputValue(invoice.issueDate)}
                required
              />
            </label>

            <label>
              Terms
              <select name="terms" defaultValue={invoice.terms}>
                {invoiceTermsOptions.map((option) => (
                  <option key={option} value={option}>
                    {formatInvoiceTermsLabel(option)}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Due Date
              <input
                type="date"
                name="dueDate"
                defaultValue={toDateInputValue(invoice.dueDate)}
                required
              />
            </label>

            <label>
              Tax Rate (%)
              <input
                name="taxRatePercent"
                defaultValue={taxRateToPercent(invoice.taxRate)}
                inputMode="decimal"
              />
            </label>

            <label>
              Notes
              <textarea
                name="notes"
                rows={6}
                maxLength={8000}
                defaultValue={invoice.notes || ""}
              />
            </label>

            <button className="btn primary" type="submit">
              Save Invoice
            </button>
          </form>

          {saved === "meta" ? (
            <p className="form-status">Invoice details saved.</p>
          ) : null}
          {saved === "paid" ? (
            <p className="form-status">Invoice marked paid manually.</p>
          ) : null}
          {error ? (
            <p className="form-status">
              Could not save invoice update ({error}).
            </p>
          ) : null}
        </article>

        <article className="card">
          <h2>Summary</h2>
          <dl className="detail-list" style={{ marginTop: 10 }}>
            <div>
              <dt>Customer</dt>
              <dd>{invoice.customer.name}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{invoice.customer.phoneE164 || "-"}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{invoice.customer.email || "-"}</dd>
            </div>
            <div>
              <dt>Address</dt>
              <dd>{invoice.customer.addressLine || "-"}</dd>
            </div>
            <div>
              <dt>Issue</dt>
              <dd>{formatDateTime(invoice.issueDate)}</dd>
            </div>
            <div>
              <dt>Terms</dt>
              <dd>{formatInvoiceTermsLabel(invoice.terms)}</dd>
            </div>
            <div>
              <dt>Due</dt>
              <dd>{formatDateTime(invoice.dueDate)}</dd>
            </div>
            <div>
              <dt>Subtotal</dt>
              <dd>{formatCurrency(invoice.subtotal)}</dd>
            </div>
            <div>
              <dt>Tax</dt>
              <dd>
                {formatCurrency(invoice.taxAmount)} (
                {taxRateToPercent(invoice.taxRate)}%)
              </dd>
            </div>
            <div>
              <dt>Total</dt>
              <dd>{formatCurrency(invoice.total)}</dd>
            </div>
            <div>
              <dt>Paid</dt>
              <dd>{formatCurrency(invoice.amountPaid)}</dd>
            </div>
            <div>
              <dt>Balance</dt>
              <dd>{formatCurrency(invoice.balanceDue)}</dd>
            </div>
          </dl>
        </article>
      </section>

      <section className="card invoice-card">
        <h2>Line Items</h2>
        {invoice.lineItems.length === 0 ? (
          <p className="muted">No line items yet.</p>
        ) : null}
        <div className="invoice-line-list">
          {invoice.lineItems.map((lineItem) => (
            <form
              key={lineItem.id}
              action={updateLineItemAction}
              className="invoice-line-form"
            >
              <input type="hidden" name="invoiceId" value={invoice.id} />
              <input type="hidden" name="orgId" value={scope.orgId} />
              <input type="hidden" name="returnPath" value={invoicePath} />
              <input type="hidden" name="lineItemId" value={lineItem.id} />

              <input
                name="description"
                defaultValue={lineItem.description}
                maxLength={200}
                required
              />
              <input
                name="quantity"
                defaultValue={lineItem.quantity.toString()}
                inputMode="decimal"
                required
              />
              <input
                name="unitPrice"
                defaultValue={Number(lineItem.unitPrice.toString()).toFixed(2)}
                inputMode="decimal"
                required
              />
              <span className="invoice-line-total">
                {formatCurrency(lineItem.lineTotal)}
              </span>

              <button className="btn secondary" type="submit">
                Save
              </button>
              <button
                className="btn secondary"
                type="submit"
                formAction={deleteLineItemAction}
              >
                Remove
              </button>
            </form>
          ))}
        </div>

        <form
          action={addLineItemAction}
          className="auth-form"
          style={{ marginTop: 14 }}
        >
          <input type="hidden" name="invoiceId" value={invoice.id} />
          <input type="hidden" name="orgId" value={scope.orgId} />
          <input type="hidden" name="returnPath" value={invoicePath} />

          <label>
            Description
            <input
              name="description"
              maxLength={200}
              placeholder="Labor - driveway replacement"
              required
            />
          </label>
          <label>
            Quantity
            <input
              name="quantity"
              defaultValue="1"
              inputMode="decimal"
              required
            />
          </label>
          <label>
            Unit Price
            <input
              name="unitPrice"
              defaultValue="0.00"
              inputMode="decimal"
              required
            />
          </label>

          <button className="btn primary" type="submit">
            Add Line Item
          </button>
        </form>

        {saved === "line" ? (
          <p className="form-status">Line item added.</p>
        ) : null}
        {saved === "line-update" ? (
          <p className="form-status">Line item updated.</p>
        ) : null}
        {saved === "line-delete" ? (
          <p className="form-status">Line item removed.</p>
        ) : null}
      </section>

      <section className="grid two-col">
        <article className="card">
          <h2>Online Payment Link</h2>
          <p className="muted" style={{ marginTop: 6 }}>
            Create a hosted Stripe card checkout for the current balance due.
            The webhook will record successful payments into this invoice automatically.
          </p>
          {!onlinePaymentReady ? (
            <p className="form-status" style={{ marginTop: 12 }}>
              {!webhookConfigured
                ? "STRIPE_WEBHOOK_SECRET is missing, so online invoice payments are blocked."
                : invoice.org.stripeConnection?.status !== "ACTIVE"
                  ? "Stripe must be connected and fully active before you can collect invoice payments online."
                  : invoice.balanceDue.lte(0)
                    ? "This invoice has no remaining balance to collect online."
                    : "Online invoice payments are not ready yet."}
            </p>
          ) : null}

          {activeCheckoutSession ? (
            <div style={{ marginTop: 12 }}>
              <div className="quick-meta">
                <span
                  className={`badge ${
                    activeCheckoutSession.lastError ? "status-overdue" : "status-paid"
                  }`}
                >
                  {activeCheckoutSession.lastError ? "Open pay link with failed attempt" : "Open pay link"}
                </span>
                <span className="badge">
                  Amount {formatCurrency(activeCheckoutSession.amount)}
                </span>
                <span className="badge">
                  Expires{" "}
                  {activeCheckoutSession.expiresAt
                    ? formatDateTime(activeCheckoutSession.expiresAt)
                    : "Stripe-managed"}
                </span>
              </div>
              <div className="quick-links" style={{ marginTop: 12 }}>
                <a
                  className="btn secondary"
                  href={activeCheckoutSession.checkoutUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Hosted Checkout
                </a>
                <form action={generateInvoicePayLinkAction}>
                  <input type="hidden" name="invoiceId" value={invoice.id} />
                  <input type="hidden" name="orgId" value={scope.orgId} />
                  <input type="hidden" name="returnPath" value={invoicePath} />
                  <input type="hidden" name="forceNew" value="1" />
                  <button className="btn secondary" type="submit">
                    Refresh Pay Link
                  </button>
                </form>
              </div>
              {activeCheckoutSession.lastError ? (
                <p className="form-status" style={{ marginTop: 12 }}>
                  Latest payment attempt failed: {activeCheckoutSession.lastError}
                </p>
              ) : null}
              <p className="muted" style={{ marginTop: 10, wordBreak: "break-all" }}>
                Share link: {activeCheckoutSession.checkoutUrl}
              </p>
            </div>
          ) : latestCheckoutSession ? (
            <div style={{ marginTop: 12 }}>
              <p className="muted" style={{ margin: 0 }}>
                Latest checkout status: {formatLabel(latestCheckoutSession.status)}
              </p>
              {latestCheckoutSession.lastError ? (
                <p className="form-status" style={{ marginTop: 12 }}>
                  Latest payment attempt failed: {latestCheckoutSession.lastError}
                </p>
              ) : latestCheckoutSession.status === "EXPIRED" ? (
                <p className="form-status" style={{ marginTop: 12 }}>
                  The last hosted pay link expired before the customer completed payment.
                </p>
              ) : latestCheckoutSession.status === "CANCELED" ? (
                <p className="form-status" style={{ marginTop: 12 }}>
                  The last hosted pay link was replaced. Generate a fresh link before resending the invoice.
                </p>
              ) : null}
              {latestCheckoutSession.completedAt ? (
                <p className="muted" style={{ marginTop: 6 }}>
                  Completed {formatDateTime(latestCheckoutSession.completedAt)}
                </p>
              ) : null}
              <form action={generateInvoicePayLinkAction} style={{ marginTop: 12 }}>
                <input type="hidden" name="invoiceId" value={invoice.id} />
                <input type="hidden" name="orgId" value={scope.orgId} />
                <input type="hidden" name="returnPath" value={invoicePath} />
                <input type="hidden" name="forceNew" value="1" />
                <button
                  className="btn secondary"
                  type="submit"
                  disabled={!onlinePaymentReady}
                >
                  Generate Fresh Pay Link
                </button>
              </form>
            </div>
          ) : (
            <form
              action={generateInvoicePayLinkAction}
              className="auth-form"
              style={{ marginTop: 12 }}
            >
              <input type="hidden" name="invoiceId" value={invoice.id} />
              <input type="hidden" name="orgId" value={scope.orgId} />
              <input type="hidden" name="returnPath" value={invoicePath} />
              <button
                className="btn primary"
                type="submit"
                disabled={!onlinePaymentReady}
              >
                Generate Hosted Pay Link
              </button>
            </form>
          )}

          {saved === "pay-link" ? (
            <p className="form-status">Hosted payment link ready to share.</p>
          ) : null}
          {saved === "pay-link-refresh" ? (
            <p className="form-status">Hosted payment link refreshed.</p>
          ) : null}
          {error === "pay-link-failed" ? (
            <p className="form-status">
              Could not generate the hosted payment link.
            </p>
          ) : null}
          {error === "pay-link-refresh-failed" ? (
            <p className="form-status">
              Could not refresh the hosted payment link.
            </p>
          ) : null}
        </article>

        <article className="card">
          <h2>Record Manual Payment</h2>
          <p className="muted" style={{ marginTop: 6 }}>
            Use this for cash, check, bank transfer, or any offline collection
            that didn&apos;t run through the Stripe pay link.
          </p>
          <form
            action={recordPaymentAction}
            className="auth-form"
            style={{ marginTop: 12 }}
          >
            <input type="hidden" name="invoiceId" value={invoice.id} />
            <input type="hidden" name="orgId" value={scope.orgId} />
            <input type="hidden" name="returnPath" value={invoicePath} />

            <label>
              Amount
              <input
                name="amount"
                defaultValue={paymentDefault}
                inputMode="decimal"
                required
              />
            </label>
            <label>
              Date
              <input
                type="date"
                name="date"
                defaultValue={toDateInputValue(new Date())}
                required
              />
            </label>
            <label>
              Method
              <select name="method" defaultValue="OTHER">
                {manualInvoicePaymentMethodOptions.map((method) => (
                  <option key={method} value={method}>
                    {formatLabel(method)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Note
              <textarea
                name="note"
                rows={3}
                maxLength={500}
                placeholder="Received after completion walkthrough."
              />
            </label>
            <button className="btn primary" type="submit">
              Record Manual Payment
            </button>
          </form>

          {saved === "payment" ? (
            <p className="form-status">Manual payment recorded.</p>
          ) : null}
        </article>

        <article
          className="card"
          id="collections-activity"
          style={{ scrollMarginTop: 24 }}
        >
          <h2>Collections Activity</h2>
          <p className="muted" style={{ marginTop: 6 }}>
            Manual reminders and automated queue sends are logged here so the
            team can see what billing follow-up actually happened.
          </p>
          {invoice.collectionAttempts.length === 0 ? (
            <p className="muted" style={{ marginTop: 12 }}>
              No reminder activity recorded yet.
            </p>
          ) : (
            <>
              <div className="dashboard-stats-grid" style={{ marginTop: 12 }}>
                <div className="dashboard-stat-tile">
                  <span>Manual Sent</span>
                  <strong>{collectionActivitySummary.manualSentCount}</strong>
                </div>
                <div className="dashboard-stat-tile">
                  <span>Auto Sent</span>
                  <strong>{collectionActivitySummary.automatedSentCount}</strong>
                </div>
                <div className="dashboard-stat-tile">
                  <span>Skipped</span>
                  <strong>{collectionActivitySummary.skippedCount}</strong>
                </div>
                <div className="dashboard-stat-tile">
                  <span>Failed</span>
                  <strong>{collectionActivitySummary.failedCount}</strong>
                </div>
              </div>
              {collectionActivitySummary.lastAttemptAt ? (
                <p className="muted" style={{ marginTop: 10 }}>
                  Latest activity:{" "}
                  {formatLabel(collectionActivitySummary.lastAttemptSource || "MANUAL")}{" "}
                  {formatLabel(
                    collectionActivitySummary.lastAttemptOutcome || "SENT",
                  ).toLowerCase()}{" "}
                  on {formatDateTime(collectionActivitySummary.lastAttemptAt)}
                </p>
              ) : null}
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Source</th>
                      <th>Outcome</th>
                      <th>Actor</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.collectionAttempts.map((attempt) => {
                      const actorLabel =
                        attempt.actor?.name?.trim() ||
                        attempt.actor?.email?.trim() ||
                        (attempt.source === "AUTOMATION" ? "System" : "-");
                      const metadata = readInvoiceCollectionAttemptMetadata(
                        attempt.metadataJson,
                      );
                      const queueStageLabel = formatCollectionsQueueStageLabel(
                        metadata.queueStage,
                      );
                      const detailSummary = formatCollectionAttemptDetailSummary({
                        outcome: attempt.outcome,
                        reason: attempt.reason,
                      });

                      return (
                        <tr key={attempt.id}>
                          <td>{formatDateTime(attempt.createdAt)}</td>
                          <td>{formatLabel(attempt.source)}</td>
                          <td>
                            <span
                              className={`badge ${
                                attempt.outcome === "SENT"
                                  ? "status-paid"
                                  : attempt.outcome === "FAILED"
                                    ? "status-overdue"
                                    : "status-sent"
                              }`}
                            >
                              {formatLabel(attempt.outcome)}
                            </span>
                          </td>
                          <td>{actorLabel}</td>
                          <td>
                            <div className="stack-cell">
                              <span>{detailSummary}</span>
                              <div className="quick-meta">
                                {queueStageLabel ? (
                                  <span className="badge">
                                    Queue {queueStageLabel}
                                  </span>
                                ) : null}
                                {metadata.refreshPayLink ? (
                                  <span className="badge">Fresh Pay Link</span>
                                ) : null}
                                {metadata.payLinkIncluded === true ? (
                                  <span className="badge">Pay Link Included</span>
                                ) : metadata.payLinkIncluded === false &&
                                  attempt.outcome === "SENT" ? (
                                  <span className="badge">PDF Only</span>
                                ) : null}
                                {metadata.reminderCount !== null ? (
                                  <span className="muted">
                                    Reminder #{metadata.reminderCount}
                                  </span>
                                ) : null}
                                {metadata.route ===
                                "/api/cron/invoice-collections" ? (
                                  <span className="muted">Collections Cron</span>
                                ) : null}
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </article>

        <article className="card">
          <h2>Payment History</h2>
          {invoice.payments.length === 0 ? (
            <p className="muted">No payments recorded yet.</p>
          ) : (
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Amount</th>
                    <th>Method</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.payments.map((payment) => (
                    <tr key={payment.id}>
                      <td>{formatDateTime(payment.date)}</td>
                      <td>{formatCurrency(payment.amount)}</td>
                      <td>{formatLabel(payment.method)}</td>
                      <td>{payment.note || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </section>
    </div>
  );
}
