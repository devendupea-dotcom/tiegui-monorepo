import "server-only";

import { Prisma, type JobStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  JOB_COSTING_LINE_NAME_MAX,
  JOB_COSTING_LINE_UNIT_MAX,
  JOB_COSTING_MAX_ROWS,
  JOB_COSTING_NOTES_MAX,
  JOB_COSTING_VARIANCE_NOTES_MAX,
  summarizeJobCosting,
  type JobCostingDetail,
  type JobCostingEstimateLink,
  type JobCostingInvoiceLink,
  type JobCostingLaborRow,
  type JobCostingListItem,
  type JobCostingMaterialRow,
} from "@/lib/job-costing";
import { roundMoney, toMoneyDecimal } from "@/lib/invoices";
import { computeJobLineTotal, jobStatusOptions } from "@/lib/job-records";
import { AppApiError } from "@/lib/app-api-permissions";

const ZERO = new Prisma.Decimal(0);

const costingEstimateSelect = {
  id: true,
  estimateNumber: true,
  title: true,
  customerName: true,
  total: true,
  updatedAt: true,
} satisfies Prisma.EstimateSelect;

const costingLegacyEstimateSelect = {
  id: true,
  projectName: true,
  customerName: true,
  finalTotal: true,
  updatedAt: true,
} satisfies Prisma.EstimateDraftSelect;

const costingInvoiceSelect = {
  id: true,
  invoiceNumber: true,
  status: true,
  total: true,
  amountPaid: true,
  balanceDue: true,
  issueDate: true,
} satisfies Prisma.InvoiceSelect;

const costingMaterialSelect = {
  id: true,
  materialId: true,
  name: true,
  quantity: true,
  unit: true,
  cost: true,
  total: true,
  notes: true,
  actualQuantity: true,
  actualUnitCost: true,
  actualTotal: true,
  varianceNotes: true,
} satisfies Prisma.JobMaterialSelect;

const costingLaborSelect = {
  id: true,
  description: true,
  quantity: true,
  unit: true,
  cost: true,
  total: true,
  notes: true,
  actualHours: true,
  actualHourlyCost: true,
  actualTotal: true,
  varianceNotes: true,
} satisfies Prisma.JobLaborSelect;

export const jobCostingListInclude = {
  sourceEstimate: {
    select: costingEstimateSelect,
  },
  estimateDraft: {
    select: costingLegacyEstimateSelect,
  },
  sourceInvoices: {
    select: costingInvoiceSelect,
    orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
  },
  materials: {
    select: costingMaterialSelect,
  },
  labor: {
    select: costingLaborSelect,
  },
} satisfies Prisma.JobInclude;

export const jobCostingDetailInclude = {
  ...jobCostingListInclude,
} satisfies Prisma.JobInclude;

type JobCostingRecord = Prisma.JobGetPayload<{
  include: typeof jobCostingDetailInclude;
}>;

type JobCostingListRecord = Prisma.JobGetPayload<{
  include: typeof jobCostingListInclude;
}>;

type JobCostingUpdatePayload = {
  costingNotes?: unknown;
};

type JobCostingMaterialPayload = {
  materialId?: unknown;
  name?: unknown;
  unit?: unknown;
  plannedQuantity?: unknown;
  plannedUnitCost?: unknown;
  actualQuantity?: unknown;
  actualUnitCost?: unknown;
  varianceNotes?: unknown;
};

type JobCostingLaborPayload = {
  description?: unknown;
  unit?: unknown;
  plannedQuantity?: unknown;
  plannedUnitCost?: unknown;
  actualHours?: unknown;
  actualHourlyCost?: unknown;
  varianceNotes?: unknown;
};

type NormalizedMaterialMutation = {
  materialId: string | null;
  name: string;
  unit: string | null;
  quantity: Prisma.Decimal;
  cost: Prisma.Decimal;
  actualQuantity: Prisma.Decimal | null;
  actualUnitCost: Prisma.Decimal | null;
  actualTotal: Prisma.Decimal;
  varianceNotes: string | null;
  notes: string | null;
};

type NormalizedLaborMutation = {
  description: string;
  unit: string | null;
  quantity: Prisma.Decimal;
  cost: Prisma.Decimal;
  actualHours: Prisma.Decimal | null;
  actualHourlyCost: Prisma.Decimal | null;
  actualTotal: Prisma.Decimal;
  varianceNotes: string | null;
  notes: string | null;
};

function normalizeOptionalId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
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

function normalizeRequiredText(value: unknown, label: string, maxLength: number): string {
  const trimmed = normalizeOptionalText(value, label, maxLength);
  if (!trimmed) {
    throw new AppApiError(`${label} is required.`, 400);
  }
  return trimmed;
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

function normalizeNullableDecimal(value: unknown, label: string): Prisma.Decimal | null {
  if (value == null || value === "") return null;
  return normalizeNonNegativeDecimal(value, label);
}

function decimalToInput(value: Prisma.Decimal | null | undefined): string {
  if (!value) return "";
  return value.toFixed(2).replace(/\.00$/, "");
}

function decimalToMoneyInput(value: Prisma.Decimal | null | undefined): string {
  if (!value) return "";
  return value.toFixed(2);
}

function serializeEstimateLink(record: JobCostingListRecord): JobCostingEstimateLink | null {
  if (record.sourceEstimate) {
    return {
      id: record.sourceEstimate.id,
      label: `${record.sourceEstimate.estimateNumber} · ${record.sourceEstimate.title}`,
      customerName: record.sourceEstimate.customerName || "",
      total: Number(record.sourceEstimate.total),
      updatedAt: record.sourceEstimate.updatedAt.toISOString(),
      legacy: false,
    };
  }
  if (!record.estimateDraft) return null;
  return {
    id: record.estimateDraft.id,
    label: record.estimateDraft.projectName,
    customerName: record.estimateDraft.customerName || "",
    total: Number(record.estimateDraft.finalTotal),
    updatedAt: record.estimateDraft.updatedAt.toISOString(),
    legacy: true,
  };
}

function serializeInvoiceLink(
  invoice: JobCostingListRecord["sourceInvoices"][number],
): JobCostingInvoiceLink {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    total: Number(invoice.total),
    amountPaid: Number(invoice.amountPaid),
    balanceDue: Number(invoice.balanceDue),
    issueDate: invoice.issueDate.toISOString(),
  };
}

function serializeMaterialRow(
  row: JobCostingListRecord["materials"][number],
): JobCostingMaterialRow {
  const plannedTotal = Number(roundMoney(row.quantity.mul(row.cost)));
  return {
    id: row.id,
    materialId: row.materialId,
    name: row.name,
    unit: row.unit || "",
    plannedQuantity: decimalToInput(row.quantity),
    plannedUnitCost: decimalToMoneyInput(row.cost),
    plannedTotal,
    actualQuantity: decimalToInput(row.actualQuantity),
    actualUnitCost: decimalToMoneyInput(row.actualUnitCost),
    actualTotal: Number(row.actualTotal),
    notes: row.notes || "",
    varianceNotes: row.varianceNotes || "",
  };
}

function serializeLaborRow(
  row: JobCostingListRecord["labor"][number],
): JobCostingLaborRow {
  const plannedTotal = Number(roundMoney(row.quantity.mul(row.cost)));
  return {
    id: row.id,
    description: row.description,
    unit: row.unit || "",
    plannedQuantity: decimalToInput(row.quantity),
    plannedUnitCost: decimalToMoneyInput(row.cost),
    plannedTotal,
    actualHours: decimalToInput(row.actualHours),
    actualHourlyCost: decimalToMoneyInput(row.actualHourlyCost),
    actualTotal: Number(row.actualTotal),
    notes: row.notes || "",
    varianceNotes: row.varianceNotes || "",
  };
}

function buildSummary(record: JobCostingListRecord) {
  const sourceEstimate = serializeEstimateLink(record);
  const sourceInvoices = record.sourceInvoices.map(serializeInvoiceLink);
  const materials = record.materials.map(serializeMaterialRow);
  const labor = record.labor.map(serializeLaborRow);
  const quotedRevenue = sourceEstimate?.total || 0;
  const invoicedRevenue = sourceInvoices.reduce((sum, invoice) => sum + invoice.total, 0);
  return summarizeJobCosting({
    quotedRevenue,
    invoicedRevenue,
    materials,
    labor,
  });
}

function serializeJobCostingListItem(record: JobCostingListRecord): JobCostingListItem {
  const sourceEstimate = serializeEstimateLink(record);
  const summary = buildSummary(record);
  return {
    id: record.id,
    customerName: record.customerName,
    address: record.address,
    projectType: record.projectType,
    status: record.status,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    costingNotes: record.costingNotes || "",
    quotedRevenue: summary.quotedRevenue,
    invoicedRevenue: summary.invoicedRevenue,
    plannedCost: summary.plannedCost,
    actualCost: summary.actualCost,
    grossProfit: summary.grossProfit,
    grossMarginPercent: summary.grossMarginPercent,
    profitBasis: summary.profitBasis,
    linkedInvoiceCount: record.sourceInvoices.length,
    sourceEstimate,
  };
}

function serializeJobCostingDetail(record: JobCostingRecord): JobCostingDetail {
  const materials = record.materials.map(serializeMaterialRow);
  const labor = record.labor.map(serializeLaborRow);
  const sourceInvoices = record.sourceInvoices.map(serializeInvoiceLink);
  const base = serializeJobCostingListItem(record);
  const summary = summarizeJobCosting({
    quotedRevenue: base.quotedRevenue,
    invoicedRevenue: base.invoicedRevenue,
    materials,
    labor,
  });

  return {
    ...base,
    notes: record.notes || "",
    summary,
    sourceInvoices,
    materials,
    labor,
  };
}

export function buildJobCostingWhere(input: {
  orgId: string;
  query: string;
  status: string;
}): Prisma.JobWhereInput {
  const normalizedStatus = input.status.trim().toUpperCase();
  const query = input.query.trim();
  return {
    orgId: input.orgId,
    ...(jobStatusOptions.includes(normalizedStatus as JobStatus)
      ? { status: normalizedStatus as JobStatus }
      : {}),
    ...(query
      ? {
          OR: [
            { customerName: { contains: query, mode: "insensitive" } },
            { address: { contains: query, mode: "insensitive" } },
            { projectType: { contains: query, mode: "insensitive" } },
            { notes: { contains: query, mode: "insensitive" } },
            { costingNotes: { contains: query, mode: "insensitive" } },
            { sourceEstimate: { is: { title: { contains: query, mode: "insensitive" } } } },
            { sourceEstimate: { is: { estimateNumber: { contains: query, mode: "insensitive" } } } },
            { sourceEstimate: { is: { customerName: { contains: query, mode: "insensitive" } } } },
            { estimateDraft: { is: { projectName: { contains: query, mode: "insensitive" } } } },
            { estimateDraft: { is: { customerName: { contains: query, mode: "insensitive" } } } },
            { sourceInvoices: { some: { invoiceNumber: { contains: query, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };
}

export async function getJobCostingOverview(input: {
  orgId: string;
  query: string;
  status: string;
}) {
  const jobs = await prisma.job.findMany({
    where: buildJobCostingWhere(input),
    include: jobCostingListInclude,
    orderBy: [{ updatedAt: "desc" }],
    take: 200,
  });

  return jobs.map(serializeJobCostingListItem);
}

export async function getJobCostingForOrg(input: {
  orgId: string;
  jobId: string;
}) {
  const job = await prisma.job.findFirst({
    where: {
      id: input.jobId,
      orgId: input.orgId,
    },
    include: jobCostingDetailInclude,
  });

  return job ? serializeJobCostingDetail(job) : null;
}

export async function updateJobCosting(input: {
  orgId: string;
  jobId: string;
  costingNotes: unknown;
}) {
  const job = await prisma.job.findFirst({
    where: {
      id: input.jobId,
      orgId: input.orgId,
    },
    select: { id: true },
  });

  if (!job) {
    throw new AppApiError("Job not found.", 404);
  }

  await prisma.job.update({
    where: { id: input.jobId },
    data: {
      costingNotes: normalizeOptionalText(input.costingNotes, "Costing notes", JOB_COSTING_NOTES_MAX),
    },
  });

  const refreshed = await prisma.job.findUnique({
    where: { id: input.jobId },
    include: jobCostingDetailInclude,
  });

  if (!refreshed) {
    throw new Error("Failed to reload job costing.");
  }

  return serializeJobCostingDetail(refreshed);
}

function normalizeActualPair(input: {
  quantity: unknown;
  unitCost: unknown;
  quantityLabel: string;
  unitCostLabel: string;
}) {
  const quantity = normalizeNullableDecimal(input.quantity, input.quantityLabel);
  const unitCost = normalizeNullableDecimal(input.unitCost, input.unitCostLabel);

  if ((quantity && !unitCost) || (!quantity && unitCost)) {
    throw new AppApiError(`Enter both ${input.quantityLabel.toLowerCase()} and ${input.unitCostLabel.toLowerCase()}.`, 400);
  }

  return {
    quantity,
    unitCost,
    total: quantity && unitCost ? roundMoney(quantity.mul(unitCost)) : ZERO,
  };
}

async function normalizeMaterialMutation(input: {
  orgId: string;
  payload: JobCostingMaterialPayload | null;
  existing?: {
    markupPercent: Prisma.Decimal;
    notes: string | null;
  };
}) {
  const payload = input.payload || {};
  const materialId = normalizeOptionalId(payload.materialId);
  const linkedMaterial = materialId
    ? await prisma.material.findFirst({
        where: {
          id: materialId,
          orgId: input.orgId,
        },
        select: {
          id: true,
          name: true,
          unit: true,
          baseCost: true,
          notes: true,
        },
      })
    : null;

  if (materialId && !linkedMaterial) {
    throw new AppApiError("Material not found for this organization.", 400);
  }

  const quantity = normalizeNonNegativeDecimal(payload.plannedQuantity ?? "1", "Planned quantity");
  const cost = normalizeNonNegativeDecimal(
    payload.plannedUnitCost ?? (linkedMaterial ? String(linkedMaterial.baseCost) : "0"),
    "Planned unit cost",
  );
  const actual = normalizeActualPair({
    quantity: payload.actualQuantity,
    unitCost: payload.actualUnitCost,
    quantityLabel: "Actual quantity",
    unitCostLabel: "Actual unit cost",
  });

  return {
    materialId: linkedMaterial?.id || materialId,
    name:
      normalizeOptionalText(payload.name, "Material name", JOB_COSTING_LINE_NAME_MAX) ||
      linkedMaterial?.name ||
      "Material",
    unit:
      normalizeOptionalText(payload.unit, "Material unit", JOB_COSTING_LINE_UNIT_MAX) ||
      linkedMaterial?.unit ||
      null,
    quantity,
    cost,
    actualQuantity: actual.quantity,
    actualUnitCost: actual.unitCost,
    actualTotal: actual.total,
    varianceNotes: normalizeOptionalText(
      payload.varianceNotes,
      "Variance notes",
      JOB_COSTING_VARIANCE_NOTES_MAX,
    ),
    notes: input.existing?.notes ?? linkedMaterial?.notes ?? null,
  } satisfies NormalizedMaterialMutation;
}

async function normalizeLaborMutation(input: {
  payload: JobCostingLaborPayload | null;
  existing?: {
    notes: string | null;
  };
}) {
  const payload = input.payload || {};
  const quantity = normalizeNonNegativeDecimal(payload.plannedQuantity ?? "1", "Planned hours");
  const cost = normalizeNonNegativeDecimal(payload.plannedUnitCost ?? "0", "Planned hourly cost");
  const actual = normalizeActualPair({
    quantity: payload.actualHours,
    unitCost: payload.actualHourlyCost,
    quantityLabel: "Actual hours",
    unitCostLabel: "Actual hourly cost",
  });

  return {
    description: normalizeRequiredText(payload.description, "Labor description", JOB_COSTING_LINE_NAME_MAX),
    unit: normalizeOptionalText(payload.unit, "Labor unit", JOB_COSTING_LINE_UNIT_MAX) || "hours",
    quantity,
    cost,
    actualHours: actual.quantity,
    actualHourlyCost: actual.unitCost,
    actualTotal: actual.total,
    varianceNotes: normalizeOptionalText(
      payload.varianceNotes,
      "Variance notes",
      JOB_COSTING_VARIANCE_NOTES_MAX,
    ),
    notes: input.existing?.notes ?? null,
  } satisfies NormalizedLaborMutation;
}

export async function createJobCostingMaterial(input: {
  orgId: string;
  jobId: string;
  payload: JobCostingMaterialPayload | null;
}) {
  const job = await prisma.job.findFirst({
    where: {
      id: input.jobId,
      orgId: input.orgId,
    },
    select: { id: true },
  });

  if (!job) {
    throw new AppApiError("Job not found.", 404);
  }

  const materialRowCount = await prisma.jobMaterial.count({
    where: {
      jobId: input.jobId,
      orgId: input.orgId,
    },
  });
  if (materialRowCount >= JOB_COSTING_MAX_ROWS) {
    throw new AppApiError(`Job costing supports up to ${JOB_COSTING_MAX_ROWS} material rows.`, 400);
  }

  const normalized = await normalizeMaterialMutation({
    orgId: input.orgId,
    payload: input.payload,
  });

  await prisma.jobMaterial.create({
    data: {
      orgId: input.orgId,
      jobId: input.jobId,
      materialId: normalized.materialId,
      name: normalized.name,
      quantity: normalized.quantity,
      unit: normalized.unit,
      cost: normalized.cost,
      markupPercent: ZERO,
      total: roundMoney(toMoneyDecimal(computeJobLineTotal({
        quantity: normalized.quantity.toString(),
        cost: normalized.cost.toString(),
        markupPercent: "0",
      }))),
      actualQuantity: normalized.actualQuantity,
      actualUnitCost: normalized.actualUnitCost,
      actualTotal: normalized.actualTotal,
      notes: normalized.notes,
      varianceNotes: normalized.varianceNotes,
    },
  });

  return getJobCostingForOrg({
    orgId: input.orgId,
    jobId: input.jobId,
  });
}

export async function updateJobCostingMaterial(input: {
  orgId: string;
  jobId: string;
  itemId: string;
  payload: JobCostingMaterialPayload | null;
}) {
  const existing = await prisma.jobMaterial.findFirst({
    where: {
      id: input.itemId,
      jobId: input.jobId,
      orgId: input.orgId,
    },
    select: {
      id: true,
      markupPercent: true,
      notes: true,
    },
  });

  if (!existing) {
    throw new AppApiError("Job material row not found.", 404);
  }

  const normalized = await normalizeMaterialMutation({
    orgId: input.orgId,
    payload: input.payload,
    existing,
  });

  await prisma.jobMaterial.update({
    where: { id: input.itemId },
    data: {
      materialId: normalized.materialId,
      name: normalized.name,
      quantity: normalized.quantity,
      unit: normalized.unit,
      cost: normalized.cost,
      total: roundMoney(toMoneyDecimal(computeJobLineTotal({
        quantity: normalized.quantity.toString(),
        cost: normalized.cost.toString(),
        markupPercent: existing.markupPercent.toString(),
      }))),
      actualQuantity: normalized.actualQuantity,
      actualUnitCost: normalized.actualUnitCost,
      actualTotal: normalized.actualTotal,
      varianceNotes: normalized.varianceNotes,
    },
  });

  return getJobCostingForOrg({
    orgId: input.orgId,
    jobId: input.jobId,
  });
}

export async function deleteJobCostingMaterial(input: {
  orgId: string;
  jobId: string;
  itemId: string;
}) {
  const deleted = await prisma.jobMaterial.deleteMany({
    where: {
      id: input.itemId,
      jobId: input.jobId,
      orgId: input.orgId,
    },
  });

  if (deleted.count !== 1) {
    throw new AppApiError("Job material row not found.", 404);
  }

  return getJobCostingForOrg({
    orgId: input.orgId,
    jobId: input.jobId,
  });
}

export async function createJobCostingLabor(input: {
  orgId: string;
  jobId: string;
  payload: JobCostingLaborPayload | null;
}) {
  const job = await prisma.job.findFirst({
    where: {
      id: input.jobId,
      orgId: input.orgId,
    },
    select: { id: true },
  });

  if (!job) {
    throw new AppApiError("Job not found.", 404);
  }

  const laborRowCount = await prisma.jobLabor.count({
    where: {
      jobId: input.jobId,
      orgId: input.orgId,
    },
  });
  if (laborRowCount >= JOB_COSTING_MAX_ROWS) {
    throw new AppApiError(`Job costing supports up to ${JOB_COSTING_MAX_ROWS} labor rows.`, 400);
  }

  const normalized = await normalizeLaborMutation({
    payload: input.payload,
  });

  await prisma.jobLabor.create({
    data: {
      orgId: input.orgId,
      jobId: input.jobId,
      description: normalized.description,
      quantity: normalized.quantity,
      unit: normalized.unit,
      cost: normalized.cost,
      markupPercent: ZERO,
      total: roundMoney(toMoneyDecimal(computeJobLineTotal({
        quantity: normalized.quantity.toString(),
        cost: normalized.cost.toString(),
        markupPercent: "0",
      }))),
      actualHours: normalized.actualHours,
      actualHourlyCost: normalized.actualHourlyCost,
      actualTotal: normalized.actualTotal,
      notes: normalized.notes,
      varianceNotes: normalized.varianceNotes,
    },
  });

  return getJobCostingForOrg({
    orgId: input.orgId,
    jobId: input.jobId,
  });
}

export async function updateJobCostingLabor(input: {
  orgId: string;
  jobId: string;
  itemId: string;
  payload: JobCostingLaborPayload | null;
}) {
  const existing = await prisma.jobLabor.findFirst({
    where: {
      id: input.itemId,
      jobId: input.jobId,
      orgId: input.orgId,
    },
    select: {
      id: true,
      markupPercent: true,
      notes: true,
    },
  });

  if (!existing) {
    throw new AppApiError("Job labor row not found.", 404);
  }

  const normalized = await normalizeLaborMutation({
    payload: input.payload,
    existing,
  });

  await prisma.jobLabor.update({
    where: { id: input.itemId },
    data: {
      description: normalized.description,
      quantity: normalized.quantity,
      unit: normalized.unit,
      cost: normalized.cost,
      total: roundMoney(toMoneyDecimal(computeJobLineTotal({
        quantity: normalized.quantity.toString(),
        cost: normalized.cost.toString(),
        markupPercent: existing.markupPercent.toString(),
      }))),
      actualHours: normalized.actualHours,
      actualHourlyCost: normalized.actualHourlyCost,
      actualTotal: normalized.actualTotal,
      varianceNotes: normalized.varianceNotes,
    },
  });

  return getJobCostingForOrg({
    orgId: input.orgId,
    jobId: input.jobId,
  });
}

export async function deleteJobCostingLabor(input: {
  orgId: string;
  jobId: string;
  itemId: string;
}) {
  const deleted = await prisma.jobLabor.deleteMany({
    where: {
      id: input.itemId,
      jobId: input.jobId,
      orgId: input.orgId,
    },
  });

  if (deleted.count !== 1) {
    throw new AppApiError("Job labor row not found.", 404);
  }

  return getJobCostingForOrg({
    orgId: input.orgId,
    jobId: input.jobId,
  });
}
