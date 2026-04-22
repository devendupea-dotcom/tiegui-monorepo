import { Prisma, type DispatchJobStatus } from "@prisma/client";
import { getOperationalJobPrimaryEstimateId } from "@/lib/estimate-job-linking";
import { normalizeE164 } from "@/lib/phone";
import { AppApiError } from "@/lib/app-api-error";
import {
  DISPATCH_ADDRESS_MAX,
  DISPATCH_CUSTOMER_NAME_MAX,
  DISPATCH_NOTES_MAX,
  DISPATCH_PHONE_MAX,
  DISPATCH_PRIORITY_MAX,
  DISPATCH_SERVICE_TYPE_MAX,
  dispatchStatusFromDb,
  formatDispatchDateKey,
  formatDispatchStatusLabel,
  getDispatchTodayDateKey,
  isDispatchFinalStatus,
  isDispatchStatusValue,
  nextDispatchDateKey,
  normalizeDispatchDateKey,
  parseDispatchDateKey,
  type DispatchEstimateSummary,
  type DispatchJobSummary,
  type DispatchStatusValue,
} from "@/lib/dispatch";

export type DispatchJobPayload = {
  customerId?: unknown;
  leadId?: unknown;
  linkedEstimateId?: unknown;
  customerName?: unknown;
  phone?: unknown;
  serviceType?: unknown;
  address?: unknown;
  scheduledDate?: unknown;
  scheduledStartTime?: unknown;
  scheduledEndTime?: unknown;
  assignedCrewId?: unknown;
  notes?: unknown;
  priority?: unknown;
  status?: unknown;
};

export type NormalizedDispatchJobPayload = {
  customerId: string | null;
  leadId: string | null;
  linkedEstimateId: string | null;
  customerName: string;
  phone: string | null;
  normalizedPhone: string | null;
  serviceType: string;
  address: string;
  scheduledDate: Date | null;
  scheduledDateKey: string | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  assignedCrewId: string | null;
  notes: string | null;
  priority: string | null;
  status: DispatchStatusValue;
};

type DispatchLeadSummaryRecord = {
  contactName: string | null;
  businessName: string | null;
  phoneE164: string;
};

type DispatchCustomerSummaryRecord = {
  id: string;
  name: string;
};

type DispatchCrewSummaryRecord = {
  id: string;
  name: string;
};

type DispatchEstimateRecord = {
  id: string;
  estimateNumber: string;
  title: string;
  status: string;
  total: Prisma.Decimal;
};

export type DispatchJobSummaryRecord = {
  id: string;
  customerId: string | null;
  leadId: string | null;
  customerName: string;
  phone: string | null;
  serviceType: string;
  address: string;
  scheduledDate: Date | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  dispatchStatus: DispatchJobStatus;
  assignedCrewId: string | null;
  crewOrder: number | null;
  priority: string | null;
  notes: string | null;
  linkedEstimateId: string | null;
  sourceEstimateId: string | null;
  updatedAt: Date;
  customer: DispatchCustomerSummaryRecord | null;
  lead: DispatchLeadSummaryRecord | null;
  assignedCrew: DispatchCrewSummaryRecord | null;
};

export type DispatchExistingJobPayloadSource = {
  customerId: string | null;
  leadId: string | null;
  linkedEstimateId: string | null;
  customerName: string;
  phone: string | null;
  serviceType: string;
  address: string;
  scheduledDate: string | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  assignedCrewId: string | null;
  notes: string | null;
  priority: string | null;
  dispatchStatus: DispatchJobStatus;
};

export type DispatchScheduleProjection = {
  scheduledDate: Date | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  hasBookingHistory: boolean;
  hasActiveBooking: boolean;
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

function normalizeOptionalId(value: unknown, label: string): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    throw new AppApiError(`${label} is invalid.`, 400);
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeOptionalTime(value: unknown, label: string): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    throw new AppApiError(`${label} must use HH:MM format.`, 400);
  }

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(trimmed)) {
    throw new AppApiError(`${label} must use HH:MM format.`, 400);
  }
  return trimmed;
}

function normalizeDispatchStatus(value: unknown): DispatchStatusValue {
  if (value == null || value === "") return "scheduled";
  if (typeof value !== "string") {
    throw new AppApiError("Status is invalid.", 400);
  }

  const normalized = value.trim().toLowerCase();
  if (!isDispatchStatusValue(normalized)) {
    throw new AppApiError("Status is invalid.", 400);
  }
  return normalized;
}

function normalizeOptionalCrewId(value: unknown): string | null {
  return normalizeOptionalId(value, "Assigned crew");
}

function normalizeScheduledDate(
  value: unknown,
  input?: {
    allowMissing?: boolean;
  },
): { date: Date; key: string } | null {
  if (value == null || value === "") {
    if (input?.allowMissing) {
      return null;
    }
    throw new AppApiError("Scheduled date is required.", 400);
  }

  if (typeof value !== "string") {
    throw new AppApiError("Scheduled date is required.", 400);
  }

  const parsed = parseDispatchDateKey(value.trim());
  if (!parsed) {
    throw new AppApiError("Scheduled date is invalid.", 400);
  }

  return {
    date: parsed,
    key: formatDispatchDateKey(parsed),
  };
}

export function buildDayRange(dateKey: string): { start: Date; end: Date } {
  const start = parseDispatchDateKey(dateKey);
  const endKey = nextDispatchDateKey(dateKey);
  const end = endKey ? parseDispatchDateKey(endKey) : null;

  if (!start || !end) {
    throw new AppApiError("Selected date is invalid.", 400);
  }

  return { start, end };
}

export function resolveTodayDateKey(value: string | null | undefined): string {
  return normalizeDispatchDateKey(value) || getDispatchTodayDateKey();
}

function isOverdueJob(dateKey: string, status: DispatchStatusValue, todayDateKey: string): boolean {
  return dateKey < todayDateKey && !isDispatchFinalStatus(status);
}

export function serializeDispatchEstimate(
  estimate: DispatchEstimateRecord | null | undefined,
): DispatchEstimateSummary | null {
  if (!estimate) return null;

  return {
    id: estimate.id,
    estimateNumber: estimate.estimateNumber,
    title: estimate.title,
    status: estimate.status,
    total: Number(estimate.total),
  };
}

function formatLeadLabel(lead: DispatchLeadSummaryRecord | null | undefined): string | null {
  if (!lead) return null;
  return lead.contactName || lead.businessName || lead.phoneE164;
}

export function serializeDispatchJobWithSchedule(
  job: DispatchJobSummaryRecord,
  todayDateKey: string,
  schedule: DispatchScheduleProjection,
): DispatchJobSummary {
  const scheduledDate = schedule.scheduledDate ? formatDispatchDateKey(schedule.scheduledDate) : "";
  const status = dispatchStatusFromDb(job.dispatchStatus);

  return {
    id: job.id,
    customerId: job.customerId,
    customerLabel: job.customer?.name || job.customerName,
    leadId: job.leadId,
    leadLabel: formatLeadLabel(job.lead),
    customerName: job.customerName,
    phone: job.phone,
    serviceType: job.serviceType,
    address: job.address,
    scheduledDate,
    scheduledStartTime: schedule.scheduledStartTime,
    scheduledEndTime: schedule.scheduledEndTime,
    hasBookingHistory: schedule.hasBookingHistory,
    hasActiveBooking: schedule.hasActiveBooking,
    status,
    assignedCrewId: job.assignedCrewId,
    assignedCrewName: job.assignedCrew?.name || null,
    crewOrder: job.crewOrder,
    notes: job.notes,
    priority: job.priority,
    linkedEstimateId: getOperationalJobPrimaryEstimateId(job),
    isOverdue: scheduledDate ? isOverdueJob(scheduledDate, status, todayDateKey) : false,
    updatedAt: job.updatedAt.toISOString(),
  };
}

export function normalizeDispatchJobPayload(
  payload: DispatchJobPayload | null,
  input?: {
    allowMissingScheduledDate?: boolean;
  },
): NormalizedDispatchJobPayload {
  if (!payload) {
    throw new AppApiError("Invalid dispatch payload.", 400);
  }

  const scheduledDate = normalizeScheduledDate(payload.scheduledDate, {
    allowMissing: input?.allowMissingScheduledDate,
  });
  const scheduledStartTime = normalizeOptionalTime(payload.scheduledStartTime, "Start time");
  const scheduledEndTime = normalizeOptionalTime(payload.scheduledEndTime, "End time");

  if (scheduledStartTime && scheduledEndTime && scheduledEndTime < scheduledStartTime) {
    throw new AppApiError("End time must be after the start time.", 400);
  }

  return {
    customerId: normalizeOptionalId(payload.customerId, "Customer"),
    leadId: normalizeOptionalId(payload.leadId, "Lead"),
    linkedEstimateId: normalizeOptionalId(payload.linkedEstimateId, "Linked estimate"),
    customerName: normalizeRequiredText(payload.customerName, "Customer name", DISPATCH_CUSTOMER_NAME_MAX),
    phone: normalizeOptionalText(payload.phone, "Phone", DISPATCH_PHONE_MAX),
    normalizedPhone: normalizeE164(typeof payload.phone === "string" ? payload.phone : null),
    serviceType: normalizeRequiredText(payload.serviceType, "Service type", DISPATCH_SERVICE_TYPE_MAX),
    address: normalizeRequiredText(payload.address, "Address", DISPATCH_ADDRESS_MAX),
    scheduledDate: scheduledDate?.date || null,
    scheduledDateKey: scheduledDate?.key || null,
    scheduledStartTime,
    scheduledEndTime,
    assignedCrewId: normalizeOptionalCrewId(payload.assignedCrewId),
    notes: normalizeOptionalText(payload.notes, "Notes", DISPATCH_NOTES_MAX),
    priority: normalizeOptionalText(payload.priority, "Priority", DISPATCH_PRIORITY_MAX)?.toLowerCase() || null,
    status: normalizeDispatchStatus(payload.status),
  };
}

export function createJobUpdatedMetadata(input: {
  changes: {
    field: string;
    from: string | null;
    to: string | null;
  }[];
}) {
  return {
    changes: input.changes,
  };
}

export function createDispatchEventMetadataBase(input: {
  customerId: string | null;
  leadId: string | null;
  linkedEstimateId: string | null;
  scheduledDateKey: string | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  status: DispatchStatusValue;
  assignedCrewId: string | null;
  assignedCrewName: string | null;
}) {
  return {
    source: "dispatch",
    customerId: input.customerId,
    leadId: input.leadId,
    linkedEstimateId: input.linkedEstimateId,
    scheduledDate: input.scheduledDateKey,
    scheduledStartTime: input.scheduledStartTime,
    scheduledEndTime: input.scheduledEndTime,
    status: input.status,
    statusLabel: formatDispatchStatusLabel(input.status),
    assignedCrewId: input.assignedCrewId,
    assignedCrewName: input.assignedCrewName,
  };
}

export function buildMergedDispatchPayload(
  existing: DispatchExistingJobPayloadSource,
  payload: DispatchJobPayload | null,
): DispatchJobPayload {
  return {
    customerId:
      payload && Object.prototype.hasOwnProperty.call(payload, "customerId") ? payload.customerId : existing.customerId,
    leadId: payload && Object.prototype.hasOwnProperty.call(payload, "leadId") ? payload.leadId : existing.leadId,
    linkedEstimateId:
      payload && Object.prototype.hasOwnProperty.call(payload, "linkedEstimateId")
        ? payload.linkedEstimateId
        : existing.linkedEstimateId,
    customerName: payload?.customerName ?? existing.customerName,
    phone: payload && Object.prototype.hasOwnProperty.call(payload, "phone") ? payload.phone : existing.phone,
    serviceType: payload?.serviceType ?? existing.serviceType,
    address: payload?.address ?? existing.address,
    scheduledDate: payload?.scheduledDate ?? existing.scheduledDate,
    scheduledStartTime:
      payload && Object.prototype.hasOwnProperty.call(payload, "scheduledStartTime")
        ? payload.scheduledStartTime
        : existing.scheduledStartTime,
    scheduledEndTime:
      payload && Object.prototype.hasOwnProperty.call(payload, "scheduledEndTime")
        ? payload.scheduledEndTime
        : existing.scheduledEndTime,
    assignedCrewId:
      payload && Object.prototype.hasOwnProperty.call(payload, "assignedCrewId")
        ? payload.assignedCrewId
        : existing.assignedCrewId,
    notes: payload && Object.prototype.hasOwnProperty.call(payload, "notes") ? payload.notes : existing.notes,
    priority:
      payload && Object.prototype.hasOwnProperty.call(payload, "priority") ? payload.priority : existing.priority,
    status:
      payload && Object.prototype.hasOwnProperty.call(payload, "status")
        ? payload.status
        : dispatchStatusFromDb(existing.dispatchStatus),
  };
}

export function normalizeCrewName(value: unknown): string {
  return normalizeRequiredText(value, "Crew name", 80);
}

export function normalizeOptionalBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
}
