import "server-only";

import { Prisma, type PurchaseOrderStatus } from "@prisma/client";
import { AppApiError } from "@/lib/app-api-permissions";
import { buildValidOperationalJobWhere } from "@/lib/booking-read-model";
import { formatCurrency, parseTaxRatePercent, roundMoney, toMoneyDecimal } from "@/lib/invoices";
import {
  buildPurchaseOrderEmailDraft,
  canTransitionPurchaseOrderStatus,
  PURCHASE_ORDER_LINE_DESCRIPTION_MAX,
  PURCHASE_ORDER_LINE_NAME_MAX,
  PURCHASE_ORDER_LINE_UNIT_MAX,
  PURCHASE_ORDER_MAX_LINES,
  PURCHASE_ORDER_NOTES_MAX,
  purchaseOrderStatusOptions,
  PURCHASE_ORDER_TITLE_MAX,
  PURCHASE_ORDER_VENDOR_ADDRESS_MAX,
  PURCHASE_ORDER_VENDOR_EMAIL_MAX,
  PURCHASE_ORDER_VENDOR_NAME_MAX,
  PURCHASE_ORDER_VENDOR_PHONE_MAX,
  serializePurchaseOrderDetail,
  serializePurchaseOrderListItem,
  type PurchaseOrderDetail,
} from "@/lib/purchase-orders";
import { prisma } from "@/lib/prisma";

const ZERO = new Prisma.Decimal(0);

export const purchaseOrderListInclude = {
  job: {
    select: {
      id: true,
      customerName: true,
      projectType: true,
      address: true,
      status: true,
    },
  },
  _count: {
    select: {
      lineItems: true,
    },
  },
} satisfies Prisma.PurchaseOrderInclude;

export const purchaseOrderDetailInclude = {
  ...purchaseOrderListInclude,
  lineItems: {
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  },
} satisfies Prisma.PurchaseOrderInclude;

type PurchaseOrderPayload = {
  jobId?: unknown;
  vendorName?: unknown;
  vendorEmail?: unknown;
  vendorPhone?: unknown;
  vendorAddress?: unknown;
  title?: unknown;
  notes?: unknown;
  taxRatePercent?: unknown;
  status?: unknown;
  lineItems?: unknown;
};

type PurchaseOrderLineItemPayload = {
  materialId?: unknown;
  name?: unknown;
  description?: unknown;
  quantity?: unknown;
  unit?: unknown;
  unitCost?: unknown;
};

type NormalizedPurchaseOrderLineItem = {
  materialId: string | null;
  sortOrder: number;
  name: string;
  description: string | null;
  quantity: Prisma.Decimal;
  unit: string | null;
  unitCost: Prisma.Decimal;
  total: Prisma.Decimal;
};

type NormalizedPurchaseOrderPayload = {
  jobId: string | null;
  vendorName: string;
  vendorEmail: string | null;
  vendorPhone: string | null;
  vendorAddress: string | null;
  title: string;
  notes: string | null;
  taxRate: Prisma.Decimal;
  subtotal: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  total: Prisma.Decimal;
  status: PurchaseOrderStatus;
  lineItems: NormalizedPurchaseOrderLineItem[];
};

function normalizeRequiredText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new AppApiError(`${label} is required.`, 400);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new AppApiError(`${label} is required.`, 400);
  }

  if (trimmed.length > maxLength) {
    throw new AppApiError(`${label} must be ${maxLength} characters or less.`, 400);
  }

  return trimmed;
}

function normalizeOptionalText(value: unknown, label: string, maxLength: number): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    throw new AppApiError(`${label} must be text.`, 400);
  }

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) {
    throw new AppApiError(`${label} must be ${maxLength} characters or less.`, 400);
  }

  return trimmed;
}

function normalizeOptionalId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeStatus(value: unknown, fallback: PurchaseOrderStatus): PurchaseOrderStatus {
  return purchaseOrderStatusOptions.includes(value as PurchaseOrderStatus)
    ? (value as PurchaseOrderStatus)
    : fallback;
}

function normalizeNonNegativeDecimal(value: unknown, label: string): Prisma.Decimal {
  const normalized =
    typeof value === "string"
      ? value.trim()
      : typeof value === "number"
        ? String(value)
        : value instanceof Prisma.Decimal
          ? value.toString()
          : "";

  const decimal = roundMoney(toMoneyDecimal(normalized || "0"));
  if (decimal.lt(0)) {
    throw new AppApiError(`${label} cannot be negative.`, 400);
  }

  return decimal;
}

function computeLineTotal(quantity: Prisma.Decimal, unitCost: Prisma.Decimal): Prisma.Decimal {
  return roundMoney(quantity.mul(unitCost));
}

async function ensureJobBelongsToOrg(orgId: string, jobId: string | null): Promise<string | null> {
  if (!jobId) return null;

  const job = await prisma.job.findFirst({
    where: {
      id: jobId,
      orgId,
    },
    select: { id: true },
  });

  if (!job) {
    throw new AppApiError("Job not found for this workspace.", 404);
  }

  return job.id;
}

function normalizePurchaseOrderPayload(
  payload: PurchaseOrderPayload | null | undefined,
  fallbackStatus: PurchaseOrderStatus,
): NormalizedPurchaseOrderPayload {
  const vendorName = normalizeRequiredText(payload?.vendorName, "Vendor name", PURCHASE_ORDER_VENDOR_NAME_MAX);
  const vendorEmail = normalizeOptionalText(payload?.vendorEmail, "Vendor email", PURCHASE_ORDER_VENDOR_EMAIL_MAX);
  const vendorPhone = normalizeOptionalText(payload?.vendorPhone, "Vendor phone", PURCHASE_ORDER_VENDOR_PHONE_MAX);
  const vendorAddress = normalizeOptionalText(payload?.vendorAddress, "Vendor address", PURCHASE_ORDER_VENDOR_ADDRESS_MAX);
  const title = normalizeRequiredText(payload?.title, "PO title", PURCHASE_ORDER_TITLE_MAX);
  const notes = normalizeOptionalText(payload?.notes, "Notes", PURCHASE_ORDER_NOTES_MAX);
  const status = normalizeStatus(payload?.status, fallbackStatus);

  const taxRate =
    typeof payload?.taxRatePercent === "string"
      ? parseTaxRatePercent(payload.taxRatePercent)
      : typeof payload?.taxRatePercent === "number"
        ? parseTaxRatePercent(String(payload.taxRatePercent))
        : new Prisma.Decimal(0);

  if (!taxRate) {
    throw new AppApiError("Tax rate must be between 0 and 100.", 400);
  }

  const rawItems = Array.isArray(payload?.lineItems) ? (payload?.lineItems as PurchaseOrderLineItemPayload[]) : [];
  if (rawItems.length === 0) {
    throw new AppApiError("Add at least one PO line item.", 400);
  }
  if (rawItems.length > PURCHASE_ORDER_MAX_LINES) {
    throw new AppApiError(`Purchase orders support up to ${PURCHASE_ORDER_MAX_LINES} line items.`, 400);
  }

  const lineItems = rawItems.map((item, index) => {
    const quantity = normalizeNonNegativeDecimal(item?.quantity, `Line ${index + 1} quantity`);
    const unitCost = normalizeNonNegativeDecimal(item?.unitCost, `Line ${index + 1} unit cost`);
    return {
      materialId: normalizeOptionalId(item?.materialId),
      sortOrder: index,
      name: normalizeRequiredText(item?.name, `Line ${index + 1} name`, PURCHASE_ORDER_LINE_NAME_MAX),
      description: normalizeOptionalText(
        item?.description,
        `Line ${index + 1} description`,
        PURCHASE_ORDER_LINE_DESCRIPTION_MAX,
      ),
      quantity,
      unit: normalizeOptionalText(item?.unit, `Line ${index + 1} unit`, PURCHASE_ORDER_LINE_UNIT_MAX),
      unitCost,
      total: computeLineTotal(quantity, unitCost),
    };
  });

  const subtotal = roundMoney(lineItems.reduce((sum, item) => sum.plus(item.total), ZERO));
  const taxAmount = roundMoney(subtotal.mul(taxRate));
  const total = roundMoney(subtotal.plus(taxAmount));

  return {
    jobId: normalizeOptionalId(payload?.jobId),
    vendorName,
    vendorEmail,
    vendorPhone,
    vendorAddress,
    title,
    notes,
    taxRate,
    subtotal,
    taxAmount,
    total,
    status,
    lineItems,
  };
}

function buildPurchaseOrderNumberCode(prefix: string, date: Date, sequence: number): string {
  const year = date.getUTCFullYear();
  return `${prefix}-${year}-${String(sequence).padStart(4, "0")}`;
}

async function reserveNextPurchaseOrderNumber(
  tx: Prisma.TransactionClient,
  orgId: string,
  issuedAt = new Date(),
): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const org = await tx.organization.findUnique({
      where: { id: orgId },
      select: {
        purchaseOrderPrefix: true,
        purchaseOrderNextNumber: true,
      },
    });

    if (!org) {
      throw new AppApiError("Organization not found.", 404);
    }

    const prefix = (org.purchaseOrderPrefix || "PO").trim() || "PO";
    const reserved = org.purchaseOrderNextNumber;

    const updated = await tx.organization.updateMany({
      where: {
        id: orgId,
        purchaseOrderNextNumber: reserved,
      },
      data: {
        purchaseOrderNextNumber: {
          increment: 1,
        },
      },
    });

    if (updated.count === 1) {
      return buildPurchaseOrderNumberCode(prefix, issuedAt, reserved);
    }
  }

  throw new AppApiError("Failed to reserve purchase order number. Try again.", 500);
}

export async function listPurchaseOrderJobOptions(orgId: string) {
  const jobs = await prisma.job.findMany({
    where: buildValidOperationalJobWhere(orgId),
    select: {
      id: true,
      customerName: true,
      projectType: true,
      address: true,
      status: true,
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 200,
  });

  return jobs.map((job) => ({
    id: job.id,
    customerName: job.customerName,
    projectType: job.projectType,
    address: job.address,
    status: job.status,
  }));
}

export async function getPurchaseOrderDetail(orgId: string, purchaseOrderId: string): Promise<PurchaseOrderDetail> {
  const order = await prisma.purchaseOrder.findFirst({
    where: {
      id: purchaseOrderId,
      orgId,
    },
    include: purchaseOrderDetailInclude,
  });

  if (!order) {
    throw new AppApiError("Purchase order not found.", 404);
  }

  return serializePurchaseOrderDetail(order);
}

export async function savePurchaseOrder(input: {
  orgId: string;
  actorId: string;
  purchaseOrderId?: string | null;
  payload: PurchaseOrderPayload | null;
}): Promise<PurchaseOrderDetail> {
  const existing = input.purchaseOrderId
    ? await prisma.purchaseOrder.findFirst({
        where: {
          id: input.purchaseOrderId,
          orgId: input.orgId,
        },
        include: purchaseOrderDetailInclude,
      })
    : null;

  if (input.purchaseOrderId && !existing) {
    throw new AppApiError("Purchase order not found.", 404);
  }

  const normalized = normalizePurchaseOrderPayload(input.payload, existing?.status || "DRAFT");
  const jobId = await ensureJobBelongsToOrg(input.orgId, normalized.jobId);

  if (existing && !canTransitionPurchaseOrderStatus(existing.status, normalized.status)) {
    throw new AppApiError(`Cannot move PO from ${existing.status} to ${normalized.status}.`, 400);
  }

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    let sentAt: Date | undefined;
    let receivedAt: Date | undefined;

    if (!existing && normalized.status === "SENT") {
      sentAt = now;
    }
    if (!existing && normalized.status === "RECEIVED") {
      receivedAt = now;
      sentAt = now;
    }

    if (existing && existing.status !== "SENT" && normalized.status === "SENT") {
      sentAt = existing.sentAt || now;
    }
    if (existing && existing.status !== "RECEIVED" && normalized.status === "RECEIVED") {
      receivedAt = existing.receivedAt || now;
      if (!existing.sentAt) {
        sentAt = now;
      }
    }

    const order =
      existing === null
        ? await tx.purchaseOrder.create({
            data: {
              orgId: input.orgId,
              createdByUserId: input.actorId,
              jobId,
              poNumber: await reserveNextPurchaseOrderNumber(tx, input.orgId),
              vendorName: normalized.vendorName,
              vendorEmail: normalized.vendorEmail,
              vendorPhone: normalized.vendorPhone,
              vendorAddress: normalized.vendorAddress,
              title: normalized.title,
              status: normalized.status,
              notes: normalized.notes,
              subtotal: normalized.subtotal,
              taxRate: normalized.taxRate,
              taxAmount: normalized.taxAmount,
              total: normalized.total,
              ...(sentAt ? { sentAt } : {}),
              ...(receivedAt ? { receivedAt } : {}),
              lineItems: {
                create: normalized.lineItems.map((lineItem) => ({
                  materialId: lineItem.materialId,
                  sortOrder: lineItem.sortOrder,
                  name: lineItem.name,
                  description: lineItem.description,
                  quantity: lineItem.quantity,
                  unit: lineItem.unit,
                  unitCost: lineItem.unitCost,
                  total: lineItem.total,
                })),
              },
            },
            include: purchaseOrderDetailInclude,
          })
        : await (async () => {
            await tx.purchaseOrderLineItem.deleteMany({
              where: { purchaseOrderId: existing.id },
            });

            return tx.purchaseOrder.update({
              where: { id: existing.id },
              data: {
                jobId,
                vendorName: normalized.vendorName,
                vendorEmail: normalized.vendorEmail,
                vendorPhone: normalized.vendorPhone,
                vendorAddress: normalized.vendorAddress,
                title: normalized.title,
                status: normalized.status,
                notes: normalized.notes,
                subtotal: normalized.subtotal,
                taxRate: normalized.taxRate,
                taxAmount: normalized.taxAmount,
                total: normalized.total,
                ...(sentAt ? { sentAt } : {}),
                ...(receivedAt ? { receivedAt } : {}),
                lineItems: {
                  create: normalized.lineItems.map((lineItem) => ({
                    materialId: lineItem.materialId,
                    sortOrder: lineItem.sortOrder,
                    name: lineItem.name,
                    description: lineItem.description,
                    quantity: lineItem.quantity,
                    unit: lineItem.unit,
                    unitCost: lineItem.unitCost,
                    total: lineItem.total,
                  })),
                },
              },
              include: purchaseOrderDetailInclude,
            });
          })();

    return serializePurchaseOrderDetail(order);
  });
}

export async function cancelPurchaseOrder(orgId: string, purchaseOrderId: string): Promise<void> {
  const existing = await prisma.purchaseOrder.findFirst({
    where: {
      id: purchaseOrderId,
      orgId,
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (!existing) {
    throw new AppApiError("Purchase order not found.", 404);
  }

  if (!canTransitionPurchaseOrderStatus(existing.status, "CANCELLED")) {
    throw new AppApiError("This purchase order cannot be cancelled.", 400);
  }

  await prisma.purchaseOrder.update({
    where: { id: existing.id },
    data: {
      status: "CANCELLED",
    },
  });
}

export async function buildPurchaseOrderSendDraft(input: {
  orgId: string;
  purchaseOrderId: string;
}): Promise<{
  purchaseOrder: PurchaseOrderDetail;
  subject: string;
  body: string;
  mailtoUrl: string | null;
  recipientEmail: string | null;
}> {
  const order = await getPurchaseOrderDetail(input.orgId, input.purchaseOrderId);

  if (!order.vendorEmail) {
    throw new AppApiError("Add a vendor email before preparing this PO email.", 400);
  }

  const draft = buildPurchaseOrderEmailDraft(order);
  return {
    purchaseOrder: order,
    recipientEmail: order.vendorEmail,
    ...draft,
  };
}

export async function listPurchaseOrders(input: {
  orgId: string;
  query?: string;
  status?: string;
  jobId?: string | null;
}) {
  const where: Prisma.PurchaseOrderWhereInput = {
    orgId: input.orgId,
    ...(input.status && purchaseOrderStatusOptions.includes(input.status as PurchaseOrderStatus)
      ? { status: input.status as PurchaseOrderStatus }
      : {}),
    ...(input.jobId ? { jobId: input.jobId } : {}),
    ...(input.query
      ? {
          OR: [
            { poNumber: { contains: input.query, mode: "insensitive" } },
            { vendorName: { contains: input.query, mode: "insensitive" } },
            { title: { contains: input.query, mode: "insensitive" } },
            { vendorEmail: { contains: input.query, mode: "insensitive" } },
            { notes: { contains: input.query, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const orders = await prisma.purchaseOrder.findMany({
    where,
    include: purchaseOrderListInclude,
    orderBy: [{ updatedAt: "desc" }],
    take: 200,
  });

  return orders.map(serializePurchaseOrderListItem);
}

export function summarizePurchaseOrderTotal(total: Prisma.Decimal | number | string | null | undefined): string {
  return formatCurrency(total);
}
