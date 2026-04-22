import { addMinutes } from "date-fns";
import type { EventType } from "@prisma/client";
import { activeBookingEventStatuses } from "@/lib/booking-read-model";
import {
  DEFAULT_CALENDAR_TIMEZONE,
  ensureTimeZone,
  formatDateTimeForDisplay,
  toUtcFromLocalDateTime,
} from "@/lib/calendar/dates";
import {
  buildCommunicationIdempotencyKey,
  upsertCommunicationEvent,
} from "@/lib/communication-events";
import {
  dispatchCustomerNotificationJobSelect,
  getDispatchNotificationSchedule,
  selectAutomaticDispatchCustomerNotificationCandidate,
  selectLatestDispatchScheduleChangeCandidate,
  type DispatchPersistedJobEvent,
} from "@/lib/dispatch-notification-core";
import { dispatchStatusFromDb, type DispatchStatusValue } from "@/lib/dispatch";
import { prisma } from "@/lib/prisma";
import { sendOutboundSms } from "@/lib/sms";
import { resolveTwilioVoiceForwardingNumber } from "@/lib/twilio-org";

const OWNER_NOTIFICATION_GRACE_MINUTES = 5;
const DEFAULT_REMINDER_MINUTES_BEFORE = 120;
const OWNER_BOOKING_EVENT_TYPES: EventType[] = ["JOB", "ESTIMATE"];

export type OwnerBookingNotificationKind =
  | "scheduled"
  | "rescheduled"
  | "reminder";

type OwnerNotificationContext = {
  orgId: string;
  orgName: string;
  timeZone: string;
  reminderMinutesBefore: number;
  recipientNumberE164: string | null;
};

type OwnerBookingMessageInput = {
  orgName: string;
  bookingType: "job" | "estimate";
  kind: OwnerBookingNotificationKind;
  customerName?: string | null;
  title?: string | null;
  serviceLabel?: string | null;
  addressLine?: string | null;
  startAt: Date;
  endAt?: Date | null;
  timeZone: string;
  reminderMinutesBefore?: number;
};

type OwnerBookingNotificationSendInput = {
  orgId: string;
  actorUserId?: string | null;
  recipientNumberE164: string;
  summary: string;
  body: string;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
  occurredAt?: Date;
};

type OwnerReminderProcessingResult = {
  organizationsScanned: number;
  eventsProcessed: number;
  sent: number;
  failures: number;
  duplicates: number;
  skippedNoRecipient: number;
};

type OwnerReminderProcessOptions = {
  now?: Date;
  maxOrganizations?: number;
  maxEventsPerOrg?: number;
  graceMinutes?: number;
};

function cleanText(value: string | null | undefined): string | null {
  const trimmed = (value || "").trim();
  return trimmed || null;
}

function labelBookingType(value: "job" | "estimate"): string {
  return value === "estimate" ? "estimate" : "job";
}

function labelBookingTypeTitle(value: "job" | "estimate"): string {
  return value === "estimate" ? "Estimate" : "Job";
}

function resolveBookingType(value: EventType): "job" | "estimate" {
  return value === "ESTIMATE" ? "estimate" : "job";
}

function formatEventDateTimeLabel(input: {
  startAt: Date;
  endAt?: Date | null;
  timeZone: string;
}): string {
  const dateLabel = formatDateTimeForDisplay(
    input.startAt,
    {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    },
    {
      timeZone: input.timeZone,
    },
  );

  if (!input.endAt) {
    return dateLabel;
  }

  const endLabel = formatDateTimeForDisplay(
    input.endAt,
    {
      hour: "numeric",
      minute: "2-digit",
    },
    {
      timeZone: input.timeZone,
    },
  );

  return `${dateLabel} - ${endLabel}`;
}

export function formatOwnerReminderLeadTime(minutes: number): string {
  const normalized = Math.max(1, Math.round(minutes));
  if (normalized < 60) {
    return `${normalized} minute${normalized === 1 ? "" : "s"}`;
  }

  const hours = Math.floor(normalized / 60);
  const remainder = normalized % 60;
  if (remainder === 0) {
    return `about ${hours} hour${hours === 1 ? "" : "s"}`;
  }

  return `about ${hours} hour${hours === 1 ? "" : "s"} ${remainder} minute${remainder === 1 ? "" : "s"}`;
}

function resolvePrimaryLabel(
  input: Pick<
    OwnerBookingMessageInput,
    "customerName" | "title" | "serviceLabel"
  >,
): string {
  return (
    cleanText(input.customerName) ||
    cleanText(input.title) ||
    cleanText(input.serviceLabel) ||
    "the customer"
  );
}

function resolveSecondaryDetail(
  input: Pick<
    OwnerBookingMessageInput,
    "customerName" | "title" | "serviceLabel"
  >,
): string | null {
  const primary = resolvePrimaryLabel(input).toLowerCase();
  const candidates = [cleanText(input.serviceLabel), cleanText(input.title)];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate.toLowerCase() === primary) continue;
    return candidate;
  }
  return null;
}

export function buildOwnerBookingNotificationSms(
  input: OwnerBookingMessageInput,
): string {
  const orgName = cleanText(input.orgName) || "TieGui";
  const bookingLabel = labelBookingType(input.bookingType);
  const subject = resolvePrimaryLabel(input);
  const detail = resolveSecondaryDetail(input);
  const when = formatEventDateTimeLabel({
    startAt: input.startAt,
    endAt: input.endAt,
    timeZone: ensureTimeZone(input.timeZone),
  });
  const address = cleanText(input.addressLine);

  const detailLine = detail ? ` ${detail}.` : "";
  const addressLine = address ? ` ${address}.` : "";

  if (input.kind === "reminder") {
    const leadTime = formatOwnerReminderLeadTime(
      input.reminderMinutesBefore ?? DEFAULT_REMINDER_MINUTES_BEFORE,
    );
    return `${orgName}: Reminder - ${bookingLabel} for ${subject} starts in ${leadTime} on ${when}.${detailLine}${addressLine}`.trim();
  }

  if (input.kind === "rescheduled") {
    return `${orgName}: ${labelBookingTypeTitle(input.bookingType)} rescheduled for ${subject} to ${when}.${detailLine}${addressLine}`.trim();
  }

  return `${orgName}: New ${bookingLabel} scheduled for ${subject} on ${when}.${detailLine}${addressLine}`.trim();
}

function buildOwnerBookingNotificationSummary(input: {
  bookingType: "job" | "estimate";
  kind: OwnerBookingNotificationKind;
}): string {
  if (input.kind === "reminder") {
    return `Owner alert: ${labelBookingTypeTitle(input.bookingType)} reminder`;
  }

  if (input.kind === "rescheduled") {
    return `Owner alert: ${labelBookingTypeTitle(input.bookingType)} rescheduled`;
  }

  return `Owner alert: ${labelBookingTypeTitle(input.bookingType)} scheduled`;
}

export function selectOrgDispatchNotificationCandidate(input: {
  events: DispatchPersistedJobEvent[];
  status: DispatchStatusValue;
}): { kind: "scheduled" | "rescheduled"; sourceEventId: string } | null {
  const automatic = selectAutomaticDispatchCustomerNotificationCandidate(input);
  if (
    automatic &&
    (automatic.notificationStatus === "scheduled" ||
      automatic.notificationStatus === "rescheduled")
  ) {
    return {
      kind:
        automatic.notificationStatus === "rescheduled"
          ? "rescheduled"
          : "scheduled",
      sourceEventId: automatic.event.id,
    };
  }

  const scheduleChange = selectLatestDispatchScheduleChangeCandidate({
    status: input.status,
    events: input.events.map((event) => ({
      ...event,
      metadata: event.metadata ?? null,
    })),
  });
  if (scheduleChange) {
    return {
      kind: "rescheduled",
      sourceEventId: scheduleChange.event.id,
    };
  }

  return null;
}

async function resolveOwnerNotificationContext(
  orgId: string,
): Promise<OwnerNotificationContext | null> {
  const organization = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      name: true,
      dashboardConfig: {
        select: {
          calendarTimezone: true,
          jobReminderMinutesBefore: true,
        },
      },
      twilioConfig: {
        select: {
          voiceForwardingNumber: true,
        },
      },
    },
  });

  if (!organization) {
    return null;
  }

  const recipientNumberE164 = await resolveTwilioVoiceForwardingNumber({
    organizationId: orgId,
    configuredNumber: organization.twilioConfig?.voiceForwardingNumber || null,
  });

  return {
    orgId,
    orgName: organization.name,
    timeZone: ensureTimeZone(
      organization.dashboardConfig?.calendarTimezone ||
        DEFAULT_CALENDAR_TIMEZONE,
    ),
    reminderMinutesBefore:
      organization.dashboardConfig?.jobReminderMinutesBefore ||
      DEFAULT_REMINDER_MINUTES_BEFORE,
    recipientNumberE164,
  };
}

async function sendOwnerBookingNotification(
  input: OwnerBookingNotificationSendInput,
) {
  const occurredAt = input.occurredAt || new Date();
  const existing = await prisma.communicationEvent.findUnique({
    where: {
      orgId_idempotencyKey: {
        orgId: input.orgId,
        idempotencyKey: input.idempotencyKey,
      },
    },
    select: {
      id: true,
    },
  });

  if (existing) {
    return "duplicate" as const;
  }

  const dispatched = await sendOutboundSms({
    orgId: input.orgId,
    toNumberE164: input.recipientNumberE164,
    body: input.body,
  });

  if (dispatched.suppressed) {
    return "failed" as const;
  }

  if (dispatched.status === "FAILED") {
    return "failed" as const;
  }

  await prisma.$transaction(async (tx) => {
    await upsertCommunicationEvent(tx, {
      orgId: input.orgId,
      actorUserId: input.actorUserId || null,
      type: "OUTBOUND_SMS_SENT",
      channel: "SMS",
      occurredAt,
      summary: input.summary,
      metadataJson: {
        ...input.metadata,
        ownerNotification: true,
        toNumberE164: input.recipientNumberE164,
        fromNumberE164: dispatched.resolvedFromNumberE164,
        body: input.body,
      },
      provider: "TWILIO",
      providerMessageSid: dispatched.providerMessageSid,
      providerStatus: dispatched.status,
      idempotencyKey: input.idempotencyKey,
    });
  });

  return "sent" as const;
}

export async function maybeSendOrgDispatchNotifications(input: {
  orgId: string;
  jobId: string;
  actorUserId: string | null;
  events: DispatchPersistedJobEvent[];
}) {
  if (input.events.length === 0) {
    return;
  }

  const [context, job] = await Promise.all([
    resolveOwnerNotificationContext(input.orgId),
    prisma.job.findFirst({
      where: {
        id: input.jobId,
        orgId: input.orgId,
      },
      select: dispatchCustomerNotificationJobSelect,
    }),
  ]);

  if (!context?.recipientNumberE164 || !job) {
    return;
  }

  const status = dispatchStatusFromDb(job.dispatchStatus);
  const candidate = selectOrgDispatchNotificationCandidate({
    events: input.events,
    status,
  });

  if (!candidate) {
    return;
  }

  const schedule = getDispatchNotificationSchedule(job);
  if (!schedule.scheduledDate || !schedule.scheduledStartTime) {
    return;
  }

  const startAt = toUtcFromLocalDateTime({
    date: schedule.scheduledDate,
    time: schedule.scheduledStartTime,
    timeZone: context.timeZone,
  });
  const endAt = schedule.scheduledEndTime
    ? toUtcFromLocalDateTime({
        date: schedule.scheduledDate,
        time: schedule.scheduledEndTime,
        timeZone: context.timeZone,
      })
    : null;
  const body = buildOwnerBookingNotificationSms({
    orgName: context.orgName,
    bookingType: "job",
    kind: candidate.kind,
    customerName: job.customerName,
    serviceLabel: job.serviceType,
    addressLine: job.address,
    startAt,
    endAt,
    timeZone: context.timeZone,
  });

  await sendOwnerBookingNotification({
    orgId: input.orgId,
    actorUserId: input.actorUserId,
    recipientNumberE164: context.recipientNumberE164,
    summary: buildOwnerBookingNotificationSummary({
      bookingType: "job",
      kind: candidate.kind,
    }),
    body,
    idempotencyKey: buildCommunicationIdempotencyKey(
      "owner-dispatch-booking-sms",
      input.orgId,
      input.jobId,
      candidate.sourceEventId,
      candidate.kind,
      context.recipientNumberE164,
    ),
    metadata: {
      ownerNotificationKind: candidate.kind,
      bookingType: "job",
      dispatchJobId: input.jobId,
      dispatchSourceEventId: candidate.sourceEventId,
      customerName: cleanText(job.customerName),
      serviceLabel: cleanText(job.serviceType),
      addressLine: cleanText(job.address),
      scheduledDate: schedule.scheduledDate,
      scheduledStartTime: schedule.scheduledStartTime,
      scheduledEndTime: schedule.scheduledEndTime,
      timeZone: context.timeZone,
      source: "dispatch",
    },
  });
}

export async function processDueOrgOwnerBookingReminders(
  options: OwnerReminderProcessOptions = {},
): Promise<OwnerReminderProcessingResult> {
  const now = options.now || new Date();
  const maxOrganizations = Math.max(1, options.maxOrganizations || 200);
  const maxEventsPerOrg = Math.max(1, options.maxEventsPerOrg || 50);
  const graceMinutes = Math.max(
    1,
    options.graceMinutes || OWNER_NOTIFICATION_GRACE_MINUTES,
  );

  const organizations = await prisma.organization.findMany({
    where: {
      twilioConfig: {
        isNot: null,
      },
    },
    select: {
      id: true,
    },
    orderBy: {
      createdAt: "asc",
    },
    take: maxOrganizations,
  });

  let eventsProcessed = 0;
  let sent = 0;
  let failures = 0;
  let duplicates = 0;
  let skippedNoRecipient = 0;

  for (const organization of organizations) {
    const context = await resolveOwnerNotificationContext(organization.id);
    if (!context?.recipientNumberE164) {
      skippedNoRecipient += 1;
      continue;
    }

    const windowStart = addMinutes(
      now,
      context.reminderMinutesBefore - graceMinutes,
    );
    const windowEnd = addMinutes(
      now,
      context.reminderMinutesBefore + graceMinutes,
    );
    const events = await prisma.event.findMany({
      where: {
        orgId: organization.id,
        type: {
          in: OWNER_BOOKING_EVENT_TYPES,
        },
        status: {
          in: activeBookingEventStatuses,
        },
        startAt: {
          gte: windowStart,
          lt: windowEnd,
        },
      },
      select: {
        id: true,
        type: true,
        title: true,
        customerName: true,
        addressLine: true,
        startAt: true,
        endAt: true,
      },
      orderBy: [{ startAt: "asc" }, { createdAt: "asc" }],
      take: maxEventsPerOrg,
    });

    for (const event of events) {
      eventsProcessed += 1;
      const bookingType = resolveBookingType(event.type);
      const body = buildOwnerBookingNotificationSms({
        orgName: context.orgName,
        bookingType,
        kind: "reminder",
        customerName: event.customerName,
        title: event.title,
        addressLine: event.addressLine,
        startAt: event.startAt,
        endAt: event.endAt,
        timeZone: context.timeZone,
        reminderMinutesBefore: context.reminderMinutesBefore,
      });

      const result = await sendOwnerBookingNotification({
        orgId: organization.id,
        recipientNumberE164: context.recipientNumberE164,
        summary: buildOwnerBookingNotificationSummary({
          bookingType,
          kind: "reminder",
        }),
        body,
        occurredAt: now,
        idempotencyKey: buildCommunicationIdempotencyKey(
          "owner-booking-reminder-sms",
          organization.id,
          event.id,
          event.startAt.toISOString(),
          context.reminderMinutesBefore,
          context.recipientNumberE164,
        ),
        metadata: {
          ownerNotificationKind: "reminder",
          bookingType,
          calendarEventId: event.id,
          calendarEventType: event.type,
          title: cleanText(event.title),
          customerName: cleanText(event.customerName),
          addressLine: cleanText(event.addressLine),
          scheduledStartAt: event.startAt.toISOString(),
          scheduledEndAt: event.endAt?.toISOString() || null,
          reminderMinutesBefore: context.reminderMinutesBefore,
          timeZone: context.timeZone,
          source: "calendar_reminder",
        },
      });

      if (result === "sent") {
        sent += 1;
      } else if (result === "duplicate") {
        duplicates += 1;
      } else {
        failures += 1;
      }
    }
  }

  return {
    organizationsScanned: organizations.length,
    eventsProcessed,
    sent,
    failures,
    duplicates,
    skippedNoRecipient,
  };
}
