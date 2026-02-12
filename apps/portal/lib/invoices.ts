import { Prisma, type BillingInvoiceStatus } from "@prisma/client";

const ZERO = new Prisma.Decimal(0);
const ONE_HUNDRED = new Prisma.Decimal(100);

export const billingInvoiceStatusOptions: BillingInvoiceStatus[] = [
  "DRAFT",
  "SENT",
  "PARTIAL",
  "PAID",
  "OVERDUE",
];

export const invoicePaymentMethodOptions = ["CASH", "CHECK", "CARD", "TRANSFER", "OTHER"] as const;

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

export function formatInvoiceNumber(invoiceNumber: number): string {
  return `INV-${String(invoiceNumber).padStart(5, "0")}`;
}

export async function reserveNextInvoiceNumber(tx: Prisma.TransactionClient, orgId: string): Promise<number> {
  const updatedOrg = await tx.organization.update({
    where: { id: orgId },
    data: {
      invoiceSequence: {
        increment: 1,
      },
    },
    select: {
      invoiceSequence: true,
    },
  });

  return updatedOrg.invoiceSequence;
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

function escapePdfText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function createSimplePdf(lines: string[]): Buffer {
  const safeLines = lines.map((line) => line.slice(0, 120));
  const contentParts: string[] = ["BT", "/F1 11 Tf", "50 760 Td", "14 TL"];

  for (let index = 0; index < safeLines.length; index += 1) {
    const escaped = escapePdfText(safeLines[index] || "");
    if (index === 0) {
      contentParts.push(`(${escaped}) Tj`);
    } else {
      contentParts.push("T*");
      contentParts.push(`(${escaped}) Tj`);
    }
  }

  contentParts.push("ET");
  const content = `${contentParts.join("\n")}\n`;
  const contentLength = Buffer.byteLength(content, "utf8");

  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n",
    `4 0 obj\n<< /Length ${contentLength} >>\nstream\n${content}endstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += object;
  }

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "utf8");
}

export function buildInvoicePdfDocument(input: {
  invoiceNumber: number;
  status: BillingInvoiceStatus;
  issueDate: Date;
  dueDate: Date;
  orgName: string;
  customerName: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  customerAddress?: string | null;
  jobLabel?: string | null;
  lineItems: Array<{ description: string; quantity: Prisma.Decimal; unitPrice: Prisma.Decimal; lineTotal: Prisma.Decimal }>;
  subtotal: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  total: Prisma.Decimal;
  amountPaid: Prisma.Decimal;
  balanceDue: Prisma.Decimal;
  notes?: string | null;
}) {
  const dateFormat = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const lines: string[] = [
    `${input.orgName} - Invoice ${formatInvoiceNumber(input.invoiceNumber)}`,
    `Status: ${input.status}`,
    `Issue Date: ${dateFormat.format(input.issueDate)}    Due Date: ${dateFormat.format(input.dueDate)}`,
    "",
    `Bill To: ${input.customerName}`,
    input.customerPhone ? `Phone: ${input.customerPhone}` : "",
    input.customerEmail ? `Email: ${input.customerEmail}` : "",
    input.customerAddress ? `Address: ${input.customerAddress}` : "",
    input.jobLabel ? `Job: ${input.jobLabel}` : "",
    "",
    "Line Items",
    "Description | Qty | Unit Price | Line Total",
    "------------------------------------------------------------",
    ...input.lineItems.map(
      (item) =>
        `${item.description} | ${item.quantity.toString()} | ${formatCurrency(item.unitPrice)} | ${formatCurrency(item.lineTotal)}`,
    ),
    "",
    `Subtotal: ${formatCurrency(input.subtotal)}`,
    `Tax (${taxRateToPercent(input.taxRate)}%): ${formatCurrency(input.taxAmount)}`,
    `Total: ${formatCurrency(input.total)}`,
    `Amount Paid: ${formatCurrency(input.amountPaid)}`,
    `Balance Due: ${formatCurrency(input.balanceDue)}`,
  ];

  if (input.notes?.trim()) {
    lines.push("", "Notes:");
    for (const line of input.notes.split("\n")) {
      lines.push(line.trim());
    }
  }

  if (lines.length > 52) {
    lines.splice(52, lines.length - 52, "... (truncated for PDF page limit)");
  }

  return createSimplePdf(lines.filter(Boolean));
}
