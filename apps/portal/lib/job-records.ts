import type { CalendarAccessRole, JobStatus, Prisma } from "@prisma/client";
import { roundMaterialNumber } from "@/lib/materials";

export const JOB_CUSTOMER_NAME_MAX = 160;
export const JOB_ADDRESS_MAX = 240;
export const JOB_PROJECT_TYPE_MAX = 160;
export const JOB_NOTES_MAX = 4000;
export const JOB_MEASUREMENT_LABEL_MAX = 120;
export const JOB_MEASUREMENT_VALUE_MAX = 120;
export const JOB_MEASUREMENT_UNIT_MAX = 40;
export const JOB_LINE_DESCRIPTION_MAX = 200;
export const JOB_LINE_UNIT_MAX = 40;
export const JOB_LINE_NOTES_MAX = 1000;
export const JOB_MAX_ROWS = 100;

export const jobStatusOptions: JobStatus[] = [
  "DRAFT",
  "ESTIMATING",
  "SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
  "ON_HOLD",
  "CANCELLED",
];

export const operationalJobExecutionRequiresBookingMessage =
  "An active linked calendar booking is required before moving this job into execution.";

export function requiresLinkedBookingForOperationalExecution(
  status: JobStatus,
): boolean {
  return status === "IN_PROGRESS" || status === "COMPLETED";
}

export function canSelectOperationalJobStatus(input: {
  status: JobStatus;
  hasActiveBooking: boolean;
}): boolean {
  return (
    input.hasActiveBooking ||
    !requiresLinkedBookingForOperationalExecution(input.status)
  );
}

export function formatJobReferenceLabel(input: {
  customerName: string | null | undefined;
  projectType: string | null | undefined;
  address?: string | null | undefined;
}): string {
  const primary = [input.customerName, input.projectType]
    .map((value) => (value || "").trim())
    .filter(Boolean)
    .join(" • ");
  const address = (input.address || "").trim();
  const base = primary || "Untitled job";
  return address ? `${base} • ${address}` : base;
}

export type JobMeasurementRow = {
  id: string;
  label: string;
  value: string;
  unit: string;
  notes: string;
};

export type JobMaterialRow = {
  id: string;
  materialId: string | null;
  name: string;
  quantity: string;
  unit: string;
  cost: string;
  markupPercent: string;
  total: number;
  notes: string;
};

export type JobLaborRow = {
  id: string;
  description: string;
  quantity: string;
  unit: string;
  cost: string;
  markupPercent: string;
  total: number;
  notes: string;
};

export type JobEstimateSummary = {
  id: string;
  projectName: string;
  customerName: string;
  finalTotal: number;
  updatedAt: string;
};

export type JobListItem = {
  id: string;
  customerName: string;
  address: string;
  projectType: string;
  notes: string | null;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  estimateDraft: JobEstimateSummary | null;
  counts: {
    measurements: number;
    materials: number;
    labor: number;
  };
};

export type JobDetail = JobListItem & {
  measurements: JobMeasurementRow[];
  materials: JobMaterialRow[];
  labor: JobLaborRow[];
};

function createId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function canManageJobRecords(input: {
  internalUser: boolean;
  calendarAccessRole: CalendarAccessRole;
}): boolean {
  return input.internalUser || input.calendarAccessRole !== "READ_ONLY";
}

export function createEmptyJobMeasurement(): JobMeasurementRow {
  return {
    id: createId("job-measurement"),
    label: "",
    value: "",
    unit: "",
    notes: "",
  };
}

export function createEmptyJobMaterial(): JobMaterialRow {
  return {
    id: createId("job-material"),
    materialId: null,
    name: "",
    quantity: "1",
    unit: "each",
    cost: "0.00",
    markupPercent: "0",
    total: 0,
    notes: "",
  };
}

export function createEmptyJobLabor(): JobLaborRow {
  return {
    id: createId("job-labor"),
    description: "",
    quantity: "1",
    unit: "hours",
    cost: "0.00",
    markupPercent: "0",
    total: 0,
    notes: "",
  };
}

function parseInputNumber(value: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return 0;
  if (parsed < 0) return 0;
  return roundMaterialNumber(parsed);
}

export function computeJobLineTotal(input: {
  quantity: string;
  cost: string;
  markupPercent: string;
}): number {
  const quantity = parseInputNumber(input.quantity);
  const cost = parseInputNumber(input.cost);
  const markupPercent = parseInputNumber(input.markupPercent);
  const base = roundMaterialNumber(quantity * cost);
  return roundMaterialNumber(base + base * (markupPercent / 100));
}

function estimateSummary(
  estimate:
    | {
        id: string;
        title: string;
        customerName: string | null;
        total: Prisma.Decimal;
        updatedAt: Date;
      }
    | null
    | undefined,
  estimateDraft:
    | {
        id: string;
        projectName: string;
        customerName: string | null;
        finalTotal: Prisma.Decimal;
        updatedAt: Date;
      }
    | null
    | undefined,
): JobEstimateSummary | null {
  if (estimate) {
    return {
      id: estimate.id,
      projectName: estimate.title,
      customerName: estimate.customerName || "",
      finalTotal: Number(estimate.total),
      updatedAt: estimate.updatedAt.toISOString(),
    };
  }
  if (!estimateDraft) return null;
  return {
    id: estimateDraft.id,
    projectName: estimateDraft.projectName,
    customerName: estimateDraft.customerName || "",
    finalTotal: Number(estimateDraft.finalTotal),
    updatedAt: estimateDraft.updatedAt.toISOString(),
  };
}

export function serializeJobListItem(
  job: Prisma.JobGetPayload<{
    include: {
      sourceEstimate: {
        select: {
          id: true;
          title: true;
          customerName: true;
          total: true;
          updatedAt: true;
        };
      };
      estimateDraft: {
        select: {
          id: true;
          projectName: true;
          customerName: true;
          finalTotal: true;
          updatedAt: true;
        };
      };
      _count: {
        select: {
          measurements: true;
          materials: true;
          labor: true;
        };
      };
    };
  }>,
): JobListItem {
  return {
    id: job.id,
    customerName: job.customerName,
    address: job.address,
    projectType: job.projectType,
    notes: job.notes,
    status: job.status,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    estimateDraft: estimateSummary(job.sourceEstimate, job.estimateDraft),
    counts: {
      measurements: job._count.measurements,
      materials: job._count.materials,
      labor: job._count.labor,
    },
  };
}

export function serializeJobDetail(
  job: Prisma.JobGetPayload<{
    include: {
      sourceEstimate: {
        select: {
          id: true;
          title: true;
          customerName: true;
          total: true;
          updatedAt: true;
        };
      };
      estimateDraft: {
        select: {
          id: true;
          projectName: true;
          customerName: true;
          finalTotal: true;
          updatedAt: true;
        };
      };
      measurements: true;
      materials: true;
      labor: true;
      _count: {
        select: {
          measurements: true;
          materials: true;
          labor: true;
        };
      };
    };
  }>,
): JobDetail {
  return {
    ...serializeJobListItem(job),
    measurements: job.measurements
      .sort(
        (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
      )
      .map((row) => ({
        id: row.id,
        label: row.label,
        value: row.value,
        unit: row.unit || "",
        notes: row.notes || "",
      })),
    materials: job.materials
      .sort(
        (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
      )
      .map((row) => ({
        id: row.id,
        materialId: row.materialId,
        name: row.name,
        quantity: Number(row.quantity).toFixed(2).replace(/\.00$/, ""),
        unit: row.unit || "",
        cost: Number(row.cost).toFixed(2),
        markupPercent: Number(row.markupPercent)
          .toFixed(2)
          .replace(/\.00$/, ""),
        total: Number(row.total),
        notes: row.notes || "",
      })),
    labor: job.labor
      .sort(
        (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
      )
      .map((row) => ({
        id: row.id,
        description: row.description,
        quantity: Number(row.quantity).toFixed(2).replace(/\.00$/, ""),
        unit: row.unit || "",
        cost: Number(row.cost).toFixed(2),
        markupPercent: Number(row.markupPercent)
          .toFixed(2)
          .replace(/\.00$/, ""),
        total: Number(row.total),
        notes: row.notes || "",
      })),
  };
}
