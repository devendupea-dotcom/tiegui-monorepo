import { type CalendarEventStatus, type EventType, type Prisma } from "@prisma/client";
import { activeBookingEventStatuses, bookingEventTypes, isActiveBookingEvent, isBookingEventType } from "@/lib/booking-read-model";
import { ensureOperationalJobFromLeadBooking, isOperationalBookingEventType } from "@/lib/operational-jobs";

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
  if (!input.leadId || !isBookingEventType(input.type) || !isOperationalBookingEventType(input.type)) {
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
  const activeBooking = await tx.event.findFirst({
    where: {
      orgId: input.orgId,
      leadId: input.leadId,
      type: {
        in: bookingEventTypes,
      },
      status: {
        in: activeBookingEventStatuses,
      },
    },
    orderBy: [{ startAt: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      startAt: true,
      endAt: true,
      jobId: true,
      type: true,
      status: true,
    },
  });

  await tx.leadConversationState.updateMany({
    where: { leadId: input.leadId },
    data: {
      bookedCalendarEventId: activeBooking?.id || null,
      bookedStartAt: activeBooking?.startAt || null,
      bookedEndAt: activeBooking?.endAt || null,
    },
  });

  if (!activeBooking || !isActiveBookingEvent({ type: activeBooking.type, status: activeBooking.status })) {
    return bookingJob.jobId;
  }

  return bookingJob.jobId || activeBooking.jobId || null;
}
