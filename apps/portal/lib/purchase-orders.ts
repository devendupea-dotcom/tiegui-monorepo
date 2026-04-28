import { Prisma, type CalendarAccessRole, type PurchaseOrderStatus } from "@prisma/client";
import { formatCurrency, roundMoney, toMoneyDecimal } from "@/lib/invoices";
import { roundMaterialNumber } from "@/lib/materials";

export const PURCHASE_ORDER_VENDOR_NAME_MAX = 160;
export const PURCHASE_ORDER_VENDOR_EMAIL_MAX = 160;
export const PURCHASE_ORDER_VENDOR_PHONE_MAX = 40;
export const PURCHASE_ORDER_VENDOR_ADDRESS_MAX = 240;
export const PURCHASE_ORDER_TITLE_MAX = 180;
export const PURCHASE_ORDER_NOTES_MAX = 4000;
export const PURCHASE_ORDER_LINE_NAME_MAX = 180;
export const PURCHASE_ORDER_LINE_DESCRIPTION_MAX = 400;
export const PURCHASE_ORDER_LINE_UNIT_MAX = 40;
export const PURCHASE_ORDER_MAX_LINES = 100;

export const purchaseOrderStatusOptions: PurchaseOrderStatus[] = ["DRAFT", "SENT", "RECEIVED", "CANCELLED"];

export type PurchaseOrderJobSummary = {
  id: string;
  customerName: string;
  projectType: string;
  address: string;
  status: string;
};

export type PurchaseOrderLineItemRow = {
  id: string;
  materialId: string | null;
  name: string;
  description: string;
  quantity: string;
  unit: string;
  unitCost: string;
  total: number;
};

export type PurchaseOrderListItem = {
  id: string;
  poNumber: string;
  vendorName: string;
  title: string;
  status: PurchaseOrderStatus;
  subtotal: number;
  taxAmount: number;
  total: number;
  sentAt: string | null;
  receivedAt: string | null;
  updatedAt: string;
  createdAt: string;
  job: PurchaseOrderJobSummary | null;
  lineItemCount: number;
};

export type PurchaseOrderDetail = PurchaseOrderListItem & {
  vendorEmail: string | null;
  vendorPhone: string | null;
  vendorAddress: string | null;
  notes: string | null;
  taxRatePercent: string;
  lineItems: PurchaseOrderLineItemRow[];
};

type PurchaseOrderListRecord = Prisma.PurchaseOrderGetPayload<{
  include: {
    job: {
      select: {
        id: true;
        customerName: true;
        projectType: true;
        address: true;
        status: true;
      };
    };
    _count: {
      select: {
        lineItems: true;
      };
    };
  };
}>;

type PurchaseOrderDetailRecord = Prisma.PurchaseOrderGetPayload<{
  include: {
    job: {
      select: {
        id: true;
        customerName: true;
        projectType: true;
        address: true;
        status: true;
      };
    };
    lineItems: true;
    _count: {
      select: {
        lineItems: true;
      };
    };
  };
}>;

function createId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseInputNumber(value: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return roundMaterialNumber(parsed);
}

export function canManagePurchaseOrders(input: {
  internalUser: boolean;
  calendarAccessRole: CalendarAccessRole;
}): boolean {
  return input.internalUser || input.calendarAccessRole !== "READ_ONLY";
}

export function createEmptyPurchaseOrderLineItem(): PurchaseOrderLineItemRow {
  return {
    id: createId("po-line"),
    materialId: null,
    name: "",
    description: "",
    quantity: "1",
    unit: "each",
    unitCost: "0.00",
    total: 0,
  };
}

export function computePurchaseOrderLineTotal(input: {
  quantity: string;
  unitCost: string;
}): number {
  return roundMaterialNumber(parseInputNumber(input.quantity) * parseInputNumber(input.unitCost));
}

export function canTransitionPurchaseOrderStatus(
  current: PurchaseOrderStatus,
  next: PurchaseOrderStatus,
): boolean {
  if (current === next) return true;

  switch (current) {
    case "DRAFT":
      return next === "SENT" || next === "CANCELLED";
    case "SENT":
      return next === "RECEIVED" || next === "CANCELLED";
    case "RECEIVED":
    case "CANCELLED":
      return false;
    default:
      return false;
  }
}

function serializeJobSummary(
  job:
    | {
        id: string;
        customerName: string;
        projectType: string;
        address: string;
        status: string;
      }
    | null
    | undefined,
): PurchaseOrderJobSummary | null {
  if (!job) return null;
  return {
    id: job.id,
    customerName: job.customerName,
    projectType: job.projectType,
    address: job.address,
    status: job.status,
  };
}

function decimalToInput(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

export function serializePurchaseOrderListItem(order: PurchaseOrderListRecord): PurchaseOrderListItem {
  return {
    id: order.id,
    poNumber: order.poNumber,
    vendorName: order.vendorName,
    title: order.title,
    status: order.status,
    subtotal: Number(order.subtotal),
    taxAmount: Number(order.taxAmount),
    total: Number(order.total),
    sentAt: order.sentAt ? order.sentAt.toISOString() : null,
    receivedAt: order.receivedAt ? order.receivedAt.toISOString() : null,
    updatedAt: order.updatedAt.toISOString(),
    createdAt: order.createdAt.toISOString(),
    job: serializeJobSummary(order.job),
    lineItemCount: order._count.lineItems,
  };
}

export function serializePurchaseOrderDetail(order: PurchaseOrderDetailRecord): PurchaseOrderDetail {
  return {
    ...serializePurchaseOrderListItem(order),
    vendorEmail: order.vendorEmail,
    vendorPhone: order.vendorPhone,
    vendorAddress: order.vendorAddress,
    notes: order.notes,
    taxRatePercent: order.taxRate.mul(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toString(),
    lineItems: order.lineItems.map((lineItem) => ({
      id: lineItem.id,
      materialId: lineItem.materialId,
      name: lineItem.name,
      description: lineItem.description || "",
      quantity: decimalToInput(lineItem.quantity),
      unit: lineItem.unit || "",
      unitCost: decimalToInput(lineItem.unitCost),
      total: Number(lineItem.total),
    })),
  };
}

export function buildPurchaseOrderEmailDraft(order: PurchaseOrderDetail): {
  subject: string;
  body: string;
  mailtoUrl: string | null;
} {
  const subject = `${order.poNumber} • ${order.title}`;
  const lines = [
    `Hi ${order.vendorName},`,
    "",
    `Please see purchase order ${order.poNumber} for the attached job needs.`,
    "",
    `Title: ${order.title}`,
    ...(order.job
      ? [
          `Job: ${order.job.customerName} • ${order.job.projectType}`,
          `Site: ${order.job.address}`,
        ]
      : []),
    "",
    "Line items:",
    ...order.lineItems.map(
      (item) =>
        `- ${item.name}: ${item.quantity} ${item.unit || "each"} @ ${formatCurrency(item.unitCost)} = ${formatCurrency(item.total)}`,
    ),
    "",
    `Subtotal: ${formatCurrency(order.subtotal)}`,
    `Tax: ${formatCurrency(order.taxAmount)}`,
    `Total: ${formatCurrency(order.total)}`,
    ...(order.notes ? ["", "Notes:", order.notes] : []),
    "",
    "Please confirm availability and lead time.",
  ];

  const body = lines.join("\n");
  const recipient = order.vendorEmail?.trim() || "";

  return {
    subject,
    body,
    mailtoUrl: recipient
      ? `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
      : null,
  };
}

export function sumPurchaseOrderLineTotals(
  lineItems: Array<{ total: Prisma.Decimal | number | string | null | undefined }>,
): Prisma.Decimal {
  return roundMoney(lineItems.reduce((sum, item) => sum.plus(toMoneyDecimal(item.total)), new Prisma.Decimal(0)));
}
