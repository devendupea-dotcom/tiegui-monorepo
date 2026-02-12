import type { CalendarAccessRole, Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isInternalRole } from "@/lib/session";

export class AppApiError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type AppApiActor = {
  id: string;
  role: Role;
  orgId: string | null;
  calendarAccessRole: CalendarAccessRole;
  internalUser: boolean;
};

export async function requireAppApiActor(): Promise<AppApiActor> {
  const session = await getServerSession(authOptions);
  const sessionUser = session?.user;

  if (!sessionUser?.id) {
    throw new AppApiError("Unauthorized", 401);
  }

  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: {
      id: true,
      role: true,
      orgId: true,
      calendarAccessRole: true,
    },
  });

  if (!user) {
    throw new AppApiError("Unauthorized", 401);
  }

  return {
    id: user.id,
    role: user.role,
    orgId: user.orgId,
    calendarAccessRole: user.calendarAccessRole,
    internalUser: isInternalRole(user.role),
  };
}

export async function resolveActorOrgId(input: {
  actor: AppApiActor;
  requestedOrgId?: string | null;
}): Promise<string> {
  const requestedOrgId = (input.requestedOrgId || "").trim() || null;
  if (input.actor.internalUser) {
    if (requestedOrgId) {
      const org = await prisma.organization.findUnique({
        where: { id: requestedOrgId },
        select: { id: true },
      });
      if (!org) {
        throw new AppApiError("Organization not found.", 404);
      }
      return requestedOrgId;
    }

    const firstOrg = await prisma.organization.findFirst({
      select: { id: true },
      orderBy: { name: "asc" },
    });

    if (!firstOrg) {
      throw new AppApiError("No organizations found.", 404);
    }

    return firstOrg.id;
  }

  if (!input.actor.orgId) {
    throw new AppApiError("Client account is missing org scope.", 400);
  }

  if (requestedOrgId && requestedOrgId !== input.actor.orgId) {
    throw new AppApiError("Forbidden", 403);
  }

  return input.actor.orgId;
}

export function canManageAnyOrgJobs(actor: AppApiActor): boolean {
  if (actor.internalUser) return true;
  return actor.calendarAccessRole === "OWNER" || actor.calendarAccessRole === "ADMIN";
}

export function assertOrgReadAccess(actor: AppApiActor, orgId: string) {
  if (actor.internalUser) return;
  if (!actor.orgId || actor.orgId !== orgId) {
    throw new AppApiError("Forbidden", 403);
  }
}

export function assertOrgWriteAccess(actor: AppApiActor, orgId: string) {
  assertOrgReadAccess(actor, orgId);
  if (!actor.internalUser && actor.calendarAccessRole === "READ_ONLY") {
    throw new AppApiError("Read-only users cannot edit this data.", 403);
  }
}

export async function assertCanCreateOrganicLead(actor: AppApiActor, orgId: string) {
  assertOrgWriteAccess(actor, orgId);

  if (canManageAnyOrgJobs(actor)) {
    return;
  }

  if (actor.calendarAccessRole !== "WORKER") {
    throw new AppApiError("Forbidden", 403);
  }

  const orgConfig = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { allowWorkerLeadCreate: true },
  });

  const workerEnabled = orgConfig?.allowWorkerLeadCreate ?? true;
  if (!workerEnabled) {
    throw new AppApiError("Workers cannot create organic leads for this workspace.", 403);
  }
}

async function canWorkerMutateLead(input: {
  actor: AppApiActor;
  orgId: string;
  leadId: string;
}): Promise<boolean> {
  if (input.actor.calendarAccessRole !== "WORKER") {
    return false;
  }

  const scoped = await prisma.lead.findFirst({
    where: {
      id: input.leadId,
      orgId: input.orgId,
      OR: [
        { assignedToUserId: input.actor.id },
        { createdByUserId: input.actor.id },
        { events: { some: { assignedToUserId: input.actor.id } } },
        { events: { some: { workerAssignments: { some: { workerUserId: input.actor.id } } } } },
      ],
    },
    select: { id: true },
  });

  return Boolean(scoped);
}

export async function assertCanMutateLeadJob(input: {
  actor: AppApiActor;
  orgId: string;
  leadId: string;
}) {
  assertOrgWriteAccess(input.actor, input.orgId);

  if (canManageAnyOrgJobs(input.actor)) {
    return;
  }

  const allowed = await canWorkerMutateLead(input);
  if (!allowed) {
    throw new AppApiError("Workers can only update jobs assigned to them.", 403);
  }
}
