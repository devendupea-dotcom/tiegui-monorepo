import "server-only";

import { Prisma, type JobEventType } from "@prisma/client";
import { AppApiError } from "@/lib/app-api-permissions";
import { bookingEventTypes, deriveJobBookingProjection } from "@/lib/booking-read-model";
import { formatDateTimeForDisplay } from "@/lib/calendar/dates";
import {
  dispatchStatusFromDb,
  formatDispatchScheduledWindow,
  isDispatchStatusValue,
} from "@/lib/dispatch";
import {
  buildJobTrackingProgressSteps,
  createJobTrackingToken,
  describeJobTrackingStatusChange,
  formatOperationalJobStatusLabel,
  formatJobTrackingStatusLabel,
  type CustomerJobTrackingDetail,
  type JobTrackingTimelineItem,
} from "@/lib/job-tracking";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/tokens";

const publicTrackingInclude = {
  job: {
    select: {
      id: true,
      orgId: true,
      customerId: true,
      leadId: true,
      customerName: true,
      address: true,
      serviceType: true,
      scheduledDate: true,
      scheduledStartTime: true,
      scheduledEndTime: true,
      dispatchStatus: true,
      assignedCrew: {
        select: {
          name: true,
        },
      },
      calendarEvents: {
        where: {
          type: {
            in: bookingEventTypes,
          },
        },
        select: {
          id: true,
          type: true,
          status: true,
          startAt: true,
          endAt: true,
          createdAt: true,
          updatedAt: true,
          jobId: true,
        },
        orderBy: [{ startAt: "asc" }, { createdAt: "asc" }],
        take: 12,
      },
      linkedEstimate: {
        select: {
          title: true,
        },
      },
      sourceEstimate: {
        select: {
          title: true,
        },
      },
      org: {
        select: {
          name: true,
          phone: true,
          email: true,
          website: true,
          dashboardConfig: {
            select: {
              calendarTimezone: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.JobTrackingLinkInclude;

type PublicTrackingRecord = Prisma.JobTrackingLinkGetPayload<{
  include: typeof publicTrackingInclude;
}>;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function recordString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function recordChanges(
  record: Record<string, unknown> | null,
): {
  field: string;
  from: string | null;
  to: string | null;
}[] {
  const raw = record?.changes;
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry) => {
      const change = asRecord(entry);
      const field = recordString(change, "field");
      if (!field) return null;

      const from = change?.from;
      const to = change?.to;
      return {
        field,
        from: typeof from === "string" ? from : null,
        to: typeof to === "string" ? to : null,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

function formatTrackingDate(value: Date): string {
  return formatDateTimeForDisplay(value, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }, { timeZone: "UTC" });
}

function formatTimelineDateTime(value: Date): string {
  return formatDateTimeForDisplay(value, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildScheduleSummary(input: {
  scheduledDate: Date | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
}): string | null {
  if (!input.scheduledDate) return null;

  const dateLabel = formatTrackingDate(input.scheduledDate);
  const windowLabel = formatDispatchScheduledWindow(input.scheduledStartTime, input.scheduledEndTime);
  if (windowLabel === "Any time") {
    return `Scheduled for ${dateLabel}.`;
  }
  return `Scheduled for ${dateLabel}, ${windowLabel}.`;
}

function buildPendingScheduleSummary() {
  return "Scheduling is still being confirmed.";
}

function buildEventScheduleSummary(metadata: Record<string, unknown> | null): string | null {
  const scheduledDate = recordString(metadata, "scheduledDate");
  if (!scheduledDate) return null;

  const parsed = new Date(`${scheduledDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;

  return buildScheduleSummary({
    scheduledDate: parsed,
    scheduledStartTime: recordString(metadata, "scheduledStartTime"),
    scheduledEndTime: recordString(metadata, "scheduledEndTime"),
  });
}

function buildManualFollowThroughDetail(metadata: Record<string, unknown> | null): {
  title: string;
  detail: string;
} | null {
  if (metadata?.dispatchManualFollowThrough !== true) {
    return null;
  }

  const state = recordString(metadata, "dispatchManualFollowThroughState");
  const actionId = recordString(metadata, "dispatchManualFollowThroughActionId");
  const actionLabel =
    actionId === "open-inbox" ? "Open Inbox Thread"
    : actionId === "open-crm" ? "Open CRM Folder"
    : actionId === "edit-phone" ? "Edit Phone"
    : actionId === "call-customer" ? "Call Customer"
    : actionId === "open-settings" ? "Open Settings"
    : actionId === "open-integrations" ? "Open Integrations"
    : actionId === "mark-handled" ? "Mark Handled Manually"
    : null;

  if (state === "handled") {
    return {
      title: "Handled manually",
      detail: actionLabel && actionLabel !== "Mark Handled Manually"
        ? `Manual follow-up was handled after ${actionLabel}.`
        : "Manual follow-up was marked handled.",
    };
  }

  if (state === "started") {
    return {
      title: "Manual follow-up started",
      detail: actionLabel ? `Started from ${actionLabel}.` : "Manual follow-up started.",
    };
  }

  return null;
}

function buildManualContactOutcomeDetail(metadata: Record<string, unknown> | null): {
  title: string;
  detail: string;
} | null {
  if (metadata?.dispatchManualContactOutcome !== true) {
    return null;
  }

  const outcome = recordString(metadata, "dispatchManualContactOutcomeValue");
  if (outcome === "confirmed_schedule") {
    return {
      title: "Confirmed schedule",
      detail: "Manual contact confirmed the current timing.",
    };
  }

  if (outcome === "reschedule_needed") {
    return {
      title: "Reschedule needed",
      detail: "Manual contact confirmed the schedule still needs to change.",
    };
  }

  if (outcome === "no_response") {
    return {
      title: "No response",
      detail: "Manual contact was attempted, but the customer did not respond.",
    };
  }

  return null;
}

function mapJobEventToTimelineItem(input: {
  event: {
    id: string;
    eventType: JobEventType;
    fromValue: string | null;
    toValue: string | null;
    metadata: Prisma.JsonValue | null;
    createdAt: Date;
  };
  job: {
    id: string;
    scheduledDate: Date | null;
    scheduledStartTime: string | null;
    scheduledEndTime: string | null;
  };
}): JobTrackingTimelineItem | null {
  const metadata = asRecord(input.event.metadata);

  if (input.event.eventType === "JOB_CREATED") {
    return {
      id: input.event.id,
      kind: "job_event",
      title: "Job scheduled",
      detail:
        buildEventScheduleSummary(metadata) ||
        buildScheduleSummary({
          scheduledDate: input.job.scheduledDate,
          scheduledStartTime: input.job.scheduledStartTime,
          scheduledEndTime: input.job.scheduledEndTime,
        }) ||
        "Your contractor added this work to the schedule.",
      occurredAt: input.event.createdAt.toISOString(),
    };
  }

  if (input.event.eventType === "CREW_ASSIGNED" || input.event.eventType === "CREW_REASSIGNED") {
    const crewName =
      recordString(metadata, "toCrewName") ||
      recordString(metadata, "assignedCrewName") ||
      recordString(metadata, "crewName");

    return {
      id: input.event.id,
      kind: "job_event",
      title: input.event.eventType === "CREW_REASSIGNED" ? "Crew updated" : "Crew assigned",
      detail: crewName ? `${crewName} is assigned to this visit.` : "A crew has been assigned to this visit.",
      occurredAt: input.event.createdAt.toISOString(),
    };
  }

  if (input.event.eventType === "STATUS_CHANGED") {
    const nextStatus =
      typeof input.event.toValue === "string" && isDispatchStatusValue(input.event.toValue)
        ? input.event.toValue
        : null;
    const statusLabel =
      (nextStatus ? formatJobTrackingStatusLabel(nextStatus) : null) ||
      (typeof input.event.toValue === "string" ? formatOperationalJobStatusLabel(input.event.toValue) : null) ||
      recordString(metadata, "toStatusLabel") ||
      recordString(metadata, "statusLabel") ||
      "Updated";
    const statusKind = recordString(metadata, "statusKind");
    const statusCopy = describeJobTrackingStatusChange({
      statusKind,
      nextStatusLabel: statusLabel,
    });

    return {
      id: input.event.id,
      kind: "job_event",
      title: statusCopy.title,
      detail: statusCopy.detail,
      occurredAt: input.event.createdAt.toISOString(),
    };
  }

  if (input.event.eventType !== "JOB_UPDATED") {
    return null;
  }

  const changes = recordChanges(metadata);
  const manualContactOutcome = buildManualContactOutcomeDetail(metadata);
  if (manualContactOutcome) {
    return {
      id: input.event.id,
      kind: "job_event",
      title: manualContactOutcome.title,
      detail: manualContactOutcome.detail,
      occurredAt: input.event.createdAt.toISOString(),
    };
  }
  const manualFollowThrough = buildManualFollowThroughDetail(metadata);
  if (manualFollowThrough) {
    return {
      id: input.event.id,
      kind: "job_event",
      title: manualFollowThrough.title,
      detail: manualFollowThrough.detail,
      occurredAt: input.event.createdAt.toISOString(),
    };
  }

  const scheduleChanged = changes.some((change) =>
    change.field === "scheduledDate" ||
    change.field === "scheduledStartTime" ||
    change.field === "scheduledEndTime",
  );

  if (!scheduleChanged) {
    return null;
  }

  return {
    id: input.event.id,
    kind: "job_event",
    title: "Schedule updated",
    detail:
      buildEventScheduleSummary(metadata) ||
      buildScheduleSummary({
        scheduledDate: input.job.scheduledDate,
        scheduledStartTime: input.job.scheduledStartTime,
        scheduledEndTime: input.job.scheduledEndTime,
      }) ||
      "The scheduled timing was updated.",
    occurredAt: input.event.createdAt.toISOString(),
  };
}

function mapCommunicationEventToTimelineItem(event: {
  id: string;
  summary: string;
  occurredAt: Date;
}): JobTrackingTimelineItem {
  return {
    id: event.id,
    kind: "communication",
    title: "Text update sent",
    detail: event.summary,
    occurredAt: event.occurredAt.toISOString(),
  };
}

async function getPublicTrackingRecordOrThrow(token: string): Promise<PublicTrackingRecord> {
  const normalizedToken = typeof token === "string" ? token.trim() : "";
  if (!normalizedToken) {
    throw new AppApiError("This tracking link is invalid.", 404);
  }

  const tokenHash = hashToken(normalizedToken);
  const record = await prisma.jobTrackingLink.findUnique({
    where: { tokenHash },
    include: publicTrackingInclude,
  });

  if (!record) {
    throw new AppApiError("This tracking link is invalid.", 404);
  }

  if (record.revokedAt) {
    throw new AppApiError("This tracking link has been replaced with a newer link.", 410);
  }

  return record;
}

export type OperationalJobTimelineSource = {
  id: string;
  orgId: string;
  customerId: string | null;
  leadId: string | null;
  scheduledDate: Date | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
};

export async function getOperationalJobTimeline(input: {
  job: OperationalJobTimelineSource;
  limit?: number;
}): Promise<JobTrackingTimelineItem[]> {
  const limit = Math.max(1, Math.min(32, input.limit || 16));

  const [jobEvents, communicationEvents] = await Promise.all([
    prisma.jobEvent.findMany({
      where: {
        jobId: input.job.id,
      },
      select: {
        id: true,
        eventType: true,
        fromValue: true,
        toValue: true,
        metadata: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "desc" }],
      take: Math.max(limit * 2, 24),
    }),
    input.job.customerId || input.job.leadId
      ? prisma.communicationEvent.findMany({
          where: {
            orgId: input.job.orgId,
            OR: [
              ...(input.job.customerId ? [{ contactId: input.job.customerId }] : []),
              ...(input.job.leadId ? [{ leadId: input.job.leadId }] : []),
            ],
          },
          select: {
            id: true,
            summary: true,
            occurredAt: true,
            metadataJson: true,
          },
          orderBy: [{ occurredAt: "desc" }],
          take: Math.max(limit * 2, 24),
        })
      : Promise.resolve([]),
  ]);

  const jobTimeline = jobEvents
    .map((event) =>
      mapJobEventToTimelineItem({
        event,
        job: input.job,
      }),
    )
    .filter((event): event is JobTrackingTimelineItem => Boolean(event));

  const communicationTimeline = communicationEvents
    .filter((event) => recordString(asRecord(event.metadataJson), "dispatchJobId") === input.job.id)
    .map((event) => mapCommunicationEventToTimelineItem(event));

  return [...jobTimeline, ...communicationTimeline]
    .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
    .slice(0, limit);
}

export async function createJobTrackingLink(input: {
  orgId: string;
  jobId: string;
  actorId: string | null;
  baseUrl: string;
}): Promise<{ trackingUrl: string }> {
  const job = await prisma.job.findFirst({
    where: {
      id: input.jobId,
      orgId: input.orgId,
    },
    select: {
      id: true,
    },
  });

  if (!job) {
    throw new AppApiError("Dispatch job not found.", 404);
  }

  const now = new Date();
  const { token, tokenHash } = createJobTrackingToken();

  await prisma.$transaction(async (tx) => {
    await tx.jobTrackingLink.updateMany({
      where: {
        orgId: input.orgId,
        jobId: input.jobId,
        revokedAt: null,
      },
      data: {
        revokedAt: now,
      },
    });

    await tx.jobTrackingLink.create({
      data: {
        orgId: input.orgId,
        jobId: input.jobId,
        createdByUserId: input.actorId,
        tokenHash,
      },
    });
  });

  return {
    trackingUrl: `${input.baseUrl.replace(/\/$/, "")}/track/${token}`,
  };
}

export async function getJobTrackingByToken(token: string): Promise<CustomerJobTrackingDetail> {
  const record = await getPublicTrackingRecordOrThrow(token);
  const bookingProjection = deriveJobBookingProjection({
    events: record.job.calendarEvents,
    timeZone: record.job.org.dashboardConfig?.calendarTimezone || null,
  });
  const trackingScheduleSource = {
    id: record.job.id,
    scheduledDate: bookingProjection.scheduledDate,
    scheduledStartTime: bookingProjection.scheduledStartTime,
    scheduledEndTime: bookingProjection.scheduledEndTime,
  };
  const scheduleWindow = bookingProjection.hasBookingEvent
    ? formatDispatchScheduledWindow(bookingProjection.scheduledStartTime, bookingProjection.scheduledEndTime)
    : buildPendingScheduleSummary();

  const [jobEvents, communicationEvents] = await Promise.all([
    prisma.jobEvent.findMany({
      where: {
        jobId: record.job.id,
      },
      select: {
        id: true,
        eventType: true,
        fromValue: true,
        toValue: true,
        metadata: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "desc" }],
      take: 24,
    }),
    record.job.customerId || record.job.leadId
      ? prisma.communicationEvent.findMany({
          where: {
            orgId: record.job.orgId,
            OR: [
              ...(record.job.customerId ? [{ contactId: record.job.customerId }] : []),
              ...(record.job.leadId ? [{ leadId: record.job.leadId }] : []),
            ],
          },
          select: {
            id: true,
            summary: true,
            occurredAt: true,
            metadataJson: true,
          },
          orderBy: [{ occurredAt: "desc" }],
          take: 24,
        })
      : Promise.resolve([]),
  ]);

  const jobTimeline = jobEvents
    .map((event) =>
      mapJobEventToTimelineItem({
        event,
        job: trackingScheduleSource,
      }),
    )
    .filter((event): event is JobTrackingTimelineItem => Boolean(event));

  const communicationTimeline = communicationEvents
    .filter((event) => recordString(asRecord(event.metadataJson), "dispatchJobId") === record.job.id)
    .map((event) => mapCommunicationEventToTimelineItem(event));

  const timeline = [...jobTimeline, ...communicationTimeline]
    .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
    .slice(0, 16);

  const status = dispatchStatusFromDb(record.job.dispatchStatus);
  const estimateTitle = record.job.linkedEstimate?.title || record.job.sourceEstimate?.title || null;

  return {
    jobId: record.job.id,
    trackingTitle: estimateTitle || record.job.serviceType || "Project update",
    customerName: record.job.customerName,
    address: record.job.address,
    currentStatus: status,
    currentStatusLabel: formatJobTrackingStatusLabel(status),
    scheduledDate: bookingProjection.scheduledDate ? formatTrackingDate(bookingProjection.scheduledDate) : null,
    scheduledWindow: scheduleWindow,
    assignedCrewName: record.job.assignedCrew?.name || null,
    contractor: {
      name: record.job.org.name,
      phone: record.job.org.phone || "",
      email: record.job.org.email || "",
      website: record.job.org.website || "",
    },
    progressSteps: buildJobTrackingProgressSteps(status),
    timeline: timeline.map((item) => ({
      ...item,
      detail: item.detail,
      occurredAt: new Date(item.occurredAt).toISOString(),
    })),
  };
}

export function formatJobTrackingTimelineDateTime(value: string): string {
  return formatTimelineDateTime(new Date(value));
}
