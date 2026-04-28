import { addMinutes } from "date-fns";
import type { EventType } from "@prisma/client";
import { activeBookingEventStatuses } from "@/lib/booking-read-model";
import {
  DEFAULT_CALENDAR_TIMEZONE,
  ensureTimeZone,
  toUtcFromLocalDateTime,
} from "@/lib/calendar/dates";
import {
  buildCommunicationIdempotencyKey,
  upsertCommunicationEvent,
} from "@/lib/communication-events";
import {
  dispatchCustomerNotificationJobSelect,
  getDispatchNotificationSchedule,
  type DispatchPersistedJobEvent,
} from "@/lib/dispatch-notification-core";
import { dispatchStatusFromDb, type DispatchStatusValue } from "@/lib/dispatch";
import {
  buildOwnerBookingNotificationSms,
  resolveOwnerBookingType,
  selectOrgDispatchNotificationCandidate,
  type OwnerBookingNotificationKind,
} from "@/lib/org-owner-notification-core";
import { prisma } from "@/lib/prisma";
import { sendOutboundSms } from "@/lib/sms";
import { resolveTwilioVoiceForwardingNumber } from "@/lib/twilio-org";

const OWNER_NOTIFICATION_GRACE_MINUTES = 5;
const DEFAULT_REMINDER_MINUTES_BEFORE = 120;
const OWNER_BOOKING_EVENT_TYPES: EventType[] = ["JOB", "ESTIMATE"];

type OwnerNotificationContext = {
  orgId: string;
  orgName: string;
  timeZone: string;
  reminderMinutesBefore: number;
  recipientNumberE164: string | null;
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

function labelBookingTypeTitle(value: "job" | "estimate"): string {
  return value === "estimate" ? "Estimate" : "Job";
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

  if (dispatched.suppressed || dispatched.status === "FAILED") {
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
      const bookingType = resolveOwnerBookingType(event.type);
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
