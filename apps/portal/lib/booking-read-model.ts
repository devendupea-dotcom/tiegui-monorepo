import type { CalendarEventStatus, EventType, LeadStatus, Prisma } from "@prisma/client";
import { DEFAULT_CALENDAR_TIMEZONE, ensureTimeZone, zonedDateString, zonedTimeString } from "@/lib/calendar/dates";
import { parseDispatchDateKey } from "@/lib/dispatch";
import { selectReusableOperationalJobCandidate, type OperationalJobCandidate } from "@/lib/operational-jobs";

export const bookingEventTypes: EventType[] = ["JOB", "ESTIMATE"];
export const activeBookingEventStatuses: CalendarEventStatus[] = [
  "SCHEDULED",
  "CONFIRMED",
  "EN_ROUTE",
  "ON_SITE",
  "IN_PROGRESS",
];

type BookingEventLike = {
  id: string;
  type: EventType;
  status: CalendarEventStatus;
  startAt: Date;
  endAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
  jobId?: string | null;
};

type JobBookingEventLike = BookingEventLike;

export type LeadBookingProjection<TEvent extends BookingEventLike = BookingEventLike> = {
  activeBookingEvent: TEvent | null;
  primaryBookingEvent: TEvent | null;
  hasActiveBooking: boolean;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  linkedOperationalJobId: string | null;
  derivedLeadStatus: LeadStatus;
};

export type JobBookingProjection<TEvent extends JobBookingEventLike = JobBookingEventLike> = {
  activeBookingEvent: TEvent | null;
  primaryBookingEvent: TEvent | null;
  hasActiveBooking: boolean;
  hasBookingEvent: boolean;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  scheduledDate: Date | null;
  scheduledDateKey: string | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
};

export function isBookingEventType(type: EventType): boolean {
  return bookingEventTypes.includes(type);
}

export function isActiveBookingEventStatus(status: CalendarEventStatus): boolean {
  return activeBookingEventStatuses.includes(status);
}

export function isActiveBookingEvent(input: {
  type: EventType;
  status: CalendarEventStatus;
}): boolean {
  return isBookingEventType(input.type) && isActiveBookingEventStatus(input.status);
}

function compareByStartAscending<TEvent extends BookingEventLike>(left: TEvent, right: TEvent) {
  const startDiff = left.startAt.getTime() - right.startAt.getTime();
  if (startDiff !== 0) return startDiff;

  const createdDiff = (left.createdAt?.getTime() || 0) - (right.createdAt?.getTime() || 0);
  if (createdDiff !== 0) return createdDiff;

  return left.id.localeCompare(right.id);
}

function compareByRecencyDescending<TEvent extends BookingEventLike>(left: TEvent, right: TEvent) {
  const updatedDiff = (right.updatedAt?.getTime() || 0) - (left.updatedAt?.getTime() || 0);
  if (updatedDiff !== 0) return updatedDiff;

  const startDiff = right.startAt.getTime() - left.startAt.getTime();
  if (startDiff !== 0) return startDiff;

  return right.id.localeCompare(left.id);
}

export function selectActiveBookingEvent<TEvent extends BookingEventLike>(events: TEvent[]): TEvent | null {
  return [...events]
    .filter((event) => isActiveBookingEvent({ type: event.type, status: event.status }))
    .sort(compareByStartAscending)[0] || null;
}

export function selectPrimaryBookingEvent<TEvent extends BookingEventLike>(
  events: TEvent[],
  now = new Date(),
): TEvent | null {
  const activeEvents = events.filter((event) => isActiveBookingEvent({ type: event.type, status: event.status }));
  const upcomingActive =
    [...activeEvents]
      .filter((event) => (event.endAt || event.startAt).getTime() >= now.getTime())
      .sort(compareByStartAscending)[0] || null;
  if (upcomingActive) {
    return upcomingActive;
  }

  const recentActive = [...activeEvents].sort(compareByRecencyDescending)[0] || null;
  if (recentActive) {
    return recentActive;
  }

  return [...events]
    .filter((event) => isBookingEventType(event.type))
    .sort(compareByRecencyDescending)[0] || null;
}

export function deriveLeadBookingProjection<TEvent extends BookingEventLike>(input: {
  leadStatus: LeadStatus;
  events: TEvent[];
  jobs?: OperationalJobCandidate[];
  now?: Date;
}): LeadBookingProjection<TEvent> {
  const activeBookingEvent = selectActiveBookingEvent(input.events);
  const primaryBookingEvent = selectPrimaryBookingEvent(input.events, input.now);
  const fallbackOperationalJob = input.jobs?.length
    ? selectReusableOperationalJobCandidate({
        candidates: input.jobs,
        preferredJobId: activeBookingEvent?.jobId || primaryBookingEvent?.jobId || null,
      })
    : null;
  const hasActiveBooking = Boolean(activeBookingEvent);

  return {
    activeBookingEvent,
    primaryBookingEvent,
    hasActiveBooking,
    scheduledStartAt: activeBookingEvent?.startAt || null,
    scheduledEndAt: activeBookingEvent?.endAt || null,
    linkedOperationalJobId: activeBookingEvent?.jobId || primaryBookingEvent?.jobId || fallbackOperationalJob?.id || null,
    derivedLeadStatus: input.leadStatus === "DNC" ? "DNC" : hasActiveBooking ? "BOOKED" : input.leadStatus,
  };
}

export function deriveJobBookingProjection<TEvent extends JobBookingEventLike>(input: {
  events: TEvent[];
  timeZone?: string | null;
}): JobBookingProjection<TEvent> {
  const activeBookingEvent = selectActiveBookingEvent(input.events);
  const primaryBookingEvent = selectPrimaryBookingEvent(input.events);
  const scheduleEvent = activeBookingEvent || primaryBookingEvent;
  const timeZone = ensureTimeZone(input.timeZone || DEFAULT_CALENDAR_TIMEZONE);
  const scheduledDateKey = scheduleEvent ? zonedDateString(scheduleEvent.startAt, timeZone) : null;

  return {
    activeBookingEvent,
    primaryBookingEvent,
    hasActiveBooking: Boolean(activeBookingEvent),
    hasBookingEvent: Boolean(scheduleEvent),
    scheduledStartAt: scheduleEvent?.startAt || null,
    scheduledEndAt: scheduleEvent?.endAt || null,
    scheduledDate: scheduledDateKey ? parseDispatchDateKey(scheduledDateKey) : null,
    scheduledDateKey,
    scheduledStartTime: scheduleEvent ? zonedTimeString(scheduleEvent.startAt, timeZone) : null,
    scheduledEndTime: scheduleEvent?.endAt ? zonedTimeString(scheduleEvent.endAt, timeZone) : null,
  };
}

export function buildValidOperationalJobWhere(orgId: string): Prisma.JobWhereInput {
  return {
    orgId,
    status: {
      not: "CANCELLED",
    },
    OR: [
      {
        calendarEvents: {
          some: {
            type: {
              in: bookingEventTypes,
            },
          },
        },
      },
      {
        sourceEstimateId: {
          not: null,
        },
      },
      {
        linkedEstimateId: {
          not: null,
        },
      },
      {
        assignedCrewId: {
          not: null,
        },
      },
      {
        jobEvents: {
          some: {},
        },
      },
    ],
  };
}
