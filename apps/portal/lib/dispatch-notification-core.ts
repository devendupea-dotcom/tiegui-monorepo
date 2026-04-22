import type { JobEventType, Prisma } from "@prisma/client";
import { bookingEventTypes, deriveJobBookingProjection } from "@/lib/booking-read-model";
import {
  describeDispatchNotificationBlockedReason,
  dispatchStatusFromDb,
  formatDispatchCustomerSms,
  formatDispatchStatusLabel,
  getDispatchScheduleChangeFields,
  isDispatchStatusValue,
  isMeaningfulDispatchScheduleChange,
  shouldSendDispatchStatusNotification,
  type DispatchNotificationSettings,
  type DispatchScheduleChangeField,
  type DispatchSmsDeliveryState,
  type DispatchSmsRemediation,
  type DispatchStatusValue,
} from "@/lib/dispatch";
import { buildCommunicationIdempotencyKey } from "@/lib/communication-events";
import { normalizeE164 } from "@/lib/phone";
import { isWithinSmsSendWindow } from "@/lib/sms-quiet-hours";

export type DispatchPersistedJobEvent = {
  id: string;
  eventType: JobEventType;
  fromValue: string | null;
  toValue: string | null;
  createdAt: Date;
  metadata?: Prisma.JsonValue | null;
};

export type DispatchNotificationKind = "status" | "schedule_change";

export type DispatchNotificationEvent = {
  id: string;
  eventType: JobEventType;
  fromValue: string | null;
  toValue: string | null;
  createdAt: Date;
  metadata: Prisma.JsonValue | null;
};

export type DispatchCustomerNotificationCandidate = {
  event: DispatchNotificationEvent;
  kind: DispatchNotificationKind;
  notificationStatus: DispatchStatusValue;
  summary: string;
  changedFields: DispatchScheduleChangeField[];
};

export type PendingDispatchScheduleCustomerUpdate = {
  pending: boolean;
  occurredAt: Date | null;
  changedFields: DispatchScheduleChangeField[];
  alreadySentAt: Date | null;
};

export type DispatchCustomerCommunicationState = {
  lastCustomerUpdate: {
    occurredAt: Date;
    statusUpdatedAt: Date;
    summary: string;
    providerStatus: string | null;
    deliveryState: DispatchSmsDeliveryState | null;
    body: string | null;
    failureReason: string | null;
    operatorFailureReason: string | null;
    providerErrorCode: string | null;
    providerErrorMessage: string | null;
    remediation: DispatchSmsRemediation | null;
    recoverySend: boolean;
    manualFollowThrough: {
      state: "started" | "handled";
      actionId: string | null;
      occurredAt: Date;
    } | null;
    manualContactOutcome: {
      outcome: "confirmed_schedule" | "reschedule_needed" | "no_response";
      occurredAt: Date;
    } | null;
    customerResponseAfterSend: {
      occurredAt: Date;
      summary: string;
      type: "sms" | "call" | "voicemail";
    } | null;
    operatorFollowUpAfterResponse: {
      occurredAt: Date;
      summary: string;
    } | null;
    kind: DispatchNotificationKind | "legacy";
    status: DispatchStatusValue | null;
  } | null;
  customerUpdate: PendingDispatchScheduleCustomerUpdate & {
    canSend: boolean;
    blockedReason: string | null;
    previewBody: string | null;
  };
};

export type DispatchManualFollowThroughState = NonNullable<
  NonNullable<DispatchCustomerCommunicationState["lastCustomerUpdate"]>["manualFollowThrough"]
>;

export type DispatchManualContactOutcomeState = NonNullable<
  NonNullable<DispatchCustomerCommunicationState["lastCustomerUpdate"]>["manualContactOutcome"]
>;

export type DispatchCustomerResponseAfterSendState = NonNullable<
  NonNullable<DispatchCustomerCommunicationState["lastCustomerUpdate"]>["customerResponseAfterSend"]
>;

export type DispatchOperatorFollowUpAfterResponseState = NonNullable<
  NonNullable<DispatchCustomerCommunicationState["lastCustomerUpdate"]>["operatorFollowUpAfterResponse"]
>;

export const dispatchCustomerNotificationJobSelect = {
  id: true,
  orgId: true,
  customerId: true,
  leadId: true,
  customerName: true,
  phone: true,
  serviceType: true,
  scheduledDate: true,
  scheduledStartTime: true,
  scheduledEndTime: true,
  dispatchStatus: true,
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
  org: {
    select: {
      name: true,
      smsFromNumberE164: true,
      smsQuietHoursStartMinute: true,
      smsQuietHoursEndMinute: true,
      dashboardConfig: {
        select: {
          calendarTimezone: true,
        },
      },
      messagingSettings: {
        select: {
          timezone: true,
        },
      },
    },
  },
  lead: {
    select: {
      id: true,
      status: true,
      customerId: true,
      conversationState: {
        select: {
          id: true,
        },
      },
    },
  },
} satisfies Prisma.JobSelect;

export type DispatchCustomerNotificationJobRecord = Prisma.JobGetPayload<{
  select: typeof dispatchCustomerNotificationJobSelect;
}>;

export type DispatchCustomerNotificationReadiness = {
  allowed: boolean;
  blockedReason: string | null;
  previewBody: string | null;
  toNumberE164: string | null;
};

export type DispatchNotificationAttemptOutcome = "sent" | "failed" | "suppressed";

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function recordString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

export function recordDate(record: Record<string, unknown> | null, key: string): Date | null {
  const value = record?.[key];
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function recordBoolean(record: Record<string, unknown> | null, key: string): boolean {
  const value = record?.[key];
  return value === true;
}

export function getDispatchNotificationTimeZone(job: DispatchCustomerNotificationJobRecord): string {
  return job.org.messagingSettings?.timezone || job.org.dashboardConfig?.calendarTimezone || "America/Los_Angeles";
}

export function getDispatchNotificationSchedule(job: DispatchCustomerNotificationJobRecord) {
  const projection = deriveJobBookingProjection({
    events: job.calendarEvents,
    timeZone: job.org.dashboardConfig?.calendarTimezone || null,
  });

  return {
    scheduledDate: projection.scheduledDateKey,
    scheduledStartTime: projection.scheduledStartTime,
    scheduledEndTime: projection.scheduledEndTime,
    hasBookingHistory: projection.hasBookingEvent,
    hasActiveBooking: projection.hasActiveBooking,
  };
}

function requiresActiveBookingForDispatchNotification(status: DispatchStatusValue): boolean {
  return status === "scheduled" || status === "on_the_way" || status === "rescheduled";
}

export function buildDispatchCustomerNotificationReadiness(input: {
  settings: DispatchNotificationSettings;
  job: DispatchCustomerNotificationJobRecord;
  candidate: DispatchCustomerNotificationCandidate;
}): DispatchCustomerNotificationReadiness {
  const toNumberE164 = normalizeE164(input.job.phone || null);
  const timeZone = getDispatchNotificationTimeZone(input.job);
  const schedule = getDispatchNotificationSchedule(input.job);
  const hasUsableSchedule =
    Boolean(schedule.scheduledDate) &&
    (requiresActiveBookingForDispatchNotification(input.candidate.notificationStatus)
      ? schedule.hasActiveBooking
      : schedule.hasBookingHistory);
  const previewBody = hasUsableSchedule
    ? formatDispatchCustomerSms({
        orgName: input.job.org.name,
        serviceType: input.job.serviceType,
        scheduledDate: schedule.scheduledDate || "",
        scheduledStartTime: schedule.scheduledStartTime,
        scheduledEndTime: schedule.scheduledEndTime,
        status: input.candidate.notificationStatus,
        timeZone,
      })
    : null;

  const blockedReason = describeDispatchNotificationBlockedReason({
    smsEnabled: input.settings.smsEnabled,
    canSend: input.settings.canSend,
    notificationTypeEnabled: shouldSendDispatchStatusNotification(input.settings, input.candidate.notificationStatus),
    hasCustomerPhone: Boolean(toNumberE164),
    hasScheduledDate: hasUsableSchedule,
    optedOut: input.job.lead?.status === "DNC",
    withinSendWindow: isWithinSmsSendWindow({
      at: new Date(),
      timeZone,
      startMinute: input.job.org.smsQuietHoursStartMinute,
      endMinute: input.job.org.smsQuietHoursEndMinute,
    }),
  });

  return {
    allowed: !blockedReason,
    blockedReason,
    previewBody,
    toNumberE164,
  };
}

export function buildDispatchNotificationIdempotencyKey(input: {
  kind: DispatchNotificationKind;
  orgId: string;
  eventId: string;
  status: DispatchStatusValue;
}) {
  return buildCommunicationIdempotencyKey(
    input.kind === "schedule_change" ? "dispatch-schedule-sms" : "dispatch-status-sms",
    input.orgId,
    input.eventId,
    input.status,
  );
}

export function buildDispatchNotificationAttemptIdempotencyKey(input: {
  kind: DispatchNotificationKind;
  orgId: string;
  eventId: string;
  status: DispatchStatusValue;
  outcome: DispatchNotificationAttemptOutcome;
}) {
  if (input.outcome === "sent") {
    return buildDispatchNotificationIdempotencyKey(input);
  }

  return buildCommunicationIdempotencyKey(
    input.kind === "schedule_change" ? `dispatch-schedule-sms-${input.outcome}` : `dispatch-status-sms-${input.outcome}`,
    input.orgId,
    input.eventId,
    input.status,
  );
}

export function createDispatchNotificationSummary(input: {
  kind: DispatchNotificationKind;
  status: DispatchStatusValue;
}): string {
  if (input.kind === "schedule_change") {
    return "Dispatch update: Schedule updated";
  }

  return `Dispatch update: ${formatDispatchStatusLabel(input.status)}`;
}

export function createDispatchNotificationAttemptSummary(input: {
  candidate: DispatchCustomerNotificationCandidate;
  outcome: DispatchNotificationAttemptOutcome;
}): string {
  if (input.outcome === "failed") {
    return `${input.candidate.summary} failed`;
  }

  if (input.outcome === "suppressed") {
    return `${input.candidate.summary} blocked`;
  }

  return input.candidate.summary;
}

export function selectAutomaticDispatchCustomerNotificationCandidate(input: {
  events: DispatchPersistedJobEvent[];
  status: DispatchStatusValue;
}): DispatchCustomerNotificationCandidate | null {
  const event = input.events.find((candidate) => {
    if (candidate.eventType === "STATUS_CHANGED") {
      return typeof candidate.toValue === "string" && candidate.toValue.trim() === input.status;
    }
    return candidate.eventType === "JOB_CREATED";
  });

  if (!event) {
    return null;
  }

  return {
    event: {
      id: event.id,
      eventType: event.eventType,
      fromValue: event.fromValue,
      toValue: event.toValue,
      createdAt: event.createdAt,
      metadata: event.metadata ?? null,
    },
    kind: "status",
    notificationStatus: input.status,
    summary: createDispatchNotificationSummary({
      kind: "status",
      status: input.status,
    }),
    changedFields: [],
  };
}

export function selectLatestDispatchScheduleChangeCandidate(input: {
  events: DispatchNotificationEvent[];
  status: DispatchStatusValue;
}): DispatchCustomerNotificationCandidate | null {
  if (input.status !== "scheduled") {
    return null;
  }

  const event = input.events.find(
    (candidate) => candidate.eventType === "JOB_UPDATED" && isMeaningfulDispatchScheduleChange(candidate.metadata),
  );

  if (!event) {
    return null;
  }

  return {
    event,
    kind: "schedule_change",
    notificationStatus: "rescheduled",
    summary: createDispatchNotificationSummary({
      kind: "schedule_change",
      status: "rescheduled",
    }),
    changedFields: getDispatchScheduleChangeFields(event.metadata),
  };
}

export function resolveDispatchNotificationStatus(value: string | null): DispatchStatusValue | null {
  return value && isDispatchStatusValue(value) ? value : null;
}

export function resolveDispatchNotificationEventStatus(jobDispatchStatus: DispatchCustomerNotificationJobRecord["dispatchStatus"]) {
  return dispatchStatusFromDb(jobDispatchStatus);
}
