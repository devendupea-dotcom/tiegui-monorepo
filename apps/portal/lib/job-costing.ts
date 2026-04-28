import type { BillingInvoiceStatus, CalendarAccessRole, JobStatus } from "@prisma/client";
import { formatCurrency } from "@/lib/invoices";
import { roundMaterialNumber } from "@/lib/materials";

export const JOB_COSTING_NOTES_MAX = 4000;
export const JOB_COSTING_VARIANCE_NOTES_MAX = 1000;
export const JOB_COSTING_LINE_NAME_MAX = 200;
export const JOB_COSTING_LINE_UNIT_MAX = 40;
export const JOB_COSTING_MAX_ROWS = 200;

export type JobCostingProfitBasis = "NONE" | "QUOTED" | "INVOICED";

export type JobCostingEstimateLink = {
  id: string;
  label: string;
  customerName: string;
  total: number;
  updatedAt: string;
  legacy: boolean;
};

export type JobCostingInvoiceLink = {
  id: string;
  invoiceNumber: string;
  status: BillingInvoiceStatus;
  total: number;
  amountPaid: number;
  balanceDue: number;
  issueDate: string;
};

export type JobCostingMaterialRow = {
  id: string;
  materialId: string | null;
  name: string;
  unit: string;
  plannedQuantity: string;
  plannedUnitCost: string;
  plannedTotal: number;
  actualQuantity: string;
  actualUnitCost: string;
  actualTotal: number;
  notes: string;
  varianceNotes: string;
};

export type JobCostingLaborRow = {
  id: string;
  description: string;
  unit: string;
  plannedQuantity: string;
  plannedUnitCost: string;
  plannedTotal: number;
  actualHours: string;
  actualHourlyCost: string;
  actualTotal: number;
  notes: string;
  varianceNotes: string;
};

export type JobCostingSummary = {
  quotedRevenue: number;
  invoicedRevenue: number;
  plannedMaterialCost: number;
  actualMaterialCost: number;
  plannedLaborCost: number;
  actualLaborCost: number;
  plannedCost: number;
  actualCost: number;
  costVariance: number;
  grossProfit: number;
  grossMarginPercent: number;
  plannedGrossProfit: number;
  plannedGrossMarginPercent: number;
  profitBasis: JobCostingProfitBasis;
};

export type JobCostingListItem = {
  id: string;
  customerName: string;
  address: string;
  projectType: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  costingNotes: string;
  quotedRevenue: number;
  invoicedRevenue: number;
  plannedCost: number;
  actualCost: number;
  grossProfit: number;
  grossMarginPercent: number;
  profitBasis: JobCostingProfitBasis;
  linkedInvoiceCount: number;
  sourceEstimate: JobCostingEstimateLink | null;
};

export type JobCostingDetail = JobCostingListItem & {
  notes: string;
  summary: JobCostingSummary;
  sourceInvoices: JobCostingInvoiceLink[];
  materials: JobCostingMaterialRow[];
  labor: JobCostingLaborRow[];
};

function createId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseInputNumber(value: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return 0;
  if (parsed < 0) return 0;
  return roundMaterialNumber(parsed);
}

export function canManageJobCosting(input: {
  internalUser: boolean;
  calendarAccessRole: CalendarAccessRole;
}): boolean {
  return input.internalUser || input.calendarAccessRole !== "READ_ONLY";
}

export function createEmptyJobCostingMaterial(): JobCostingMaterialRow {
  return {
    id: createId("job-costing-material"),
    materialId: null,
    name: "",
    unit: "each",
    plannedQuantity: "1",
    plannedUnitCost: "0.00",
    plannedTotal: 0,
    actualQuantity: "",
    actualUnitCost: "",
    actualTotal: 0,
    notes: "",
    varianceNotes: "",
  };
}

export function createEmptyJobCostingLabor(): JobCostingLaborRow {
  return {
    id: createId("job-costing-labor"),
    description: "",
    unit: "hours",
    plannedQuantity: "1",
    plannedUnitCost: "0.00",
    plannedTotal: 0,
    actualHours: "",
    actualHourlyCost: "",
    actualTotal: 0,
    notes: "",
    varianceNotes: "",
  };
}

export function computePlannedJobCost(input: {
  quantity: string;
  unitCost: string;
}): number {
  const quantity = parseInputNumber(input.quantity);
  const unitCost = parseInputNumber(input.unitCost);
  return roundMaterialNumber(quantity * unitCost);
}

export function computeActualJobCost(input: {
  quantity: string;
  unitCost: string;
}): number {
  const quantity = parseInputNumber(input.quantity);
  const unitCost = parseInputNumber(input.unitCost);
  return roundMaterialNumber(quantity * unitCost);
}

export function summarizeJobCosting(input: {
  quotedRevenue: number;
  invoicedRevenue: number;
  materials: JobCostingMaterialRow[];
  labor: JobCostingLaborRow[];
}): JobCostingSummary {
  const plannedMaterialCost = roundMaterialNumber(
    input.materials.reduce((sum, row) => sum + computePlannedJobCost({
      quantity: row.plannedQuantity,
      unitCost: row.plannedUnitCost,
    }), 0),
  );
  const actualMaterialCost = roundMaterialNumber(
    input.materials.reduce((sum, row) => sum + computeActualJobCost({
      quantity: row.actualQuantity,
      unitCost: row.actualUnitCost,
    }), 0),
  );
  const plannedLaborCost = roundMaterialNumber(
    input.labor.reduce((sum, row) => sum + computePlannedJobCost({
      quantity: row.plannedQuantity,
      unitCost: row.plannedUnitCost,
    }), 0),
  );
  const actualLaborCost = roundMaterialNumber(
    input.labor.reduce((sum, row) => sum + computeActualJobCost({
      quantity: row.actualHours,
      unitCost: row.actualHourlyCost,
    }), 0),
  );
  const plannedCost = roundMaterialNumber(plannedMaterialCost + plannedLaborCost);
  const actualCost = roundMaterialNumber(actualMaterialCost + actualLaborCost);
  const costVariance = roundMaterialNumber(actualCost - plannedCost);

  const profitBasis: JobCostingProfitBasis =
    input.invoicedRevenue > 0 ? "INVOICED" : input.quotedRevenue > 0 ? "QUOTED" : "NONE";
  const revenueBasis = profitBasis === "INVOICED" ? input.invoicedRevenue : input.quotedRevenue;
  const grossProfit = roundMaterialNumber(revenueBasis - actualCost);
  const grossMarginPercent =
    revenueBasis > 0 ? roundMaterialNumber((grossProfit / revenueBasis) * 100) : 0;
  const plannedGrossProfit = roundMaterialNumber(input.quotedRevenue - plannedCost);
  const plannedGrossMarginPercent =
    input.quotedRevenue > 0 ? roundMaterialNumber((plannedGrossProfit / input.quotedRevenue) * 100) : 0;

  return {
    quotedRevenue: roundMaterialNumber(input.quotedRevenue),
    invoicedRevenue: roundMaterialNumber(input.invoicedRevenue),
    plannedMaterialCost,
    actualMaterialCost,
    plannedLaborCost,
    actualLaborCost,
    plannedCost,
    actualCost,
    costVariance,
    grossProfit,
    grossMarginPercent,
    plannedGrossProfit,
    plannedGrossMarginPercent,
    profitBasis,
  };
}

export function formatJobCostingCurrency(value: number): string {
  return formatCurrency(value);
}

export function formatJobCostingMargin(value: number): string {
  return `${roundMaterialNumber(value).toFixed(1)}%`;
}

export function formatJobCostingProfitBasis(value: JobCostingProfitBasis): string {
  if (value === "INVOICED") return "Invoiced revenue";
  if (value === "QUOTED") return "Quoted revenue";
  return "No revenue";
}
