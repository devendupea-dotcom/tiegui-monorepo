import type { CalendarAccessRole } from "@prisma/client";

export type CalendarAccessActorLike = {
  id: string;
  internalUser: boolean;
  calendarAccessRole: CalendarAccessRole;
};

export function canEditAnyCalendarEventInOrg(actor: CalendarAccessActorLike): boolean {
  if (actor.internalUser) return true;
  return actor.calendarAccessRole === "OWNER" || actor.calendarAccessRole === "ADMIN";
}

export function getCalendarWorkerEditErrorMessage(input: {
  actor: CalendarAccessActorLike;
  workerUserIds: string[];
}): string | null {
  if (canEditAnyCalendarEventInOrg(input.actor)) {
    return null;
  }

  if (input.actor.calendarAccessRole === "READ_ONLY") {
    return "Read-only users cannot edit calendar data.";
  }

  if (!input.workerUserIds.includes(input.actor.id)) {
    return "Workers can only edit events assigned to themselves.";
  }

  return null;
}
