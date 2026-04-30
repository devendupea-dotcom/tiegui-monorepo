import type { EventType } from "@prisma/client";
import type { DispatchStatusValue } from "@/lib/dispatch";
import { formatDateTimeForDisplay } from "@/lib/calendar/dates";
import {
  selectAutomaticDispatchCustomerNotificationCandidate,
  selectLatestDispatchScheduleChangeCandidate,
  type DispatchPersistedJobEvent,
} from "@/lib/dispatch-notification-core";

export type OwnerBookingNotificationKind =
  | "scheduled"
  | "rescheduled"
  | "reminder";

export type OwnerBookingMessageInput = {
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

export type OwnerLeadReviewMessageInput = {
  orgName: string;
  customerName?: string | null;
  phoneE164?: string | null;
  reason?: string | null;
  inboundBody?: string | null;
};

const DEFAULT_REMINDER_MINUTES_BEFORE = 120;
const MAX_OWNER_REVIEW_SNIPPET_LENGTH = 120;

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

function truncateText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

export function resolveOwnerBookingType(value: EventType): "job" | "estimate" {
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
    timeZone: input.timeZone,
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

export function buildOwnerLeadReviewNotificationSms(
  input: OwnerLeadReviewMessageInput,
): string {
  const orgName = cleanText(input.orgName) || "TieGui";
  const customer = cleanText(input.customerName) || cleanText(input.phoneE164) || "a customer";
  const reason = cleanText(input.reason) || "SMS automation paused for review";
  const inbound = cleanText(input.inboundBody);
  const snippet = inbound ? ` Latest: "${truncateText(inbound, MAX_OWNER_REVIEW_SNIPPET_LENGTH)}"` : "";

  return `${orgName}: Review needed for ${customer}. ${reason}.${snippet} Open TieGui Inbox to reply.`.trim();
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
