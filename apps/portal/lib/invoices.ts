import { Prisma, type BillingInvoiceStatus, type InvoiceTerms } from "@prisma/client";
import { jobReferencesEstimate } from "@/lib/estimate-job-linking";
import { operationalJobCandidateSelect } from "@/lib/operational-jobs";

const ZERO = new Prisma.Decimal(0);
const ONE_HUNDRED = new Prisma.Decimal(100);
export const DEFAULT_INVOICE_TERMS: InvoiceTerms = "DUE_ON_RECEIPT";

export const billingInvoiceStatusOptions: BillingInvoiceStatus[] = [
  "DRAFT",
  "SENT",
  "PARTIAL",
  "PAID",
  "OVERDUE",
];

export const invoicePaymentMethodOptions = [
  "CASH",
  "CHECK",
  "CARD",
  "STRIPE",
  "TRANSFER",
  "OTHER",
] as const;
export const manualInvoicePaymentMethodOptions = [
  "CASH",
  "CHECK",
  "CARD",
  "TRANSFER",
  "OTHER",
] as const;
export const invoiceTermsOptions: InvoiceTerms[] = [DEFAULT_INVOICE_TERMS, "NET_7", "NET_15", "NET_30"];

type InvoiceLegacyLeadRef = {
  id?: string | null;
  contactName?: string | null;
  businessName?: string | null;
  phoneE164?: string | null;
} | null;

type InvoiceSourceJobRef = {
  id?: string | null;
  leadId?: string | null;
  customerName?: string | null;
  serviceType?: string | null;
  projectType?: string | null;
} | null;

type InvoiceActionLeadRef = {
  id?: string | null;
  fbClickId?: string | null;
  fbBrowserId?: string | null;
} | null;

type InvoiceActionSourceJobRef = {
  id?: string | null;
  leadId?: string | null;
  lead?: InvoiceActionLeadRef;
} | null;

export const invoiceSourceJobLinkSelect = {
  id: true,
  orgId: true,
  legacyLeadId: true,
  sourceEstimateId: true,
  sourceJobId: true,
  customerId: true,
} satisfies Prisma.InvoiceSelect;

export type InvoiceSourceJobLinkRecord = Prisma.InvoiceGetPayload<{
  select: typeof invoiceSourceJobLinkSelect;
}>;

type InvoiceSourceJobLinkClient = Pick<Prisma.TransactionClient, "invoice" | "job">;

type InvoiceSourceJobCandidateRef = Prisma.JobGetPayload<{
  select: typeof operationalJobCandidateSelect;
}>;

export type InvoiceSourceJobResolution = {
  sourceJobId: string | null;
  matchedBy: "existing" | "estimate" | "lead" | null;
  reason: "existing" | "matched_estimate" | "matched_lead" | "ambiguous_estimate" | "ambiguous_lead" | "none";
};

function uniqueSourceJobCandidates(candidates: InvoiceSourceJobCandidateRef[]): InvoiceSourceJobCandidateRef[] {
  return Array.from(new Map(candidates.map((candidate) => [candidate.id, candidate])).values());
}

export function selectConservativeInvoiceSourceJobCandidate(input: {
  candidates: InvoiceSourceJobCandidateRef[];
  sourceEstimateId?: string | null;
  legacyLeadId?: string | null;
  customerId?: string | null;
}): InvoiceSourceJobResolution {
  if (input.candidates.length === 0) {
    return {
      sourceJobId: null,
      matchedBy: null,
      reason: "none",
    };
  }

  const compatibleCandidates = uniqueSourceJobCandidates(
    input.candidates.filter((candidate) => !candidate.customerId || !input.customerId || candidate.customerId === input.customerId),
  );

  if (input.sourceEstimateId) {
    const estimateMatches = compatibleCandidates.filter(
      (candidate) => jobReferencesEstimate(candidate, input.sourceEstimateId),
    );

    if (estimateMatches.length === 1) {
      return {
        sourceJobId: estimateMatches[0]?.id || null,
        matchedBy: "estimate",
        reason: "matched_estimate",
      };
    }

    if (estimateMatches.length > 1) {
      return {
        sourceJobId: null,
        matchedBy: null,
        reason: "ambiguous_estimate",
      };
    }
  }

  if (input.legacyLeadId) {
    const leadMatches = compatibleCandidates.filter((candidate) => candidate.leadId === input.legacyLeadId);
    if (leadMatches.length === 1) {
      return {
        sourceJobId: leadMatches[0]?.id || null,
        matchedBy: "lead",
        reason: "matched_lead",
      };
    }

    if (leadMatches.length > 1) {
      return {
        sourceJobId: null,
        matchedBy: null,
        reason: "ambiguous_lead",
      };
    }
  }

  return {
    sourceJobId: null,
    matchedBy: null,
    reason: "none",
  };
}

export function buildInvoiceWorkerLeadAccessWhere(input: {
  actorId: string;
  invoiceId?: string | null;
}): Prisma.LeadWhereInput {
  const clauses: Prisma.LeadWhereInput[] = [
    { assignedToUserId: input.actorId },
    { createdByUserId: input.actorId },
    { events: { some: { assignedToUserId: input.actorId } } },
    { events: { some: { workerAssignments: { some: { workerUserId: input.actorId } } } } },
  ];

  if (input.invoiceId) {
    clauses.push({ invoices: { some: { id: input.invoiceId } } });
  }

  return {
    OR: clauses,
  };
}

function formatLegacyInvoiceLeadLabel(lead: InvoiceLegacyLeadRef): string | null {
  if (!lead) return null;
  return lead.contactName || lead.businessName || lead.phoneE164 || null;
}

function formatOperationalInvoiceJobLabel(job: InvoiceSourceJobRef): string | null {
  if (!job) return null;
  const customer = job.customerName?.trim() || "";
  const service = job.serviceType?.trim() || job.projectType?.trim() || "";
  if (customer && service) {
    return `${customer} • ${service}`;
  }
  return customer || service || null;
}

export function getInvoiceReadJobContext(input: {
  legacyLeadId?: string | null;
  sourceJobId?: string | null;
  legacyLead?: InvoiceLegacyLeadRef;
  sourceJob?: InvoiceSourceJobRef;
}) {
  const operationalJobId = input.sourceJobId || input.sourceJob?.id || null;
  const crmLeadId = input.legacyLeadId || input.sourceJob?.leadId || input.legacyLead?.id || null;
  const operationalLabel = formatOperationalInvoiceJobLabel(input.sourceJob || null);
  const crmLabel = formatLegacyInvoiceLeadLabel(input.legacyLead || null);

  return {
    operationalJobId,
    crmLeadId,
    operationalLabel,
    crmLabel,
    primaryLabel: operationalLabel || crmLabel || null,
    primaryKind: operationalJobId ? "operational" : crmLeadId ? "crm" : null,
  };
}

export function getInvoiceActionContext(input: {
  legacyLeadId?: string | null;
  sourceJobId?: string | null;
  legacyLead?: InvoiceActionLeadRef;
  sourceJob?: InvoiceActionSourceJobRef;
}) {
  const operationalJobId = input.sourceJobId || input.sourceJob?.id || null;
  const operationalLeadId = input.sourceJob?.leadId || input.sourceJob?.lead?.id || null;
  const legacyLeadId = input.legacyLeadId || input.legacyLead?.id || null;
  const leadId = operationalLeadId || legacyLeadId || null;
  const leadTrackingSource = input.sourceJob?.lead || input.legacyLead || null;

  return {
    operationalJobId,
    operationalLeadId,
    legacyLeadId,
    leadId,
    fbClickId: leadTrackingSource?.fbClickId || null,
    fbBrowserId: leadTrackingSource?.fbBrowserId || null,
  };
}

export function getInvoiceActionRevalidationPaths(input: {
  invoiceId: string;
  leadId?: string | null;
}): string[] {
  const paths = [`/app/invoices/${input.invoiceId}`, "/app/invoices"];
  if (input.leadId) {
    paths.push(`/app/jobs/${input.leadId}`);
  }
  return paths;
}

export async function resolveInvoiceSourceJobLink(
  db: InvoiceSourceJobLinkClient,
  invoice: InvoiceSourceJobLinkRecord,
): Promise<InvoiceSourceJobResolution> {
  if (invoice.sourceJobId) {
    return {
      sourceJobId: invoice.sourceJobId,
      matchedBy: "existing",
      reason: "existing",
    };
  }

  const clauses: Prisma.JobWhereInput[] = [];

  if (invoice.sourceEstimateId) {
    clauses.push({
      orgId: invoice.orgId,
      sourceEstimateId: invoice.sourceEstimateId,
    });
    clauses.push({
      orgId: invoice.orgId,
      linkedEstimateId: invoice.sourceEstimateId,
    });
  }

  if (invoice.legacyLeadId) {
    clauses.push({
      orgId: invoice.orgId,
      leadId: invoice.legacyLeadId,
    });
  }

  if (clauses.length === 0) {
    return {
      sourceJobId: null,
      matchedBy: null,
      reason: "none",
    };
  }

  const candidates = await db.job.findMany({
    where: clauses.length === 1 ? clauses[0] : { OR: clauses },
    select: operationalJobCandidateSelect,
    orderBy: [{ updatedAt: "desc" }],
    take: 12,
  });

  return selectConservativeInvoiceSourceJobCandidate({
    candidates,
    sourceEstimateId: invoice.sourceEstimateId,
    legacyLeadId: invoice.legacyLeadId,
    customerId: invoice.customerId,
  });
}

export async function ensureInvoiceSourceJobLink(
  db: InvoiceSourceJobLinkClient,
  invoiceOrId: string | InvoiceSourceJobLinkRecord,
): Promise<InvoiceSourceJobResolution & { updated: boolean }> {
  const invoice =
    typeof invoiceOrId === "string"
      ? await db.invoice.findUnique({
          where: { id: invoiceOrId },
          select: invoiceSourceJobLinkSelect,
        })
      : invoiceOrId;

  if (!invoice) {
    throw new Error("Invoice not found.");
  }

  const resolution = await resolveInvoiceSourceJobLink(db, invoice);
  if (!resolution.sourceJobId || invoice.sourceJobId === resolution.sourceJobId) {
    return {
      ...resolution,
      updated: false,
    };
  }

  await db.invoice.update({
    where: { id: invoice.id },
    data: {
      sourceJobId: resolution.sourceJobId,
    },
  });

  return {
    ...resolution,
    updated: true,
  };
}

export function normalizeInvoiceTerms(value: unknown): InvoiceTerms {
  return invoiceTermsOptions.includes(value as InvoiceTerms) ? (value as InvoiceTerms) : DEFAULT_INVOICE_TERMS;
}

export function toMoneyDecimal(value: Prisma.Decimal | number | string | null | undefined): Prisma.Decimal {
  if (value === null || value === undefined || value === "") {
    return ZERO;
  }

  if (value instanceof Prisma.Decimal) {
    return value;
  }

  try {
    return new Prisma.Decimal(value);
  } catch {
    return ZERO;
  }
}

export function roundMoney(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function parseMoneyInput(value: string): Prisma.Decimal | null {
  const normalized = value.trim().replace(/[$,\s]/g, "");
  if (!normalized) return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) return null;

  try {
    return roundMoney(new Prisma.Decimal(normalized));
  } catch {
    return null;
  }
}

export function parseTaxRatePercent(value: string): Prisma.Decimal | null {
  const parsed = parseMoneyInput(value);
  if (!parsed) return null;
  if (parsed.lt(0) || parsed.gt(100)) return null;
  return parsed.div(ONE_HUNDRED).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
}

export function taxRateToPercent(value: Prisma.Decimal | number | string | null | undefined): string {
  const asPercent = toMoneyDecimal(value).mul(ONE_HUNDRED);
  return asPercent.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toString();
}

export function computeLineTotal(quantity: Prisma.Decimal, unitPrice: Prisma.Decimal): Prisma.Decimal {
  return roundMoney(quantity.mul(unitPrice));
}

export function deriveInvoiceStatus(input: {
  currentStatus: BillingInvoiceStatus;
  dueDate: Date;
  total: Prisma.Decimal;
  amountPaid: Prisma.Decimal;
  now?: Date;
}): BillingInvoiceStatus {
  const now = input.now || new Date();
  const paid = roundMoney(input.amountPaid);
  const total = roundMoney(input.total);

  // Zero-dollar invoices should stay editable instead of auto-flipping to PAID.
  if (total.lte(0)) {
    return input.currentStatus === "DRAFT" ? "DRAFT" : "SENT";
  }

  if (paid.gte(total)) {
    return "PAID";
  }

  if (paid.gt(0)) {
    return "PARTIAL";
  }

  if (input.currentStatus === "DRAFT") {
    return "DRAFT";
  }

  if (input.dueDate.getTime() < now.getTime()) {
    return "OVERDUE";
  }

  return "SENT";
}

export function shouldRenderInvoicePaidIndicator(input: {
  status: BillingInvoiceStatus;
}): boolean {
  return input.status === "PAID";
}

export function formatCurrency(value: Prisma.Decimal | number | string | null | undefined): string {
  const amount = Number(toMoneyDecimal(value).toString());
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatInvoiceNumber(invoiceNumber: string): string {
  return String(invoiceNumber || "").trim();
}

export function computeInvoiceDueDate(issueDate: Date, terms: InvoiceTerms): Date {
  const normalized = new Date(issueDate);
  const addDays = (days: number) => new Date(normalized.getTime() + days * 24 * 60 * 60 * 1000);

  switch (terms) {
    case "NET_7":
      return addDays(7);
    case "NET_15":
      return addDays(15);
    case "NET_30":
      return addDays(30);
    case "DUE_ON_RECEIPT":
    default:
      return normalized;
  }
}

function buildInvoiceNumberCode(prefix: string, issueDate: Date, sequence: number): string {
  const year = issueDate.getUTCFullYear();
  return `${prefix}-${year}-${String(sequence).padStart(4, "0")}`;
}

export async function reserveNextInvoiceNumber(
  tx: Prisma.TransactionClient,
  orgId: string,
  issueDate = new Date(),
): Promise<string> {
  // Uses optimistic concurrency to avoid duplicate invoice numbers without relying on DB locks.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const org = await tx.organization.findUnique({
      where: { id: orgId },
      select: {
        invoicePrefix: true,
        invoiceNextNumber: true,
      },
    });

    if (!org) {
      throw new Error("Organization not found.");
    }

    const prefix = (org.invoicePrefix || "INV").trim() || "INV";
    const reserved = org.invoiceNextNumber;

    const updated = await tx.organization.updateMany({
      where: {
        id: orgId,
        invoiceNextNumber: reserved,
      },
      data: {
        invoiceNextNumber: {
          increment: 1,
        },
      },
    });

    if (updated.count === 1) {
      return buildInvoiceNumberCode(prefix, issueDate, reserved);
    }
  }

  throw new Error("Failed to reserve invoice number. Try again.");
}

export async function recomputeInvoiceTotals(tx: Prisma.TransactionClient, invoiceId: string) {
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      lineItems: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
      payments: {
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      },
    },
  });

  if (!invoice) {
    throw new Error("Invoice not found.");
  }

  await ensureInvoiceSourceJobLink(tx, {
    id: invoice.id,
    orgId: invoice.orgId,
    legacyLeadId: invoice.legacyLeadId,
    sourceEstimateId: invoice.sourceEstimateId,
    sourceJobId: invoice.sourceJobId,
    customerId: invoice.customerId,
  });

  for (const lineItem of invoice.lineItems) {
    const lineTotal = computeLineTotal(lineItem.quantity, lineItem.unitPrice);
    if (!lineTotal.equals(lineItem.lineTotal)) {
      await tx.invoiceLineItem.update({
        where: { id: lineItem.id },
        data: { lineTotal },
      });
    }
  }

  const freshLineItems = await tx.invoiceLineItem.findMany({
    where: { invoiceId },
    select: { lineTotal: true },
  });

  const subtotal = roundMoney(
    freshLineItems.reduce((sum, line) => sum.plus(line.lineTotal), new Prisma.Decimal(0)),
  );
  const taxAmount = roundMoney(subtotal.mul(invoice.taxRate));
  const total = roundMoney(subtotal.plus(taxAmount));
  const amountPaid = roundMoney(
    invoice.payments.reduce((sum, payment) => sum.plus(payment.amount), new Prisma.Decimal(0)),
  );
  const rawBalance = total.minus(amountPaid);
  const balanceDue = roundMoney(rawBalance.gt(0) ? rawBalance : ZERO);
  const status = deriveInvoiceStatus({
    currentStatus: invoice.status,
    dueDate: invoice.dueDate,
    total,
    amountPaid,
  });

  return tx.invoice.update({
    where: { id: invoiceId },
    data: {
      subtotal,
      taxAmount,
      total,
      amountPaid,
      balanceDue,
      status,
    },
    include: {
      lineItems: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
      payments: {
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
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
        },
      },
      org: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
}

// PDF generation moved to server-only module: lib/invoice-pdf.tsx
