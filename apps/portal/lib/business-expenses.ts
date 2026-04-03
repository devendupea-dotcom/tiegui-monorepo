import type { CalendarAccessRole, Prisma } from "@prisma/client";
import { roundMaterialNumber } from "@/lib/materials";

export const BUSINESS_EXPENSE_VENDOR_MAX = 160;
export const BUSINESS_EXPENSE_CATEGORY_MAX = 80;
export const BUSINESS_EXPENSE_DESCRIPTION_MAX = 200;
export const BUSINESS_EXPENSE_NOTES_MAX = 4000;

export const businessExpenseCategorySuggestions = [
  "Materials",
  "Supplies",
  "Equipment",
  "Fuel",
  "Subcontractor",
  "Permits",
  "Dump Fees",
  "Travel",
  "Meals",
  "Other",
] as const;

export type BusinessExpenseJobSummary = {
  id: string;
  customerName: string;
  projectType: string;
  address: string;
};

export type BusinessExpensePurchaseOrderSummary = {
  id: string;
  poNumber: string;
  title: string;
  status: string;
};

export type BusinessExpenseListItem = {
  id: string;
  expenseDate: string;
  vendorName: string | null;
  category: string;
  description: string;
  amount: number;
  notes: string | null;
  receiptPhotoId: string | null;
  createdAt: string;
  updatedAt: string;
  job: BusinessExpenseJobSummary | null;
  purchaseOrder: BusinessExpensePurchaseOrderSummary | null;
};

type BusinessExpenseRecord = Prisma.BusinessExpenseGetPayload<{
  include: {
    job: {
      select: {
        id: true;
        customerName: true;
        projectType: true;
        address: true;
      };
    };
    purchaseOrder: {
      select: {
        id: true;
        poNumber: true;
        title: true;
        status: true;
      };
    };
    receiptPhoto: {
      select: {
        id: true;
      };
    };
  };
}>;

export function canManageBusinessExpenses(input: {
  internalUser: boolean;
  calendarAccessRole: CalendarAccessRole;
}): boolean {
  return input.internalUser || input.calendarAccessRole !== "READ_ONLY";
}

export function formatExpenseAmountInput(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

export function computeExpenseAmount(value: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return roundMaterialNumber(parsed);
}

function serializeJobSummary(
  job:
    | {
        id: string;
        customerName: string;
        projectType: string;
        address: string;
      }
    | null
    | undefined,
): BusinessExpenseJobSummary | null {
  if (!job) return null;
  return {
    id: job.id,
    customerName: job.customerName,
    projectType: job.projectType,
    address: job.address,
  };
}

function serializePurchaseOrderSummary(
  purchaseOrder:
    | {
        id: string;
        poNumber: string;
        title: string;
        status: string;
      }
    | null
    | undefined,
): BusinessExpensePurchaseOrderSummary | null {
  if (!purchaseOrder) return null;
  return {
    id: purchaseOrder.id,
    poNumber: purchaseOrder.poNumber,
    title: purchaseOrder.title,
    status: purchaseOrder.status,
  };
}

export function serializeBusinessExpense(expense: BusinessExpenseRecord): BusinessExpenseListItem {
  return {
    id: expense.id,
    expenseDate: expense.expenseDate.toISOString(),
    vendorName: expense.vendorName,
    category: expense.category,
    description: expense.description,
    amount: Number(expense.amount),
    notes: expense.notes,
    receiptPhotoId: expense.receiptPhoto?.id || null,
    createdAt: expense.createdAt.toISOString(),
    updatedAt: expense.updatedAt.toISOString(),
    job: serializeJobSummary(expense.job),
    purchaseOrder: serializePurchaseOrderSummary(expense.purchaseOrder),
  };
}
