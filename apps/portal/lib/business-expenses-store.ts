import "server-only";

import { Prisma } from "@prisma/client";
import { AppApiError } from "@/lib/app-api-permissions";
import { buildValidOperationalJobWhere } from "@/lib/booking-read-model";
import {
  BUSINESS_EXPENSE_CATEGORY_MAX,
  BUSINESS_EXPENSE_DESCRIPTION_MAX,
  BUSINESS_EXPENSE_NOTES_MAX,
  BUSINESS_EXPENSE_VENDOR_MAX,
  serializeBusinessExpense,
} from "@/lib/business-expenses";
import { roundMoney, toMoneyDecimal } from "@/lib/invoices";
import { prisma } from "@/lib/prisma";

export const businessExpenseInclude = {
  job: {
    select: {
      id: true,
      customerName: true,
      projectType: true,
      address: true,
    },
  },
  purchaseOrder: {
    select: {
      id: true,
      poNumber: true,
      title: true,
      status: true,
    },
  },
  receiptPhoto: {
    select: {
      id: true,
    },
  },
} satisfies Prisma.BusinessExpenseInclude;

type BusinessExpensePayload = {
  jobId?: unknown;
  purchaseOrderId?: unknown;
  expenseDate?: unknown;
  vendorName?: unknown;
  category?: unknown;
  description?: unknown;
  amount?: unknown;
  notes?: unknown;
};

type NormalizedExpensePayload = {
  jobId: string | null;
  purchaseOrderId: string | null;
  expenseDate: Date;
  vendorName: string | null;
  category: string;
  description: string;
  amount: Prisma.Decimal;
  notes: string | null;
};

function normalizeOptionalText(
  value: unknown,
  label: string,
  maxLength: number,
): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    throw new AppApiError(`${label} must be text.`, 400);
  }

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) {
    throw new AppApiError(
      `${label} must be ${maxLength} characters or less.`,
      400,
    );
  }

  return trimmed;
}

function normalizeRequiredText(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    throw new AppApiError(`${label} is required.`, 400);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new AppApiError(`${label} is required.`, 400);
  }
  if (trimmed.length > maxLength) {
    throw new AppApiError(
      `${label} must be ${maxLength} characters or less.`,
      400,
    );
  }

  return trimmed;
}

function normalizeOptionalId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeDate(value: unknown, label: string): Date {
  if (typeof value !== "string") {
    throw new AppApiError(`${label} is required.`, 400);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppApiError(`${label} must be a valid date.`, 400);
  }

  return parsed;
}

function normalizeNonNegativeDecimal(
  value: unknown,
  label: string,
): Prisma.Decimal {
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

function normalizeExpensePayload(
  payload: BusinessExpensePayload | null | undefined,
): NormalizedExpensePayload {
  return {
    jobId: normalizeOptionalId(payload?.jobId),
    purchaseOrderId: normalizeOptionalId(payload?.purchaseOrderId),
    expenseDate: normalizeDate(payload?.expenseDate, "Expense date"),
    vendorName: normalizeOptionalText(
      payload?.vendorName,
      "Vendor name",
      BUSINESS_EXPENSE_VENDOR_MAX,
    ),
    category: normalizeRequiredText(
      payload?.category,
      "Category",
      BUSINESS_EXPENSE_CATEGORY_MAX,
    ),
    description: normalizeRequiredText(
      payload?.description,
      "Description",
      BUSINESS_EXPENSE_DESCRIPTION_MAX,
    ),
    amount: normalizeNonNegativeDecimal(payload?.amount, "Amount"),
    notes: normalizeOptionalText(
      payload?.notes,
      "Notes",
      BUSINESS_EXPENSE_NOTES_MAX,
    ),
  };
}

async function ensureJobBelongsToOrg(
  orgId: string,
  jobId: string | null,
): Promise<string | null> {
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

async function ensurePurchaseOrderBelongsToOrg(input: {
  orgId: string;
  purchaseOrderId: string | null;
  allowedCancelledPurchaseOrderId?: string | null;
}): Promise<string | null> {
  const {
    orgId,
    purchaseOrderId,
    allowedCancelledPurchaseOrderId = null,
  } = input;
  if (!purchaseOrderId) return null;

  const purchaseOrder = await prisma.purchaseOrder.findFirst({
    where: {
      id: purchaseOrderId,
      orgId,
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (!purchaseOrder) {
    throw new AppApiError("Purchase order not found for this workspace.", 404);
  }

  if (
    purchaseOrder.status === "CANCELLED" &&
    purchaseOrder.id !== allowedCancelledPurchaseOrderId
  ) {
    throw new AppApiError(
      "Cancelled purchase orders cannot be linked to expenses.",
      400,
    );
  }

  return purchaseOrder.id;
}

export async function listExpenseReferences(orgId: string) {
  const [jobs, purchaseOrders] = await Promise.all([
    prisma.job.findMany({
      where: buildValidOperationalJobWhere(orgId),
      select: {
        id: true,
        customerName: true,
        projectType: true,
        address: true,
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 200,
    }),
    prisma.purchaseOrder.findMany({
      where: {
        orgId,
        status: {
          not: "CANCELLED",
        },
      },
      select: {
        id: true,
        poNumber: true,
        title: true,
        status: true,
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 200,
    }),
  ]);

  return {
    jobs,
    purchaseOrders,
  };
}

export async function listBusinessExpenses(input: {
  orgId: string;
  query?: string;
  category?: string;
  jobId?: string | null;
}) {
  const where: Prisma.BusinessExpenseWhereInput = {
    orgId: input.orgId,
    ...(input.category ? { category: input.category } : {}),
    ...(input.jobId ? { jobId: input.jobId } : {}),
    ...(input.query
      ? {
          OR: [
            { vendorName: { contains: input.query, mode: "insensitive" } },
            { category: { contains: input.query, mode: "insensitive" } },
            { description: { contains: input.query, mode: "insensitive" } },
            { notes: { contains: input.query, mode: "insensitive" } },
            {
              purchaseOrder: {
                poNumber: { contains: input.query, mode: "insensitive" },
              },
            },
          ],
        }
      : {}),
  };

  const expenses = await prisma.businessExpense.findMany({
    where,
    include: businessExpenseInclude,
    orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
    take: 200,
  });

  return expenses.map(serializeBusinessExpense);
}

export async function getBusinessExpense(orgId: string, expenseId: string) {
  const expense = await prisma.businessExpense.findFirst({
    where: {
      id: expenseId,
      orgId,
    },
    include: businessExpenseInclude,
  });

  if (!expense) {
    throw new AppApiError("Business expense not found.", 404);
  }

  return serializeBusinessExpense(expense);
}

export async function saveBusinessExpense(input: {
  orgId: string;
  actorId: string;
  expenseId?: string | null;
  payload: BusinessExpensePayload | null;
}) {
  const existing = input.expenseId
    ? await prisma.businessExpense.findFirst({
        where: {
          id: input.expenseId,
          orgId: input.orgId,
        },
        include: businessExpenseInclude,
      })
    : null;

  if (input.expenseId && !existing) {
    throw new AppApiError("Business expense not found.", 404);
  }

  const normalized = normalizeExpensePayload(input.payload);
  const [jobId, purchaseOrderId] = await Promise.all([
    ensureJobBelongsToOrg(input.orgId, normalized.jobId),
    ensurePurchaseOrderBelongsToOrg({
      orgId: input.orgId,
      purchaseOrderId: normalized.purchaseOrderId,
      allowedCancelledPurchaseOrderId: existing?.purchaseOrder?.id || null,
    }),
  ]);

  const expense =
    existing === null
      ? await prisma.businessExpense.create({
          data: {
            orgId: input.orgId,
            createdByUserId: input.actorId,
            jobId,
            purchaseOrderId,
            expenseDate: normalized.expenseDate,
            vendorName: normalized.vendorName,
            category: normalized.category,
            description: normalized.description,
            amount: normalized.amount,
            notes: normalized.notes,
          },
          include: businessExpenseInclude,
        })
      : await prisma.businessExpense.update({
          where: { id: existing.id },
          data: {
            jobId,
            purchaseOrderId,
            expenseDate: normalized.expenseDate,
            vendorName: normalized.vendorName,
            category: normalized.category,
            description: normalized.description,
            amount: normalized.amount,
            notes: normalized.notes,
          },
          include: businessExpenseInclude,
        });

  return serializeBusinessExpense(expense);
}

export async function deleteBusinessExpense(orgId: string, expenseId: string) {
  const expense = await prisma.businessExpense.findFirst({
    where: {
      id: expenseId,
      orgId,
    },
    select: { id: true },
  });

  if (!expense) {
    throw new AppApiError("Business expense not found.", 404);
  }

  await prisma.businessExpense.delete({
    where: { id: expense.id },
  });
}

export async function setBusinessExpenseReceipt(input: {
  orgId: string;
  expenseId: string;
  receiptPhotoId: string | null;
}) {
  const expense = await prisma.businessExpense.findFirst({
    where: {
      id: input.expenseId,
      orgId: input.orgId,
    },
    select: { id: true },
  });

  if (!expense) {
    throw new AppApiError("Business expense not found.", 404);
  }

  if (input.receiptPhotoId) {
    const photo = await prisma.photo.findFirst({
      where: {
        id: input.receiptPhotoId,
        orgId: input.orgId,
      },
      select: { id: true },
    });

    if (!photo) {
      throw new AppApiError(
        "Receipt upload not found for this workspace.",
        404,
      );
    }
  }

  const updated = await prisma.businessExpense.update({
    where: { id: expense.id },
    data: {
      receiptPhotoId: input.receiptPhotoId,
    },
    include: businessExpenseInclude,
  });

  return serializeBusinessExpense(updated);
}
