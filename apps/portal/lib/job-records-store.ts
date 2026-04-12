import "server-only";

import { Prisma, type JobStatus } from "@prisma/client";
import { formatDispatchDateKey } from "@/lib/dispatch";
import { formatOperationalJobStatusLabel } from "@/lib/job-tracking";
import { prisma } from "@/lib/prisma";
import {
  JOB_ADDRESS_MAX,
  JOB_CUSTOMER_NAME_MAX,
  JOB_LINE_DESCRIPTION_MAX,
  JOB_LINE_NOTES_MAX,
  JOB_LINE_UNIT_MAX,
  JOB_MAX_ROWS,
  JOB_MEASUREMENT_LABEL_MAX,
  JOB_MEASUREMENT_UNIT_MAX,
  JOB_MEASUREMENT_VALUE_MAX,
  JOB_NOTES_MAX,
  JOB_PROJECT_TYPE_MAX,
  computeJobLineTotal,
  jobStatusOptions,
  serializeJobDetail,
} from "@/lib/job-records";
import { roundMoney, toMoneyDecimal } from "@/lib/invoices";
import { getOperationalJobPrimaryEstimateId } from "@/lib/estimate-job-linking";
import { AppApiError } from "@/lib/app-api-permissions";

export const jobListInclude = {
  sourceEstimate: {
    select: {
      id: true,
      title: true,
      customerName: true,
      total: true,
      updatedAt: true,
    },
  },
  estimateDraft: {
    select: {
      id: true,
      projectName: true,
      customerName: true,
      finalTotal: true,
      updatedAt: true,
    },
  },
  _count: {
    select: {
      measurements: true,
      materials: true,
      labor: true,
    },
  },
} satisfies Prisma.JobInclude;

export const jobDetailInclude = {
  ...jobListInclude,
  measurements: true,
  materials: true,
  labor: true,
} satisfies Prisma.JobInclude;

type JobRecordPayload = {
  customerName?: unknown;
  address?: unknown;
  projectType?: unknown;
  notes?: unknown;
  status?: unknown;
  estimateDraftId?: unknown;
  measurements?: unknown;
  materials?: unknown;
  labor?: unknown;
};

type NormalizedMeasurement = {
  label: string;
  value: string;
  unit: string | null;
  notes: string | null;
};

type NormalizedMaterial = {
  id: string | null;
  materialId: string | null;
  name: string;
  quantity: Prisma.Decimal;
  unit: string | null;
  cost: Prisma.Decimal;
  markupPercent: Prisma.Decimal;
  total: Prisma.Decimal;
  notes: string | null;
};

type NormalizedLabor = {
  id: string | null;
  description: string;
  quantity: Prisma.Decimal;
  unit: string | null;
  cost: Prisma.Decimal;
  markupPercent: Prisma.Decimal;
  total: Prisma.Decimal;
  notes: string | null;
};

type NormalizedJobPayload = {
  customerName: string;
  address: string;
  projectType: string;
  notes: string | null;
  status: JobStatus;
  estimateDraftId: string | null;
  measurements: NormalizedMeasurement[];
  materials: NormalizedMaterial[];
  labor: NormalizedLabor[];
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

function normalizeStatus(value: unknown): JobStatus {
  if (jobStatusOptions.includes(value as JobStatus)) {
    return value as JobStatus;
  }
  return "DRAFT";
}

function normalizeRequiredJobStatus(value: unknown): JobStatus {
  if (jobStatusOptions.includes(value as JobStatus)) {
    return value as JobStatus;
  }
  throw new AppApiError("Invalid job status.", 400);
}

function normalizeOptionalId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
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

function normalizeMeasurements(value: unknown): NormalizedMeasurement[] {
  if (!Array.isArray(value)) return [];
  if (value.length > JOB_MAX_ROWS) {
    throw new AppApiError(`Job measurements support up to ${JOB_MAX_ROWS} rows.`, 400);
  }

  return value
    .map((entry) => {
      const row = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
      return {
        label: normalizeRequiredText(row.label, "Measurement label", JOB_MEASUREMENT_LABEL_MAX),
        value: normalizeRequiredText(row.value, "Measurement value", JOB_MEASUREMENT_VALUE_MAX),
        unit: normalizeOptionalText(row.unit, "Measurement unit", JOB_MEASUREMENT_UNIT_MAX),
        notes: normalizeOptionalText(row.notes, "Measurement notes", JOB_LINE_NOTES_MAX),
      };
    })
    .filter((row) => row.label && row.value);
}

function normalizeMaterials(value: unknown): NormalizedMaterial[] {
  if (!Array.isArray(value)) return [];
  if (value.length > JOB_MAX_ROWS) {
    throw new AppApiError(`Job materials support up to ${JOB_MAX_ROWS} rows.`, 400);
  }

  return value.map((entry) => {
    const row = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    const quantity = normalizeNonNegativeDecimal(row.quantity, "Material quantity");
    const cost = normalizeNonNegativeDecimal(row.cost, "Material cost");
    const markupPercent = normalizeNonNegativeDecimal(row.markupPercent, "Material markup");
    const total = roundMoney(
      toMoneyDecimal(
        computeJobLineTotal({
          quantity: quantity.toString(),
          cost: cost.toString(),
          markupPercent: markupPercent.toString(),
        }),
      ),
    );

    return {
      id: normalizeOptionalId(row.id),
      materialId: normalizeOptionalId(row.materialId),
      name: normalizeRequiredText(row.name, "Material name", JOB_LINE_DESCRIPTION_MAX),
      quantity,
      unit: normalizeOptionalText(row.unit, "Material unit", JOB_LINE_UNIT_MAX),
      cost,
      markupPercent,
      total,
      notes: normalizeOptionalText(row.notes, "Material notes", JOB_LINE_NOTES_MAX),
    };
  });
}

function normalizeLabor(value: unknown): NormalizedLabor[] {
  if (!Array.isArray(value)) return [];
  if (value.length > JOB_MAX_ROWS) {
    throw new AppApiError(`Job labor rows support up to ${JOB_MAX_ROWS} rows.`, 400);
  }

  return value.map((entry) => {
    const row = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    const quantity = normalizeNonNegativeDecimal(row.quantity, "Labor quantity");
    const cost = normalizeNonNegativeDecimal(row.cost, "Labor cost");
    const markupPercent = normalizeNonNegativeDecimal(row.markupPercent, "Labor markup");
    const total = roundMoney(
      toMoneyDecimal(
        computeJobLineTotal({
          quantity: quantity.toString(),
          cost: cost.toString(),
          markupPercent: markupPercent.toString(),
        }),
      ),
    );

    return {
      id: normalizeOptionalId(row.id),
      description: normalizeRequiredText(row.description, "Labor description", JOB_LINE_DESCRIPTION_MAX),
      quantity,
      unit: normalizeOptionalText(row.unit, "Labor unit", JOB_LINE_UNIT_MAX),
      cost,
      markupPercent,
      total,
      notes: normalizeOptionalText(row.notes, "Labor notes", JOB_LINE_NOTES_MAX),
    };
  });
}

export async function normalizeJobRecordPayload(
  orgId: string,
  payload: JobRecordPayload | null,
): Promise<NormalizedJobPayload> {
  if (!payload) {
    throw new AppApiError("Invalid JSON payload.", 400);
  }

  const estimateDraftId = normalizeOptionalId(payload.estimateDraftId);
  if (estimateDraftId) {
    const linkedEstimate = await prisma.estimateDraft.findFirst({
      where: {
        id: estimateDraftId,
        orgId,
      },
      select: { id: true },
    });

    if (!linkedEstimate) {
      throw new AppApiError("Selected estimate draft was not found for this organization.", 400);
    }
  }

  const materials = normalizeMaterials(payload.materials);
  const materialIds = [...new Set(materials.map((row) => row.materialId).filter(Boolean))] as string[];
  if (materialIds.length > 0) {
    const linkedMaterials = await prisma.material.findMany({
      where: {
        id: { in: materialIds },
        orgId,
      },
      select: { id: true },
    });

    if (linkedMaterials.length !== materialIds.length) {
      throw new AppApiError("One or more linked materials are not available for this organization.", 400);
    }
  }

  return {
    customerName: normalizeRequiredText(payload.customerName, "Customer name", JOB_CUSTOMER_NAME_MAX),
    address: normalizeRequiredText(payload.address, "Address", JOB_ADDRESS_MAX),
    projectType: normalizeRequiredText(payload.projectType, "Project type", JOB_PROJECT_TYPE_MAX),
    notes: normalizeOptionalText(payload.notes, "Notes", JOB_NOTES_MAX),
    status: normalizeStatus(payload.status),
    estimateDraftId,
    measurements: normalizeMeasurements(payload.measurements),
    materials,
    labor: normalizeLabor(payload.labor),
  };
}

export async function saveJobRecord(input: {
  orgId: string;
  actorId: string | null;
  jobId?: string;
  payload: JobRecordPayload | null;
}) {
  const normalized = await normalizeJobRecordPayload(input.orgId, input.payload);

  const saved = await prisma.$transaction(async (tx) => {
    const job =
      input.jobId
        ? await tx.job.update({
            where: { id: input.jobId },
            data: {
              customerName: normalized.customerName,
              address: normalized.address,
              serviceType: normalized.projectType,
              projectType: normalized.projectType,
              notes: normalized.notes,
              status: normalized.status,
              estimateDraftId: normalized.estimateDraftId,
            },
            include: jobDetailInclude,
          })
        : await tx.job.create({
            data: {
              orgId: input.orgId,
              createdByUserId: input.actorId,
              customerName: normalized.customerName,
              address: normalized.address,
              serviceType: normalized.projectType,
              projectType: normalized.projectType,
              notes: normalized.notes,
              status: normalized.status,
              estimateDraftId: normalized.estimateDraftId,
            },
            include: jobDetailInclude,
          });

    await tx.jobMeasurement.deleteMany({
      where: { jobId: job.id },
    });
    const existingMaterialsById = new Map(job.materials.map((row) => [row.id, row] as const));
    const existingLaborById = new Map(job.labor.map((row) => [row.id, row] as const));
    const materialIdsToKeep = normalized.materials
      .map((row) => row.id)
      .filter((row): row is string => Boolean(row && existingMaterialsById.has(row)));
    const laborIdsToKeep = normalized.labor
      .map((row) => row.id)
      .filter((row): row is string => Boolean(row && existingLaborById.has(row)));

    await tx.jobMaterial.deleteMany({
      where: {
        jobId: job.id,
        ...(materialIdsToKeep.length > 0 ? { id: { notIn: materialIdsToKeep } } : {}),
      },
    });
    await tx.jobLabor.deleteMany({
      where: {
        jobId: job.id,
        ...(laborIdsToKeep.length > 0 ? { id: { notIn: laborIdsToKeep } } : {}),
      },
    });

    if (normalized.measurements.length > 0) {
      await tx.jobMeasurement.createMany({
        data: normalized.measurements.map((row) => ({
          orgId: input.orgId,
          jobId: job.id,
          label: row.label,
          value: row.value,
          unit: row.unit,
          notes: row.notes,
        })),
      });
    }

    if (normalized.materials.length > 0) {
      for (const row of normalized.materials) {
        const existingMaterial = row.id ? existingMaterialsById.get(row.id) : null;
        if (existingMaterial) {
          await tx.jobMaterial.update({
            where: { id: existingMaterial.id },
            data: {
              materialId: row.materialId,
              name: row.name,
              quantity: row.quantity,
              unit: row.unit,
              cost: row.cost,
              markupPercent: row.markupPercent,
              total: row.total,
              notes: row.notes,
            },
          });
        } else {
          await tx.jobMaterial.create({
            data: {
              orgId: input.orgId,
              jobId: job.id,
              materialId: row.materialId,
              name: row.name,
              quantity: row.quantity,
              unit: row.unit,
              cost: row.cost,
              markupPercent: row.markupPercent,
              total: row.total,
              notes: row.notes,
            },
          });
        }
      }
    }

    if (normalized.labor.length > 0) {
      for (const row of normalized.labor) {
        const existingLabor = row.id ? existingLaborById.get(row.id) : null;
        if (existingLabor) {
          await tx.jobLabor.update({
            where: { id: existingLabor.id },
            data: {
              description: row.description,
              quantity: row.quantity,
              unit: row.unit,
              cost: row.cost,
              markupPercent: row.markupPercent,
              total: row.total,
              notes: row.notes,
            },
          });
        } else {
          await tx.jobLabor.create({
            data: {
              orgId: input.orgId,
              jobId: job.id,
              description: row.description,
              quantity: row.quantity,
              unit: row.unit,
              cost: row.cost,
              markupPercent: row.markupPercent,
              total: row.total,
              notes: row.notes,
            },
          });
        }
      }
    }

    return tx.job.findUnique({
      where: { id: job.id },
      include: jobDetailInclude,
    });
  });

  if (!saved) {
    throw new Error("Failed to save job.");
  }

  return serializeJobDetail(saved);
}

export async function updateJobRecordStatus(input: {
  orgId: string;
  actorId: string | null;
  jobId: string;
  status: unknown;
}) {
  const nextStatus = normalizeRequiredJobStatus(input.status);

  const existing = await prisma.job.findFirst({
    where: {
      id: input.jobId,
      orgId: input.orgId,
    },
    select: {
      id: true,
      status: true,
      scheduledDate: true,
      scheduledStartTime: true,
      scheduledEndTime: true,
      customerId: true,
      leadId: true,
      linkedEstimateId: true,
      sourceEstimateId: true,
      assignedCrewId: true,
    },
  });

  if (!existing) {
    throw new AppApiError("Job not found.", 404);
  }

  if (existing.status === nextStatus) {
    return {
      id: existing.id,
      status: existing.status,
    };
  }

  const saved = await prisma.$transaction(async (tx) => {
    const job = await tx.job.update({
      where: { id: existing.id },
      data: {
        status: nextStatus,
      },
      select: {
        id: true,
        status: true,
      },
    });

    await tx.jobEvent.create({
      data: {
        jobId: existing.id,
        orgId: input.orgId,
        actorUserId: input.actorId,
        eventType: "STATUS_CHANGED",
        fromValue: existing.status,
        toValue: nextStatus,
        metadata: {
          statusKind: "job",
          fromStatusLabel: formatOperationalJobStatusLabel(existing.status),
          toStatusLabel: formatOperationalJobStatusLabel(nextStatus),
          statusLabel: formatOperationalJobStatusLabel(nextStatus),
          scheduledDate: existing.scheduledDate ? formatDispatchDateKey(existing.scheduledDate) : null,
          scheduledStartTime: existing.scheduledStartTime,
          scheduledEndTime: existing.scheduledEndTime,
          customerId: existing.customerId,
          leadId: existing.leadId,
          linkedEstimateId: getOperationalJobPrimaryEstimateId(existing),
          assignedCrewId: existing.assignedCrewId,
        },
      },
    });

    return job;
  });

  return saved;
}

export async function getJobForOrg(input: {
  jobId: string;
  orgId: string;
}) {
  return prisma.job.findFirst({
    where: {
      id: input.jobId,
      orgId: input.orgId,
    },
    include: jobDetailInclude,
  });
}
