import type { CalendarAccessRole, Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isInternalRole } from "@/lib/session";

export class CalendarApiError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type CalendarActor = {
  id: string;
  role: Role;
  orgId: string | null;
  calendarAccessRole: CalendarAccessRole;
  internalUser: boolean;
};

function getString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export async function requireCalendarActor(): Promise<CalendarActor> {
  const session = await getServerSession(authOptions);
  const sessionUser = session?.user;
  if (!sessionUser?.id || !sessionUser.role) {
    throw new CalendarApiError("Unauthorized", 401);
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: {
      id: true,
      role: true,
      orgId: true,
      calendarAccessRole: true,
    },
  });

  if (!dbUser) {
    throw new CalendarApiError("Unauthorized", 401);
  }

  return {
    id: dbUser.id,
    role: dbUser.role,
    orgId: dbUser.orgId,
    calendarAccessRole: dbUser.calendarAccessRole,
    internalUser: isInternalRole(dbUser.role),
  };
}

export function resolveOrgIdFromRequest(input: {
  req: Request;
  body?: Record<string, unknown> | null;
}): string | null {
  const queryValue = getString(new URL(input.req.url).searchParams.get("orgId"));
  if (queryValue) {
    return queryValue;
  }
  return input.body ? getString(input.body.orgId) : null;
}

export function assertOrgReadAccess(actor: CalendarActor, orgId: string) {
  if (actor.internalUser) {
    return;
  }
  if (!actor.orgId || actor.orgId !== orgId) {
    throw new CalendarApiError("Forbidden", 403);
  }
}

export function assertOrgWriteAccess(actor: CalendarActor, orgId: string) {
  assertOrgReadAccess(actor, orgId);

  if (actor.internalUser) {
    return;
  }

  if (actor.calendarAccessRole === "READ_ONLY") {
    throw new CalendarApiError("Read-only users cannot edit calendar data.", 403);
  }
}

export function canEditAnyEventInOrg(actor: CalendarActor): boolean {
  if (actor.internalUser) return true;
  return actor.calendarAccessRole === "OWNER" || actor.calendarAccessRole === "ADMIN";
}

export function assertWorkerEditAllowed(input: {
  actor: CalendarActor;
  workerUserIds: string[];
}) {
  if (canEditAnyEventInOrg(input.actor)) {
    return;
  }

  if (input.actor.calendarAccessRole === "READ_ONLY") {
    throw new CalendarApiError("Read-only users cannot edit calendar data.", 403);
  }

  const includesActor = input.workerUserIds.includes(input.actor.id);
  if (!includesActor) {
    throw new CalendarApiError("Workers can only edit events assigned to themselves.", 403);
  }
}
