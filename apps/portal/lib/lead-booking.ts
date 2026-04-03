import { Prisma, type CalendarEventStatus, type EventType } from "@prisma/client";

const LEAD_BOOKING_EVENT_TYPES: EventType[] = ["JOB", "ESTIMATE"];
const ACTIVE_LEAD_BOOKING_STATUSES: CalendarEventStatus[] = [
  "SCHEDULED",
  "CONFIRMED",
  "EN_ROUTE",
  "ON_SITE",
  "IN_PROGRESS",
];

export function isLeadBookingEvent(type: EventType): boolean {
  return LEAD_BOOKING_EVENT_TYPES.includes(type);
}

export function isActiveLeadBookingEvent(input: {
  type: EventType;
  status: CalendarEventStatus;
}): boolean {
  return isLeadBookingEvent(input.type) && ACTIVE_LEAD_BOOKING_STATUSES.includes(input.status);
}

export async function syncLeadBookingState(
  tx: Prisma.TransactionClient,
  input: {
    leadId: string | null | undefined;
    eventId: string;
    type: EventType;
    status: CalendarEventStatus;
    startAt: Date;
    endAt: Date | null;
  },
) {
  if (!input.leadId || !isActiveLeadBookingEvent({ type: input.type, status: input.status })) {
    return;
  }

  await Promise.all([
    tx.lead.update({
      where: { id: input.leadId },
      data: {
        status: "BOOKED",
        nextFollowUpAt: null,
        intakeStage: "COMPLETED",
      },
    }),
    tx.leadConversationState.updateMany({
      where: { leadId: input.leadId },
      data: {
        stage: "BOOKED",
        nextFollowUpAt: null,
        followUpStep: 0,
        pausedUntil: null,
        bookingOptions: Prisma.DbNull,
        bookedCalendarEventId: input.eventId,
        bookedStartAt: input.startAt,
        bookedEndAt: input.endAt,
      },
    }),
  ]);
}
