import type { CalendarAccessRole, Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { AppApiError } from "@/lib/app-api-error";
import { prisma } from "@/lib/prisma";
import { isInternalRole } from "@/lib/session";
import {
  type AgencyOrgAccessInput,
  buildAccessibleOrgContexts,
  selectInternalOrgContext,
  selectNonInternalOrgContext,
  type AppApiOrgAccessSource,
  type AppApiResolvedOrgAccess,
} from "@/lib/app-api-org-access";

export { AppApiError } from "@/lib/app-api-error";

export type AppApiActor = {
  id: string;
  role: Role;
  defaultOrgId: string | null;
  orgId: string | null;
  calendarAccessRole: CalendarAccessRole;
  internalUser: boolean;
  agencyId: string | null;
  accessSource: AppApiOrgAccessSource | null;
  accessibleOrgs: AppApiResolvedOrgAccess[];
};

function trimOrgId(value: string | null | undefined): string | null {
  const trimmed = (value || "").trim();
  return trimmed || null;
}

function applyResolvedOrgAccess(actor: AppApiActor, context: AppApiResolvedOrgAccess) {
  actor.orgId = context.orgId;
  actor.calendarAccessRole = context.effectiveOrgRole;
  actor.agencyId = context.agencyId;
  actor.accessSource = context.accessSource;
}

function applyInternalOrgAccess(actor: AppApiActor, orgId: string) {
  actor.orgId = orgId;
  actor.calendarAccessRole = "OWNER";
  actor.agencyId = null;
  actor.accessSource = "internal";
}

async function findExistingOrgId(orgId: string): Promise<string | null> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true },
  });
  return org?.id || null;
}

async function findDiscoverableInternalOrgIds(): Promise<string[]> {
  const rows = await prisma.organization.findMany({
    select: { id: true },
    orderBy: { name: "asc" },
    take: 2,
  });
  return rows.map((row) => row.id);
}

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
      organizationMemberships: {
        where: { status: "ACTIVE" },
        select: {
          organizationId: true,
          role: true,
          organization: {
            select: {
              agencyId: true,
            },
          },
        },
      },
      agencyMemberships: {
        where: {
          status: "ACTIVE",
          agency: {
            status: "ACTIVE",
          },
        },
        select: {
          agencyId: true,
          role: true,
        },
      },
    },
  });

  if (!user) {
    throw new AppApiError("Unauthorized", 401);
  }

  const agencyMemberships = user.agencyMemberships;
  const agencyAccesses =
    agencyMemberships.length > 0
      ? await prisma.organization.findMany({
          where: {
            agencyId: {
              in: agencyMemberships.map((membership) => membership.agencyId),
            },
          },
          select: {
            id: true,
            agencyId: true,
          },
        })
      : [];

  const agencyRoleByAgencyId = new Map(
    agencyMemberships.map((membership) => [membership.agencyId, membership.role] as const),
  );

  const accessibleOrgs = buildAccessibleOrgContexts({
    directMemberships: user.organizationMemberships.map((membership) => ({
      organizationId: membership.organizationId,
      role: membership.role,
      agencyId: membership.organization.agencyId,
    })),
    agencyAccesses: agencyAccesses
      .map((organization) => {
        const agencyRole = organization.agencyId ? agencyRoleByAgencyId.get(organization.agencyId) : null;
        if (!agencyRole) return null;
        return {
          organizationId: organization.id,
          agencyId: organization.agencyId,
          agencyRole,
        };
      })
      .filter((value): value is AgencyOrgAccessInput => Boolean(value)),
  });

  const defaultContext = trimOrgId(user.orgId)
    ? accessibleOrgs.find((context) => context.orgId === user.orgId) || null
    : null;

  return {
    id: user.id,
    role: user.role,
    defaultOrgId: user.orgId,
    orgId: defaultContext?.orgId || null,
    calendarAccessRole: defaultContext?.effectiveOrgRole || "READ_ONLY",
    internalUser: isInternalRole(user.role),
    agencyId: defaultContext?.agencyId || null,
    accessSource: defaultContext?.accessSource || null,
    accessibleOrgs,
  };
}

export async function resolveActorOrgId(input: {
  actor: AppApiActor;
  requestedOrgId?: string | null;
}): Promise<string> {
  const requestedOrgId = trimOrgId(input.requestedOrgId);

  if (input.actor.internalUser) {
    const requestedOrgExists = requestedOrgId ? Boolean(await findExistingOrgId(requestedOrgId)) : false;
    const defaultOrgExists = input.actor.defaultOrgId ? Boolean(await findExistingOrgId(input.actor.defaultOrgId)) : false;
    const selection = selectInternalOrgContext({
      requestedOrgId,
      defaultOrgId: input.actor.defaultOrgId,
      requestedOrgExists,
      defaultOrgExists,
      discoverableOrgIds: await findDiscoverableInternalOrgIds(),
    });

    switch (selection.kind) {
      case "resolved":
        applyInternalOrgAccess(input.actor, selection.orgId);
        return selection.orgId;
      case "not_found":
        throw new AppApiError("Organization not found.", 404);
      case "missing_scope":
        throw new AppApiError("No organizations found.", 404);
      case "selection_required":
      default:
        throw new AppApiError("Organization selection required.", 400);
    }
  }

  const selection = selectNonInternalOrgContext({
    requestedOrgId,
    defaultOrgId: input.actor.defaultOrgId,
    accessibleOrgs: input.actor.accessibleOrgs,
  });

  switch (selection.kind) {
    case "resolved":
      applyResolvedOrgAccess(input.actor, selection.context);
      return selection.context.orgId;
    case "forbidden":
      throw new AppApiError("Forbidden", 403);
    case "selection_required":
      throw new AppApiError("Organization selection required.", 400);
    case "missing_scope":
    default:
      throw new AppApiError("Client account is missing org scope.", 400);
  }
}

function resolveActorOrgAccess(actor: AppApiActor, orgId: string): AppApiResolvedOrgAccess {
  if (actor.internalUser) {
    const context: AppApiResolvedOrgAccess = {
      orgId,
      effectiveOrgRole: "OWNER",
      agencyId: null,
      accessSource: "internal",
    };
    applyResolvedOrgAccess(actor, context);
    return context;
  }

  const context = actor.accessibleOrgs.find((item) => item.orgId === orgId);
  if (!context) {
    throw new AppApiError("Forbidden", 403);
  }

  applyResolvedOrgAccess(actor, context);
  return context;
}

export function canManageAnyOrgJobs(
  actor: Pick<AppApiActor, "internalUser" | "calendarAccessRole"> & Record<string, unknown>,
): boolean {
  if (actor.internalUser) return true;
  return actor.calendarAccessRole === "OWNER" || actor.calendarAccessRole === "ADMIN";
}

export function assertOrgReadAccess(actor: AppApiActor, orgId: string) {
  resolveActorOrgAccess(actor, orgId);
}

export function assertOrgWriteAccess(actor: AppApiActor, orgId: string) {
  const resolved = resolveActorOrgAccess(actor, orgId);
  if (!actor.internalUser && resolved.effectiveOrgRole === "READ_ONLY") {
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
