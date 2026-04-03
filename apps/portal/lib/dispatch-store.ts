import "server-only";

import { Prisma, type JobEventType } from "@prisma/client";
import { maybeSendDispatchCustomerNotifications, type DispatchPersistedJobEvent } from "@/lib/dispatch-notifications";
import { prisma } from "@/lib/prisma";
import { normalizeE164 } from "@/lib/phone";
import {
  AppApiError,
} from "@/lib/app-api-permissions";
import {
  compareDispatchJobs,
  DEFAULT_DISPATCH_CREW_NAMES,
  DISPATCH_ADDRESS_MAX,
  DISPATCH_CUSTOMER_NAME_MAX,
  DISPATCH_NOTES_MAX,
  DISPATCH_PHONE_MAX,
  DISPATCH_PRIORITY_MAX,
  DISPATCH_SERVICE_TYPE_MAX,
  dispatchStatusFromDb,
  dispatchStatusToDb,
  formatDispatchDateKey,
  formatDispatchStatusLabel,
  getDispatchTodayDateKey,
  isDispatchFinalStatus,
  isDispatchStatusValue,
  nextDispatchDateKey,
  normalizeDispatchDateKey,
  parseDispatchDateKey,
  type DispatchCommunicationItem,
  type DispatchCrewManagementItem,
  type DispatchCrewSummary,
  type DispatchDaySnapshot,
  type DispatchEstimateSummary,
  type DispatchJobDetail,
  type DispatchJobSummary,
  type DispatchStatusValue,
} from "@/lib/dispatch";

type DispatchDbClient = Prisma.TransactionClient | typeof prisma;

type DispatchJobPayload = {
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

type DispatchReorderPayload = {
  crewId: string | null;
  jobIds: string[];
}[];

type NormalizedDispatchJobPayload = {
  customerId: string | null;
  leadId: string | null;
  linkedEstimateId: string | null;
  customerName: string;
  phone: string | null;
  normalizedPhone: string | null;
  serviceType: string;
  address: string;
  scheduledDate: Date;
  scheduledDateKey: string;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  assignedCrewId: string | null;
  notes: string | null;
  priority: string | null;
  status: DispatchStatusValue;
};

type JobEventInput = {
  eventType: JobEventType;
  fromValue?: string | null;
  toValue?: string | null;
  metadata?: Prisma.InputJsonValue | null;
};

const dispatchJobBaseSelect = {
  id: true,
  customerId: true,
  leadId: true,
  customerName: true,
  phone: true,
  serviceType: true,
  address: true,
  scheduledDate: true,
  scheduledStartTime: true,
  scheduledEndTime: true,
  dispatchStatus: true,
  assignedCrewId: true,
  crewOrder: true,
  priority: true,
  notes: true,
  linkedEstimateId: true,
  sourceEstimateId: true,
  updatedAt: true,
  customer: {
    select: {
      id: true,
      name: true,
    },
  },
  lead: {
    select: {
      id: true,
      contactName: true,
      businessName: true,
      phoneE164: true,
    },
  },
  assignedCrew: {
    select: {
      id: true,
      name: true,
    },
  },
} satisfies Prisma.JobSelect;

const dispatchJobDetailSelect = {
  ...dispatchJobBaseSelect,
  linkedEstimate: {
    select: {
      id: true,
      estimateNumber: true,
      title: true,
      status: true,
      total: true,
      leadId: true,
    },
  },
  sourceEstimate: {
    select: {
      id: true,
      estimateNumber: true,
      title: true,
      status: true,
      total: true,
      leadId: true,
    },
  },
} satisfies Prisma.JobSelect;

type DispatchJobListRecord = Prisma.JobGetPayload<{
  select: typeof dispatchJobBaseSelect;
}>;

type DispatchJobDetailRecord = Prisma.JobGetPayload<{
  select: typeof dispatchJobDetailSelect;
}>;

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

function normalizeScheduledDate(value: unknown): { date: Date; key: string } {
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

function buildDayRange(dateKey: string): { start: Date; end: Date } {
  const start = parseDispatchDateKey(dateKey);
  const endKey = nextDispatchDateKey(dateKey);
  const end = endKey ? parseDispatchDateKey(endKey) : null;

  if (!start || !end) {
    throw new AppApiError("Selected date is invalid.", 400);
  }

  return { start, end };
}

function resolveTodayDateKey(value: string | null | undefined): string {
  return normalizeDispatchDateKey(value) || getDispatchTodayDateKey();
}

function isOverdueJob(dateKey: string, status: DispatchStatusValue, todayDateKey: string): boolean {
  return dateKey < todayDateKey && !isDispatchFinalStatus(status);
}

function serializeDispatchEstimate(
  estimate:
    | {
        id: string;
        estimateNumber: string;
        title: string;
        status: string;
        total: Prisma.Decimal;
      }
    | null
    | undefined,
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

function formatLeadLabel(
  lead:
    | {
        contactName: string | null;
        businessName: string | null;
        phoneE164: string;
      }
    | null
    | undefined,
): string | null {
  if (!lead) return null;
  return lead.contactName || lead.businessName || lead.phoneE164;
}

function serializeDispatchJob(job: DispatchJobListRecord, todayDateKey: string): DispatchJobSummary {
  const scheduledDate = job.scheduledDate ? formatDispatchDateKey(job.scheduledDate) : "";
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
    scheduledStartTime: job.scheduledStartTime,
    scheduledEndTime: job.scheduledEndTime,
    status,
    assignedCrewId: job.assignedCrewId,
    assignedCrewName: job.assignedCrew?.name || null,
    crewOrder: job.crewOrder,
    notes: job.notes,
    priority: job.priority,
    linkedEstimateId: job.linkedEstimateId || job.sourceEstimateId,
    isOverdue: scheduledDate ? isOverdueJob(scheduledDate, status, todayDateKey) : false,
    updatedAt: job.updatedAt.toISOString(),
  };
}

async function writeJobEvents(input: {
  tx: Prisma.TransactionClient;
  orgId: string;
  jobId: string;
  actorUserId: string | null;
  events: JobEventInput[];
}): Promise<DispatchPersistedJobEvent[]> {
  const created: DispatchPersistedJobEvent[] = [];
  for (const event of input.events) {
    const row = await input.tx.jobEvent.create({
      data: {
        orgId: input.orgId,
        jobId: input.jobId,
        actorUserId: input.actorUserId,
        eventType: event.eventType,
        fromValue: event.fromValue ?? null,
        toValue: event.toValue ?? null,
        metadata: event.metadata ?? undefined,
      },
      select: {
        id: true,
        eventType: true,
        fromValue: true,
        toValue: true,
        createdAt: true,
      },
    });
    created.push(row);
  }
  return created;
}

async function ensureDispatchCrewsForOrgWithClient(
  orgId: string,
  tx: DispatchDbClient,
): Promise<
  {
    id: string;
    name: string;
    active: boolean;
  }[]
> {
  const existing = await tx.crew.findMany({
    where: { orgId },
    select: {
      id: true,
      name: true,
      active: true,
    },
    orderBy: [{ createdAt: "asc" }, { name: "asc" }],
  });

  if (existing.length === 0) {
    for (const name of DEFAULT_DISPATCH_CREW_NAMES) {
      try {
        await tx.crew.create({
          data: {
            orgId,
            name,
            active: true,
          },
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
          throw error;
        }
      }
    }
  }

  return tx.crew.findMany({
    where: {
      orgId,
    },
    select: {
      id: true,
      name: true,
      active: true,
    },
    orderBy: [{ createdAt: "asc" }, { name: "asc" }],
  });
}

async function getCrewMapForOrg(input: {
  orgId: string;
  tx: DispatchDbClient;
}): Promise<Map<string, { id: string; name: string; active: boolean }>> {
  const crews = await ensureDispatchCrewsForOrgWithClient(input.orgId, input.tx);
  return new Map(crews.map((crew) => [crew.id, crew] as const));
}

async function assertCrewBelongsToOrg(input: {
  orgId: string;
  crewId: string | null;
  tx: DispatchDbClient;
}) {
  if (!input.crewId) return null;

  const crew = await input.tx.crew.findFirst({
    where: {
      id: input.crewId,
      orgId: input.orgId,
      active: true,
    },
    select: {
      id: true,
      name: true,
      active: true,
    },
  });

  if (!crew) {
    throw new AppApiError("Assigned crew was not found for this workspace.", 400);
  }

  return crew;
}

async function assertCustomerBelongsToOrg(input: {
  orgId: string;
  customerId: string | null;
  tx: DispatchDbClient;
}) {
  if (!input.customerId) return null;

  const customer = await input.tx.customer.findFirst({
    where: {
      id: input.customerId,
      orgId: input.orgId,
    },
    select: {
      id: true,
      name: true,
      phoneE164: true,
      addressLine: true,
    },
  });

  if (!customer) {
    throw new AppApiError("Selected customer was not found for this workspace.", 400);
  }

  return customer;
}

async function assertLeadBelongsToOrg(input: {
  orgId: string;
  leadId: string | null;
  tx: DispatchDbClient;
}) {
  if (!input.leadId) return null;

  const lead = await input.tx.lead.findFirst({
    where: {
      id: input.leadId,
      orgId: input.orgId,
    },
    select: {
      id: true,
      customerId: true,
      contactName: true,
      businessName: true,
      phoneE164: true,
      businessType: true,
      intakeWorkTypeText: true,
      intakeLocationText: true,
    },
  });

  if (!lead) {
    throw new AppApiError("Selected lead was not found for this workspace.", 400);
  }

  return lead;
}

async function assertLinkedEstimateBelongsToOrg(input: {
  orgId: string;
  estimateId: string | null;
  tx: DispatchDbClient;
}) {
  if (!input.estimateId) return null;

  const estimate = await input.tx.estimate.findFirst({
    where: {
      id: input.estimateId,
      orgId: input.orgId,
      archivedAt: null,
    },
    select: {
      id: true,
      leadId: true,
    },
  });

  if (!estimate) {
    throw new AppApiError("Linked estimate was not found for this workspace.", 400);
  }

  return estimate;
}

async function resolveDispatchCustomerId(input: {
  orgId: string;
  customerId: string | null;
  leadCustomerId?: string | null;
  phone: string | null;
  tx: DispatchDbClient;
}): Promise<string | null> {
  if (input.customerId) {
    return input.customerId;
  }

  if (input.leadCustomerId) {
    return input.leadCustomerId;
  }

  const normalizedPhone = normalizeE164(input.phone);
  if (!normalizedPhone) {
    return null;
  }

  const customer = await input.tx.customer.findFirst({
    where: {
      orgId: input.orgId,
      phoneE164: normalizedPhone,
    },
    select: {
      id: true,
    },
    orderBy: [{ createdAt: "asc" }],
  });

  return customer?.id || null;
}

async function getNextCrewOrder(input: {
  orgId: string;
  scheduledDateKey: string;
  assignedCrewId: string | null;
  tx: DispatchDbClient;
}): Promise<number> {
  const { start, end } = buildDayRange(input.scheduledDateKey);
  const latest = await input.tx.job.findFirst({
    where: {
      orgId: input.orgId,
      scheduledDate: {
        gte: start,
        lt: end,
      },
      assignedCrewId: input.assignedCrewId,
      crewOrder: {
        not: null,
      },
    },
    select: {
      crewOrder: true,
    },
    orderBy: [{ crewOrder: "desc" }, { updatedAt: "desc" }],
  });

  return (latest?.crewOrder ?? -1) + 1;
}

function normalizeDispatchJobPayload(payload: DispatchJobPayload | null): NormalizedDispatchJobPayload {
  if (!payload) {
    throw new AppApiError("Invalid dispatch payload.", 400);
  }

  const scheduledDate = normalizeScheduledDate(payload.scheduledDate);
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
    scheduledDate: scheduledDate.date,
    scheduledDateKey: scheduledDate.key,
    scheduledStartTime,
    scheduledEndTime,
    assignedCrewId: normalizeOptionalCrewId(payload.assignedCrewId),
    notes: normalizeOptionalText(payload.notes, "Notes", DISPATCH_NOTES_MAX),
    priority: normalizeOptionalText(payload.priority, "Priority", DISPATCH_PRIORITY_MAX)?.toLowerCase() || null,
    status: normalizeDispatchStatus(payload.status),
  };
}

function createJobUpdatedMetadata(input: {
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

function createDispatchEventMetadataBase(input: {
  customerId: string | null;
  leadId: string | null;
  linkedEstimateId: string | null;
  scheduledDateKey: string;
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

export async function ensureDispatchCrewsForOrg(orgId: string) {
  return ensureDispatchCrewsForOrgWithClient(orgId, prisma);
}

export async function getDispatchDaySnapshot(input: {
  orgId: string;
  date: string;
  todayDate?: string | null;
}): Promise<DispatchDaySnapshot> {
  const { start, end } = buildDayRange(input.date);
  const todayDateKey = resolveTodayDateKey(input.todayDate);
  const crews = await ensureDispatchCrewsForOrg(input.orgId);

  const jobs = await prisma.job.findMany({
    where: {
      orgId: input.orgId,
      scheduledDate: {
        gte: start,
        lt: end,
      },
    },
    select: dispatchJobBaseSelect,
  });

  const serializedJobs = jobs.map((job) => serializeDispatchJob(job, todayDateKey)).sort(compareDispatchJobs);
  const countsByCrew = new Map<string, number>();
  for (const job of serializedJobs) {
    if (!job.assignedCrewId) continue;
    countsByCrew.set(job.assignedCrewId, (countsByCrew.get(job.assignedCrewId) || 0) + 1);
  }

  const visibleCrews = crews.filter((crew) => crew.active || countsByCrew.has(crew.id));

  return {
    date: input.date,
    crews: visibleCrews.map((crew): DispatchCrewSummary => ({
      id: crew.id,
      name: crew.name,
      active: crew.active,
      jobCount: countsByCrew.get(crew.id) || 0,
    })),
    jobs: serializedJobs,
    counts: {
      total: serializedJobs.length,
      unassigned: serializedJobs.filter((job) => !job.assignedCrewId).length,
      completed: serializedJobs.filter((job) => job.status === "completed").length,
      overdue: serializedJobs.filter((job) => job.isOverdue).length,
    },
  };
}

export async function createDispatchJob(input: {
  orgId: string;
  actorUserId: string | null;
  payload: DispatchJobPayload | null;
  todayDate?: string | null;
}): Promise<DispatchJobSummary> {
  const normalized = normalizeDispatchJobPayload(input.payload);
  const todayDateKey = resolveTodayDateKey(input.todayDate);
  const result = await prisma.$transaction(async (tx) => {
    await ensureDispatchCrewsForOrgWithClient(input.orgId, tx);
    const assignedCrew = await assertCrewBelongsToOrg({
      orgId: input.orgId,
      crewId: normalized.assignedCrewId,
      tx,
    });
    const linkedEstimate = await assertLinkedEstimateBelongsToOrg({
      orgId: input.orgId,
      estimateId: normalized.linkedEstimateId,
      tx,
    });
    const resolvedLeadId = normalized.leadId || linkedEstimate?.leadId || null;
    const lead = await assertLeadBelongsToOrg({
      orgId: input.orgId,
      leadId: resolvedLeadId,
      tx,
    });
    const customer = await assertCustomerBelongsToOrg({
      orgId: input.orgId,
      customerId: normalized.customerId,
      tx,
    });

    if (customer?.id && lead?.customerId && customer.id !== lead.customerId) {
      throw new AppApiError("Selected lead belongs to a different customer.", 400);
    }

    const customerId = await resolveDispatchCustomerId({
      orgId: input.orgId,
      customerId: customer?.id || null,
      leadCustomerId: lead?.customerId || null,
      phone: normalized.phone,
      tx,
    });
    const crewOrder = await getNextCrewOrder({
      orgId: input.orgId,
      scheduledDateKey: normalized.scheduledDateKey,
      assignedCrewId: assignedCrew?.id || null,
      tx,
    });

    const job = await tx.job.create({
      data: {
        orgId: input.orgId,
        createdByUserId: input.actorUserId,
        customerId,
        leadId: lead?.id || null,
        linkedEstimateId: linkedEstimate?.id || null,
        customerName: normalized.customerName,
        phone: normalized.phone,
        address: normalized.address,
        serviceType: normalized.serviceType,
        projectType: normalized.serviceType,
        scheduledDate: normalized.scheduledDate,
        scheduledStartTime: normalized.scheduledStartTime,
        scheduledEndTime: normalized.scheduledEndTime,
        dispatchStatus: dispatchStatusToDb(normalized.status),
        assignedCrewId: assignedCrew?.id || null,
        crewOrder,
        notes: normalized.notes,
        priority: normalized.priority,
      },
      select: dispatchJobBaseSelect,
    });

    const events: JobEventInput[] = [
      {
        eventType: "JOB_CREATED",
        metadata: createDispatchEventMetadataBase({
          customerId,
          leadId: lead?.id || null,
          linkedEstimateId: linkedEstimate?.id || null,
          scheduledDateKey: normalized.scheduledDateKey,
          scheduledStartTime: normalized.scheduledStartTime,
          scheduledEndTime: normalized.scheduledEndTime,
          status: normalized.status,
          assignedCrewId: assignedCrew?.id || null,
          assignedCrewName: assignedCrew?.name || null,
        }),
      },
    ];

    if (assignedCrew) {
      events.push({
        eventType: "CREW_ASSIGNED",
        toValue: assignedCrew.id,
        metadata: {
          ...createDispatchEventMetadataBase({
            customerId,
            leadId: lead?.id || null,
            linkedEstimateId: linkedEstimate?.id || null,
            scheduledDateKey: normalized.scheduledDateKey,
            scheduledStartTime: normalized.scheduledStartTime,
            scheduledEndTime: normalized.scheduledEndTime,
            status: normalized.status,
            assignedCrewId: assignedCrew.id,
            assignedCrewName: assignedCrew.name,
          }),
          crewName: assignedCrew.name,
        },
      });
    }

    const createdEvents = await writeJobEvents({
      tx,
      orgId: input.orgId,
      jobId: job.id,
      actorUserId: input.actorUserId,
      events,
    });

    return {
      job: serializeDispatchJob(job, todayDateKey),
      createdEvents,
    };
  });

  await maybeSendDispatchCustomerNotifications({
    orgId: input.orgId,
    actorUserId: input.actorUserId,
    jobId: result.job.id,
    events: result.createdEvents,
  });

  return result.job;
}

function buildMergedDispatchPayload(
  existing: {
    customerId: string | null;
    leadId: string | null;
    linkedEstimateId: string | null;
    customerName: string;
    phone: string | null;
    serviceType: string;
    address: string;
    scheduledDate: Date | null;
    scheduledStartTime: string | null;
    scheduledEndTime: string | null;
    assignedCrewId: string | null;
    notes: string | null;
    priority: string | null;
    dispatchStatus: Prisma.JobGetPayload<{ select: { dispatchStatus: true } }>["dispatchStatus"];
  },
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
    scheduledDate:
      payload?.scheduledDate ??
      (existing.scheduledDate ? formatDispatchDateKey(existing.scheduledDate) : null),
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

export async function updateDispatchJob(input: {
  orgId: string;
  actorUserId: string | null;
  jobId: string;
  payload: DispatchJobPayload | null;
  todayDate?: string | null;
}): Promise<DispatchJobDetail> {
  const existing = await prisma.job.findFirst({
    where: {
      id: input.jobId,
      orgId: input.orgId,
    },
    select: dispatchJobDetailSelect,
  });

  if (!existing) {
    throw new AppApiError("Dispatch job not found.", 404);
  }

  const normalized = normalizeDispatchJobPayload(buildMergedDispatchPayload(existing, input.payload));
  const createdEvents = await prisma.$transaction(async (tx) => {
    const crewMap = await getCrewMapForOrg({
      orgId: input.orgId,
      tx,
    });
    const assignedCrew = await assertCrewBelongsToOrg({
      orgId: input.orgId,
      crewId: normalized.assignedCrewId,
      tx,
    });
    const linkedEstimate = await assertLinkedEstimateBelongsToOrg({
      orgId: input.orgId,
      estimateId: normalized.linkedEstimateId,
      tx,
    });
    if (linkedEstimate?.leadId && normalized.leadId && linkedEstimate.leadId !== normalized.leadId) {
      throw new AppApiError("Selected lead does not match the linked estimate.", 400);
    }

    const resolvedLeadId = normalized.leadId || linkedEstimate?.leadId || null;
    const lead = await assertLeadBelongsToOrg({
      orgId: input.orgId,
      leadId: resolvedLeadId,
      tx,
    });
    const customer = await assertCustomerBelongsToOrg({
      orgId: input.orgId,
      customerId: normalized.customerId,
      tx,
    });

    if (customer?.id && lead?.customerId && customer.id !== lead.customerId) {
      throw new AppApiError("Selected lead belongs to a different customer.", 400);
    }

    const customerId = await resolveDispatchCustomerId({
      orgId: input.orgId,
      customerId: customer?.id || null,
      leadCustomerId: lead?.customerId || null,
      phone: normalized.phone,
      tx,
    });
    const existingDateKey = existing.scheduledDate ? formatDispatchDateKey(existing.scheduledDate) : null;
    const nextAssignedCrewId = assignedCrew?.id || null;
    const nextLeadId = lead?.id || null;
    const nextLinkedEstimateId = linkedEstimate?.id || null;
    const nextCrewOrder =
      existingDateKey !== normalized.scheduledDateKey ||
      existing.assignedCrewId !== nextAssignedCrewId ||
      existing.crewOrder == null
        ? await getNextCrewOrder({
            orgId: input.orgId,
            scheduledDateKey: normalized.scheduledDateKey,
            assignedCrewId: nextAssignedCrewId,
            tx,
          })
        : existing.crewOrder;

    await tx.job.update({
      where: {
        id: existing.id,
      },
      data: {
        customerId,
        leadId: nextLeadId,
        linkedEstimateId: nextLinkedEstimateId,
        customerName: normalized.customerName,
        phone: normalized.phone,
        serviceType: normalized.serviceType,
        projectType: normalized.serviceType,
        address: normalized.address,
        scheduledDate: normalized.scheduledDate,
        scheduledStartTime: normalized.scheduledStartTime,
        scheduledEndTime: normalized.scheduledEndTime,
        dispatchStatus: dispatchStatusToDb(normalized.status),
        assignedCrewId: nextAssignedCrewId,
        crewOrder: nextCrewOrder,
        notes: normalized.notes,
        priority: normalized.priority,
      },
    });

    const events: JobEventInput[] = [];
    if (existing.assignedCrewId !== nextAssignedCrewId) {
      events.push({
        eventType: existing.assignedCrewId ? "CREW_REASSIGNED" : "CREW_ASSIGNED",
        fromValue: existing.assignedCrewId,
        toValue: nextAssignedCrewId,
        metadata: {
          ...createDispatchEventMetadataBase({
            customerId,
            leadId: nextLeadId,
            linkedEstimateId: nextLinkedEstimateId,
            scheduledDateKey: normalized.scheduledDateKey,
            scheduledStartTime: normalized.scheduledStartTime,
            scheduledEndTime: normalized.scheduledEndTime,
            status: normalized.status,
            assignedCrewId: nextAssignedCrewId,
            assignedCrewName: nextAssignedCrewId ? assignedCrew?.name || null : null,
          }),
          fromCrewName: existing.assignedCrewId ? crewMap.get(existing.assignedCrewId)?.name || null : null,
          toCrewName: nextAssignedCrewId ? assignedCrew?.name || null : null,
        },
      });
    }

    if (existing.dispatchStatus !== dispatchStatusToDb(normalized.status)) {
      events.push({
        eventType: "STATUS_CHANGED",
        fromValue: dispatchStatusFromDb(existing.dispatchStatus),
        toValue: normalized.status,
        metadata: {
          ...createDispatchEventMetadataBase({
            customerId,
            leadId: nextLeadId,
            linkedEstimateId: nextLinkedEstimateId,
            scheduledDateKey: normalized.scheduledDateKey,
            scheduledStartTime: normalized.scheduledStartTime,
            scheduledEndTime: normalized.scheduledEndTime,
            status: normalized.status,
            assignedCrewId: nextAssignedCrewId,
            assignedCrewName: nextAssignedCrewId ? assignedCrew?.name || null : null,
          }),
          fromStatusLabel: formatDispatchStatusLabel(dispatchStatusFromDb(existing.dispatchStatus)),
          toStatusLabel: formatDispatchStatusLabel(normalized.status),
        },
      });
    }

    const fieldChanges = [
      {
        field: "customerId",
        from: existing.customerId,
        to: customerId,
      },
      {
        field: "leadId",
        from: existing.leadId,
        to: nextLeadId,
      },
      {
        field: "linkedEstimateId",
        from: existing.linkedEstimateId || existing.sourceEstimateId,
        to: nextLinkedEstimateId,
      },
      {
        field: "customerName",
        from: existing.customerName,
        to: normalized.customerName,
      },
      {
        field: "phone",
        from: existing.phone,
        to: normalized.phone,
      },
      {
        field: "serviceType",
        from: existing.serviceType,
        to: normalized.serviceType,
      },
      {
        field: "address",
        from: existing.address,
        to: normalized.address,
      },
      {
        field: "scheduledDate",
        from: existingDateKey,
        to: normalized.scheduledDateKey,
      },
      {
        field: "scheduledStartTime",
        from: existing.scheduledStartTime,
        to: normalized.scheduledStartTime,
      },
      {
        field: "scheduledEndTime",
        from: existing.scheduledEndTime,
        to: normalized.scheduledEndTime,
      },
      {
        field: "crewOrder",
        from: existing.crewOrder == null ? null : String(existing.crewOrder),
        to: nextCrewOrder == null ? null : String(nextCrewOrder),
      },
      {
        field: "priority",
        from: existing.priority,
        to: normalized.priority,
      },
      {
        field: "notes",
        from: existing.notes,
        to: normalized.notes,
      },
    ].filter((change) => change.from !== change.to);

    if (fieldChanges.length > 0) {
      events.push({
        eventType: "JOB_UPDATED",
        metadata: {
          ...createDispatchEventMetadataBase({
            customerId,
            leadId: nextLeadId,
            linkedEstimateId: nextLinkedEstimateId,
            scheduledDateKey: normalized.scheduledDateKey,
            scheduledStartTime: normalized.scheduledStartTime,
            scheduledEndTime: normalized.scheduledEndTime,
            status: normalized.status,
            assignedCrewId: nextAssignedCrewId,
            assignedCrewName: nextAssignedCrewId ? assignedCrew?.name || null : null,
          }),
          ...createJobUpdatedMetadata({
            changes: fieldChanges,
          }),
        },
      });
    }

    if (events.length > 0) {
      return writeJobEvents({
        tx,
        orgId: input.orgId,
        jobId: existing.id,
        actorUserId: input.actorUserId,
        events,
      });
    }
    return [];
  });

  await maybeSendDispatchCustomerNotifications({
    orgId: input.orgId,
    actorUserId: input.actorUserId,
    jobId: input.jobId,
    events: createdEvents,
  });

  return getDispatchJobDetail({
    orgId: input.orgId,
    jobId: input.jobId,
    todayDate: input.todayDate,
  });
}

export async function getDispatchJobDetail(input: {
  orgId: string;
  jobId: string;
  todayDate?: string | null;
}): Promise<DispatchJobDetail> {
  await ensureDispatchCrewsForOrg(input.orgId);
  const todayDateKey = resolveTodayDateKey(input.todayDate);

  const job = await prisma.job.findFirst({
    where: {
      id: input.jobId,
      orgId: input.orgId,
    },
    select: dispatchJobDetailSelect,
  });

  if (!job) {
    throw new AppApiError("Dispatch job not found.", 404);
  }

  const linkedEstimate = job.linkedEstimate || job.sourceEstimate;
  const leadIds = new Set<string>();
  if (job.leadId) leadIds.add(job.leadId);
  if (job.linkedEstimate?.leadId) leadIds.add(job.linkedEstimate.leadId);
  if (job.sourceEstimate?.leadId) leadIds.add(job.sourceEstimate.leadId);
  if (job.customerId) {
    const customerLeads = await prisma.lead.findMany({
      where: {
        orgId: input.orgId,
        customerId: job.customerId,
      },
      select: {
        id: true,
      },
      take: 10,
    });
    for (const lead of customerLeads) {
      leadIds.add(lead.id);
    }
  }

  const normalizedPhone = normalizeE164(job.phone);
  if (normalizedPhone) {
    const phoneLeads = await prisma.lead.findMany({
      where: {
        orgId: input.orgId,
        phoneE164: normalizedPhone,
      },
      select: {
        id: true,
      },
      take: 10,
    });
    for (const lead of phoneLeads) {
      leadIds.add(lead.id);
    }
  }

  const communicationEvents =
    job.customerId || leadIds.size > 0
      ? await prisma.communicationEvent.findMany({
          where: {
            orgId: input.orgId,
            OR: [
              ...(job.customerId ? [{ contactId: job.customerId }] : []),
              ...(leadIds.size > 0 ? [{ leadId: { in: [...leadIds] } }] : []),
            ],
          },
          select: {
            id: true,
            summary: true,
            channel: true,
            type: true,
            occurredAt: true,
            lead: {
              select: {
                contactName: true,
                businessName: true,
                phoneE164: true,
              },
            },
          },
          orderBy: [{ occurredAt: "desc" }],
          take: 6,
        })
      : [];

  const recentCommunication: DispatchCommunicationItem[] = communicationEvents.map((event) => ({
    id: event.id,
    summary: event.summary,
    channel: event.channel.toLowerCase(),
    type: event.type.toLowerCase(),
    occurredAt: event.occurredAt.toISOString(),
    leadLabel: event.lead
      ? event.lead.contactName || event.lead.businessName || event.lead.phoneE164
      : null,
  }));

  return {
    ...serializeDispatchJob(job, todayDateKey),
    linkedEstimate: serializeDispatchEstimate(linkedEstimate),
    recentCommunication,
  };
}

export async function reorderDispatchJobs(input: {
  orgId: string;
  actorUserId: string | null;
  date: string;
  columns: DispatchReorderPayload;
  todayDate?: string | null;
}) {
  const { start, end } = buildDayRange(input.date);
  const uniqueIds = new Set<string>();

  for (const column of input.columns) {
    for (const jobId of column.jobIds) {
      if (!jobId || uniqueIds.has(jobId)) {
        throw new AppApiError("Board reorder payload is invalid.", 400);
      }
      uniqueIds.add(jobId);
    }
  }

  await prisma.$transaction(async (tx) => {
    const crewMap = await getCrewMapForOrg({
      orgId: input.orgId,
      tx,
    });

    for (const column of input.columns) {
      if (!column.crewId) continue;
      const crew = crewMap.get(column.crewId);
      if (!crew) {
        throw new AppApiError("Board reorder payload included an unknown crew.", 400);
      }
      if (!crew.active) {
        throw new AppApiError("Inactive crews cannot receive new dispatch assignments.", 400);
      }
    }

    const jobs = await tx.job.findMany({
      where: {
        orgId: input.orgId,
        id: {
          in: [...uniqueIds],
        },
        scheduledDate: {
          gte: start,
          lt: end,
        },
      },
      select: {
        id: true,
        customerId: true,
        leadId: true,
        linkedEstimateId: true,
        scheduledDate: true,
        scheduledStartTime: true,
        scheduledEndTime: true,
        dispatchStatus: true,
        assignedCrewId: true,
        crewOrder: true,
      },
    });

    if (jobs.length !== uniqueIds.size) {
      throw new AppApiError("One or more dispatch jobs were not found for the selected day.", 404);
    }

    const jobsById = new Map(jobs.map((job) => [job.id, job] as const));

    for (const column of input.columns) {
      for (const [index, jobId] of column.jobIds.entries()) {
        const existing = jobsById.get(jobId);
        if (!existing) continue;

        const nextCrewId = column.crewId;
        const nextOrder = index;
        if (existing.assignedCrewId === nextCrewId && existing.crewOrder === nextOrder) {
          continue;
        }

        await tx.job.update({
          where: {
            id: existing.id,
          },
          data: {
            assignedCrewId: nextCrewId,
            crewOrder: nextOrder,
          },
        });

        const events: JobEventInput[] = [];
        const scheduledDateKey = existing.scheduledDate ? formatDispatchDateKey(existing.scheduledDate) : input.date;
        const status = dispatchStatusFromDb(existing.dispatchStatus);
        if (existing.assignedCrewId !== nextCrewId) {
          events.push({
            eventType: existing.assignedCrewId ? "CREW_REASSIGNED" : "CREW_ASSIGNED",
            fromValue: existing.assignedCrewId,
            toValue: nextCrewId,
            metadata: {
              ...createDispatchEventMetadataBase({
                customerId: existing.customerId,
                leadId: existing.leadId,
                linkedEstimateId: existing.linkedEstimateId,
                scheduledDateKey,
                scheduledStartTime: existing.scheduledStartTime,
                scheduledEndTime: existing.scheduledEndTime,
                status,
                assignedCrewId: nextCrewId,
                assignedCrewName: nextCrewId ? crewMap.get(nextCrewId)?.name || null : null,
              }),
              fromCrewName: existing.assignedCrewId ? crewMap.get(existing.assignedCrewId)?.name || null : null,
              toCrewName: nextCrewId ? crewMap.get(nextCrewId)?.name || null : null,
            },
          });
        }

        if (existing.crewOrder !== nextOrder) {
          events.push({
            eventType: "JOB_UPDATED",
            fromValue: existing.crewOrder == null ? null : String(existing.crewOrder),
            toValue: String(nextOrder),
            metadata: {
              ...createDispatchEventMetadataBase({
                customerId: existing.customerId,
                leadId: existing.leadId,
                linkedEstimateId: existing.linkedEstimateId,
                scheduledDateKey,
                scheduledStartTime: existing.scheduledStartTime,
                scheduledEndTime: existing.scheduledEndTime,
                status,
                assignedCrewId: nextCrewId,
                assignedCrewName: nextCrewId ? crewMap.get(nextCrewId)?.name || null : null,
              }),
              changes: [
                {
                  field: "crewOrder",
                  from: existing.crewOrder == null ? null : String(existing.crewOrder),
                  to: String(nextOrder),
                },
              ],
            },
          });
        }

        if (events.length > 0) {
          await writeJobEvents({
            tx,
            orgId: input.orgId,
            jobId: existing.id,
            actorUserId: input.actorUserId,
            events,
          });
        }
      }
    }
  });

  return getDispatchDaySnapshot({
    orgId: input.orgId,
    date: input.date,
    todayDate: input.todayDate,
  });
}

function normalizeCrewName(value: unknown): string {
  return normalizeRequiredText(value, "Crew name", 80);
}

function normalizeOptionalBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
}

export async function getDispatchCrewSettings(orgId: string): Promise<DispatchCrewManagementItem[]> {
  const crews = await ensureDispatchCrewsForOrg(orgId);
  const openStatuses = ["SCHEDULED", "ON_THE_WAY", "ON_SITE"] as const;
  const counts = await prisma.job.groupBy({
    by: ["assignedCrewId"],
    where: {
      orgId,
      assignedCrewId: {
        in: crews.map((crew) => crew.id),
      },
      dispatchStatus: {
        in: [...openStatuses],
      },
    },
    _count: {
      _all: true,
    },
  });
  const openJobCountByCrew = new Map(
    counts
      .filter((row): row is typeof row & { assignedCrewId: string } => Boolean(row.assignedCrewId))
      .map((row) => [row.assignedCrewId, row._count._all] as const),
  );

  return crews.map((crew) => ({
    id: crew.id,
    name: crew.name,
    active: crew.active,
    openJobCount: openJobCountByCrew.get(crew.id) || 0,
  }));
}

export async function updateDispatchCrew(input: {
  orgId: string;
  crewId: string;
  payload: {
    name?: unknown;
    active?: unknown;
  } | null;
}): Promise<DispatchCrewManagementItem[]> {
  await ensureDispatchCrewsForOrg(input.orgId);

  const existing = await prisma.crew.findFirst({
    where: {
      id: input.crewId,
      orgId: input.orgId,
    },
    select: {
      id: true,
      name: true,
      active: true,
    },
  });

  if (!existing) {
    throw new AppApiError("Crew was not found for this workspace.", 404);
  }

  const name =
    input.payload && Object.prototype.hasOwnProperty.call(input.payload, "name")
      ? normalizeCrewName(input.payload.name)
      : existing.name;
  const active =
    input.payload && Object.prototype.hasOwnProperty.call(input.payload, "active")
      ? normalizeOptionalBoolean(input.payload.active, existing.active)
      : existing.active;

  if (!active) {
    const openAssignments = await prisma.job.count({
      where: {
        orgId: input.orgId,
        assignedCrewId: existing.id,
        dispatchStatus: {
          in: ["SCHEDULED", "ON_THE_WAY", "ON_SITE"],
        },
      },
    });

    if (openAssignments > 0) {
      throw new AppApiError("Move open jobs off this crew before setting it inactive.", 409);
    }
  }

  try {
    await prisma.crew.update({
      where: {
        id: existing.id,
      },
      data: {
        name,
        active,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppApiError("Crew name must be unique inside this workspace.", 409);
    }
    throw error;
  }

  return getDispatchCrewSettings(input.orgId);
}
