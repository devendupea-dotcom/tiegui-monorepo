import { Prisma, type BillingInvoiceStatus, type InvoiceTerms } from "@prisma/client";

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

export const invoicePaymentMethodOptions = ["CASH", "CHECK", "CARD", "TRANSFER", "OTHER"] as const;
export const invoiceTermsOptions: InvoiceTerms[] = [DEFAULT_INVOICE_TERMS, "NET_7", "NET_15", "NET_30"];

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

  if (total.lte(0) || paid.gte(total)) {
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
      job: {
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
