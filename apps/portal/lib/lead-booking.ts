import { Prisma, type CalendarEventStatus, type EventType } from "@prisma/client";
import { ensureOperationalJobFromLeadBooking, isOperationalBookingEventType } from "@/lib/operational-jobs";

const ACTIVE_LEAD_BOOKING_STATUSES: CalendarEventStatus[] = [
  "SCHEDULED",
  "CONFIRMED",
  "EN_ROUTE",
  "ON_SITE",
  "IN_PROGRESS",
];

export function isLeadBookingEvent(type: EventType): boolean {
  return isOperationalBookingEventType(type);
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
  },
): Promise<string | null> {
  // Event is the canonical booking row. LeadConversationState keeps only a
  // lightweight snapshot so the automation/conversation layer can stay aligned.
  if (!input.leadId || !isLeadBookingEvent(input.type)) {
    await tx.event.updateMany({
      where: {
        id: input.eventId,
        orgId: input.orgId,
      },
      data: {
        jobId: null,
      },
    });
    return null;
  }

  const bookingJob = await ensureOperationalJobFromLeadBooking(tx, input);

  if (!isActiveLeadBookingEvent({ type: input.type, status: input.status })) {
    return bookingJob.jobId;
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

  return bookingJob.jobId;
}
