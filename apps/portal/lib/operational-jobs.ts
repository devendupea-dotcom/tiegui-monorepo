import { Prisma, type CalendarEventStatus, type DispatchJobStatus, type EventType, type JobStatus } from "@prisma/client";
import { DEFAULT_CALENDAR_TIMEZONE, ensureTimeZone, zonedDateString, zonedTimeString } from "@/lib/calendar/dates";
import { parseDispatchDateKey } from "@/lib/dispatch";
import { jobReferencesEstimate } from "@/lib/estimate-job-linking";

const OPERATIONAL_BOOKING_EVENT_TYPES: EventType[] = ["JOB", "ESTIMATE"];
const REUSABLE_OPERATIONAL_JOB_STATUSES: JobStatus[] = ["DRAFT", "ESTIMATING", "SCHEDULED", "IN_PROGRESS", "ON_HOLD"];

export const operationalJobCandidateSelect = {
  id: true,
  orgId: true,
  leadId: true,
  customerId: true,
  sourceEstimateId: true,
  linkedEstimateId: true,
  customerName: true,
  phone: true,
  address: true,
  serviceType: true,
  projectType: true,
  scheduledDate: true,
  scheduledStartTime: true,
  scheduledEndTime: true,
  dispatchStatus: true,
  notes: true,
  status: true,
  updatedAt: true,
} satisfies Prisma.JobSelect;

export type OperationalJobCandidate = Prisma.JobGetPayload<{
  select: typeof operationalJobCandidateSelect;
}>;

export function isOperationalBookingEventType(type: EventType): boolean {
  return OPERATIONAL_BOOKING_EVENT_TYPES.includes(type);
}

export function isReusableOperationalJobStatus(status: JobStatus): boolean {
  return REUSABLE_OPERATIONAL_JOB_STATUSES.includes(status);
}

export function selectExplicitOperationalBookingJobCandidate(input: {
  eventLeadId?: string | null;
  eventJob: OperationalJobCandidate | null;
}): OperationalJobCandidate | null {
  if (!input.eventLeadId || !input.eventJob) {
    return null;
  }
  return input.eventJob.leadId === input.eventLeadId ? input.eventJob : null;
}

export function mapBookingEventToOperationalJobState(input: {
  type: EventType;
  status: CalendarEventStatus;
}): {
  jobStatus: JobStatus;
  dispatchStatus: DispatchJobStatus;
} {
  return {
    jobStatus: input.type === "ESTIMATE" ? "ESTIMATING" : "SCHEDULED",
    dispatchStatus: "SCHEDULED",
  };
}

type SelectReusableOperationalJobCandidateInput = {
  candidates: OperationalJobCandidate[];
  preferredJobId?: string | null;
  preferredEstimateId?: string | null;
};

export function selectReusableOperationalJobCandidate(
  input: SelectReusableOperationalJobCandidateInput,
): OperationalJobCandidate | null {
  if (input.candidates.length === 0) {
    return null;
  }

  if (input.preferredJobId) {
    const exactJob = input.candidates.find((candidate) => candidate.id === input.preferredJobId);
    if (exactJob) {
      return exactJob;
    }
  }

  if (input.preferredEstimateId) {
    const exactEstimateJob = input.candidates.find(
      (candidate) => jobReferencesEstimate(candidate, input.preferredEstimateId),
    );
    if (exactEstimateJob) {
      return exactEstimateJob;
    }
  }

  const activeCandidates = input.candidates.filter((candidate) => isReusableOperationalJobStatus(candidate.status));
  if (activeCandidates.length === 1) {
    return activeCandidates[0] || null;
  }

  const unlinkedActive = activeCandidates.find((candidate) => !candidate.sourceEstimateId && !candidate.linkedEstimateId);
  if (unlinkedActive) {
    return unlinkedActive;
  }

  return input.candidates.length === 1 ? input.candidates[0] || null : null;
}

export async function findOperationalJobForLead(
  tx: Prisma.TransactionClient,
  input: {
    orgId: string;
    leadId?: string | null;
    preferredJobId?: string | null;
    preferredEstimateId?: string | null;
  },
): Promise<OperationalJobCandidate | null> {
  const clauses: Prisma.JobWhereInput[] = [];
  if (input.leadId) {
    clauses.push({
      orgId: input.orgId,
      leadId: input.leadId,
    });
  }
  if (input.preferredJobId) {
    clauses.push({
      orgId: input.orgId,
      id: input.preferredJobId,
    });
  }
  if (input.preferredEstimateId) {
    clauses.push({
      orgId: input.orgId,
      sourceEstimateId: input.preferredEstimateId,
    });
    clauses.push({
      orgId: input.orgId,
      linkedEstimateId: input.preferredEstimateId,
    });
  }

  if (clauses.length === 0) {
    return null;
  }

  const candidates = await tx.job.findMany({
    where: clauses.length === 1 ? clauses[0] : { OR: clauses },
    select: operationalJobCandidateSelect,
    orderBy: [{ updatedAt: "desc" }],
    take: 12,
  });

  return selectReusableOperationalJobCandidate({
    candidates,
    preferredJobId: input.preferredJobId,
    preferredEstimateId: input.preferredEstimateId,
  });
}

function buildBookingServiceType(input: {
  existingJob: OperationalJobCandidate | null;
  leadWorkType: string | null | undefined;
  eventType: EventType;
}) {
  const workType = input.leadWorkType?.trim();
  if (workType) {
    return workType;
  }
  if (input.existingJob?.serviceType?.trim()) {
    return input.existingJob.serviceType.trim();
  }
  return input.eventType === "ESTIMATE" ? "Estimate Visit" : "Scheduled Job";
}

function sameDate(left: Date | null, right: Date | null) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return left.getTime() === right.getTime();
}

export async function ensureOperationalJobFromLeadBooking(
  tx: Prisma.TransactionClient,
  input: {
    orgId: string;
    leadId: string | null | undefined;
    eventId: string;
    type: EventType;
    status: CalendarEventStatus;
    startAt: Date;
    endAt: Date | null;
    title?: string | null;
    customerName?: string | null;
    addressLine?: string | null;
    createdByUserId?: string | null;
    createIfMissing?: boolean;
    persistEventLink?: boolean;
    persistJobChanges?: boolean;
  },
): Promise<{ jobId: string | null; created: boolean }> {
  if (!input.leadId || !isOperationalBookingEventType(input.type)) {
    return { jobId: null, created: false };
  }

  const bookingEvent = await tx.event.findFirst({
    where: {
      id: input.eventId,
      orgId: input.orgId,
    },
    select: {
      id: true,
      leadId: true,
      jobId: true,
      job: {
        select: operationalJobCandidateSelect,
      },
    },
  });

  const lead = await tx.lead.findFirst({
    where: {
      id: input.leadId,
      orgId: input.orgId,
    },
    select: {
      id: true,
      orgId: true,
      customerId: true,
      contactName: true,
      businessName: true,
      phoneE164: true,
      intakeLocationText: true,
      intakeWorkTypeText: true,
    },
  });

  if (!lead) {
    return { jobId: null, created: false };
  }

  const explicitEventJob = selectExplicitOperationalBookingJobCandidate({
    eventLeadId: input.leadId,
    eventJob: bookingEvent?.job || null,
  });
  const existingJob =
    explicitEventJob ||
    (await findOperationalJobForLead(tx, {
      orgId: lead.orgId,
      leadId: lead.id,
    }));
  const shouldCreate =
    input.createIfMissing !== false
    && input.persistJobChanges !== false
    && input.status !== "COMPLETED"
    && input.status !== "CANCELLED"
    && input.status !== "NO_SHOW";
  if (!existingJob && !shouldCreate) {
    return { jobId: null, created: false };
  }

  const config = await tx.orgDashboardConfig.findUnique({
    where: { orgId: lead.orgId },
    select: { calendarTimezone: true },
  });
  const timeZone = ensureTimeZone(config?.calendarTimezone || DEFAULT_CALENDAR_TIMEZONE);
  const scheduledDateKey = zonedDateString(input.startAt, timeZone);
  const scheduledDate = parseDispatchDateKey(scheduledDateKey);
  const scheduledStartTime = zonedTimeString(input.startAt, timeZone);
  const scheduledEndTime = input.endAt ? zonedTimeString(input.endAt, timeZone) : null;
  const mappedState = mapBookingEventToOperationalJobState({
    type: input.type,
    status: input.status,
  });

  const customerName =
    input.customerName?.trim() ||
    lead.contactName ||
    lead.businessName ||
    existingJob?.customerName ||
    lead.phoneE164;
  const address = input.addressLine?.trim() || lead.intakeLocationText || existingJob?.address || "";
  const serviceType = buildBookingServiceType({
    existingJob,
    leadWorkType: lead.intakeWorkTypeText,
    eventType: input.type,
  });
  const projectType = lead.intakeWorkTypeText?.trim() || existingJob?.projectType || serviceType;

  if (!existingJob) {
    const job = await tx.job.create({
      data: {
        orgId: lead.orgId,
        createdByUserId: input.createdByUserId || null,
        customerId: lead.customerId || null,
        leadId: lead.id,
        customerName,
        phone: lead.phoneE164,
        address,
        serviceType,
        projectType,
        scheduledDate,
        scheduledStartTime,
        scheduledEndTime,
        dispatchStatus: mappedState.dispatchStatus,
        status: mappedState.jobStatus,
      },
      select: { id: true },
    });

    if (input.persistEventLink !== false) {
      await tx.event.update({
        where: { id: input.eventId },
        data: {
          jobId: job.id,
        },
      });
    }

    await tx.jobEvent.create({
      data: {
        orgId: lead.orgId,
        jobId: job.id,
        actorUserId: input.createdByUserId || null,
        eventType: "JOB_CREATED",
        metadata: {
          source: "lead_booking",
          leadId: lead.id,
          calendarEventId: input.eventId,
          calendarEventType: input.type,
          calendarEventStatus: input.status,
          calendarEventTitle: input.title?.trim() || null,
          scheduledDate: scheduledDateKey,
          scheduledStartTime,
          scheduledEndTime,
        },
      },
    });

    return { jobId: job.id, created: true };
  }

  const updateData: Prisma.JobUpdateInput = {};
  if (!existingJob.leadId) {
    updateData.lead = { connect: { id: lead.id } };
  }
  if (existingJob.customerId !== (lead.customerId || null)) {
    updateData.customer = lead.customerId ? { connect: { id: lead.customerId } } : { disconnect: true };
  }
  if (existingJob.customerName !== customerName) {
    updateData.customerName = customerName;
  }
  if (existingJob.phone !== lead.phoneE164) {
    updateData.phone = lead.phoneE164;
  }
  if (existingJob.address !== address) {
    updateData.address = address;
  }
  if (existingJob.serviceType !== serviceType) {
    updateData.serviceType = serviceType;
  }
  if (existingJob.projectType !== projectType) {
    updateData.projectType = projectType;
  }
  if (!sameDate(existingJob.scheduledDate, scheduledDate)) {
    updateData.scheduledDate = scheduledDate;
  }
  if (existingJob.scheduledStartTime !== scheduledStartTime) {
    updateData.scheduledStartTime = scheduledStartTime;
  }
  if (existingJob.scheduledEndTime !== scheduledEndTime) {
    updateData.scheduledEndTime = scheduledEndTime;
  }

  if (input.persistJobChanges !== false && Object.keys(updateData).length > 0) {
    await tx.job.update({
      where: { id: existingJob.id },
      data: updateData,
    });
  }

  if (input.persistEventLink !== false && bookingEvent?.jobId !== existingJob.id) {
    await tx.event.update({
      where: { id: input.eventId },
      data: {
        jobId: existingJob.id,
      },
    });
  }

  return { jobId: existingJob.id, created: false };
}
