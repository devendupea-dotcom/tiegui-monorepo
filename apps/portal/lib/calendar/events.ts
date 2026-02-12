import type { EventType, Prisma } from "@prisma/client";
import { addMinutes } from "date-fns";
import { DEFAULT_SLOT_MINUTES } from "./dates";

export const calendarEventTypeOptions: EventType[] = [
  "JOB",
  "ESTIMATE",
  "CALL",
  "BLOCK",
  "ADMIN",
  "TRAVEL",
  "FOLLOW_UP",
  "DEMO",
  "ONBOARDING",
  "TASK",
];

export const calendarEventSelect = {
  id: true,
  orgId: true,
  leadId: true,
  type: true,
  provider: true,
  googleEventId: true,
  googleCalendarId: true,
  syncStatus: true,
  lastSyncedAt: true,
  status: true,
  busy: true,
  customerName: true,
  addressLine: true,
  allDay: true,
  title: true,
  description: true,
  startAt: true,
  endAt: true,
  assignedToUserId: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
  workerAssignments: {
    select: {
      workerUserId: true,
      worker: {
        select: {
          name: true,
          email: true,
        },
      },
    },
  },
} satisfies Prisma.EventSelect;

export type CalendarEventRecord = Prisma.EventGetPayload<{
  select: typeof calendarEventSelect;
}>;

export function getEventDurationMinutes(event: { startAt: Date; endAt: Date | null | undefined }) {
  const fallbackEnd = addMinutes(event.startAt, DEFAULT_SLOT_MINUTES);
  const endAt = event.endAt || fallbackEnd;
  const raw = Math.round((endAt.getTime() - event.startAt.getTime()) / 60000);
  return Math.max(15, raw || DEFAULT_SLOT_MINUTES);
}

export function serializeCalendarEvent(event: CalendarEventRecord) {
  return {
    id: event.id,
    orgId: event.orgId,
    leadId: event.leadId,
    type: event.type,
    provider: event.provider,
    googleEventId: event.googleEventId,
    googleCalendarId: event.googleCalendarId,
    syncStatus: event.syncStatus,
    lastSyncedAt: event.lastSyncedAt ? event.lastSyncedAt.toISOString() : null,
    status: event.status,
    busy: event.busy,
    customerName: event.customerName,
    addressLine: event.addressLine,
    allDay: event.allDay,
    title: event.title,
    description: event.description,
    startAt: event.startAt.toISOString(),
    endAt: event.endAt ? event.endAt.toISOString() : null,
    assignedToUserId: event.assignedToUserId,
    createdByUserId: event.createdByUserId,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
    durationMinutes: getEventDurationMinutes(event),
    workerIds: event.workerAssignments.map((assignment) => assignment.workerUserId),
    workers: event.workerAssignments.map((assignment) => ({
      id: assignment.workerUserId,
      name: assignment.worker.name || assignment.worker.email || assignment.workerUserId,
    })),
  };
}

export function normalizeEventType(value: unknown): EventType {
  if (typeof value !== "string") {
    return "JOB";
  }
  const candidate = value.trim().toUpperCase() as EventType;
  if (calendarEventTypeOptions.includes(candidate)) {
    return candidate;
  }
  return "JOB";
}
