import type { AgencyRole, CalendarAccessRole } from "@prisma/client";

export type AppApiOrgAccessSource =
  | "internal"
  | "organization_membership"
  | "agency_membership";

export type AppApiResolvedOrgAccess = {
  orgId: string;
  effectiveOrgRole: CalendarAccessRole;
  agencyId: string | null;
  accessSource: AppApiOrgAccessSource;
};

export type DirectOrgMembershipInput = {
  organizationId: string;
  role: CalendarAccessRole;
  agencyId: string | null;
};

export type AgencyOrgAccessInput = {
  organizationId: string;
  agencyId: string | null;
  agencyRole: AgencyRole;
};

export type NonInternalOrgSelection =
  | { kind: "resolved"; context: AppApiResolvedOrgAccess }
  | { kind: "forbidden" }
  | { kind: "selection_required" }
  | { kind: "missing_scope" };

export type InternalOrgSelection =
  | { kind: "resolved"; orgId: string }
  | { kind: "not_found" }
  | { kind: "selection_required" }
  | { kind: "missing_scope" };

const ACCESS_SOURCE_PRIORITY: Record<Exclude<AppApiOrgAccessSource, "internal">, number> = {
  organization_membership: 3,
  agency_membership: 2,
};

function getAccessPriority(source: Exclude<AppApiOrgAccessSource, "internal">): number {
  return ACCESS_SOURCE_PRIORITY[source];
}

function trimOrgId(value: string | null | undefined): string | null {
  const trimmed = (value || "").trim();
  return trimmed || null;
}

export function mapAgencyRoleToCalendarAccessRole(role: AgencyRole): CalendarAccessRole {
  switch (role) {
    case "OWNER":
      return "OWNER";
    case "ADMIN":
      return "ADMIN";
    case "SUPPORT":
      return "READ_ONLY";
    default:
      return "READ_ONLY";
  }
}

function mergeAccessCandidate(
  target: Map<string, AppApiResolvedOrgAccess>,
  candidate: AppApiResolvedOrgAccess,
) {
  const existing = target.get(candidate.orgId);
  if (!existing) {
    target.set(candidate.orgId, candidate);
    return;
  }

  const existingPriority = getAccessPriority(existing.accessSource as Exclude<AppApiOrgAccessSource, "internal">);
  const candidatePriority = getAccessPriority(candidate.accessSource as Exclude<AppApiOrgAccessSource, "internal">);
  if (candidatePriority > existingPriority) {
    target.set(candidate.orgId, candidate);
  }
}

export function buildAccessibleOrgContexts(input: {
  directMemberships: DirectOrgMembershipInput[];
  agencyAccesses: AgencyOrgAccessInput[];
}): AppApiResolvedOrgAccess[] {
  const contexts = new Map<string, AppApiResolvedOrgAccess>();

  for (const membership of input.directMemberships) {
    mergeAccessCandidate(contexts, {
      orgId: membership.organizationId,
      effectiveOrgRole: membership.role,
      agencyId: membership.agencyId,
      accessSource: "organization_membership",
    });
  }

  for (const access of input.agencyAccesses) {
    mergeAccessCandidate(contexts, {
      orgId: access.organizationId,
      effectiveOrgRole: mapAgencyRoleToCalendarAccessRole(access.agencyRole),
      agencyId: access.agencyId,
      accessSource: "agency_membership",
    });
  }

  return Array.from(contexts.values()).sort((left, right) => left.orgId.localeCompare(right.orgId));
}

export function selectNonInternalOrgContext(input: {
  requestedOrgId?: string | null;
  defaultOrgId?: string | null;
  accessibleOrgs: AppApiResolvedOrgAccess[];
}): NonInternalOrgSelection {
  const requestedOrgId = trimOrgId(input.requestedOrgId);
  const defaultOrgId = trimOrgId(input.defaultOrgId);

  if (requestedOrgId) {
    const match = input.accessibleOrgs.find((context) => context.orgId === requestedOrgId);
    return match ? { kind: "resolved", context: match } : { kind: "forbidden" };
  }

  if (defaultOrgId) {
    const defaultContext = input.accessibleOrgs.find((context) => context.orgId === defaultOrgId);
    if (defaultContext) {
      return { kind: "resolved", context: defaultContext };
    }
  }

  if (input.accessibleOrgs.length === 1) {
    const [onlyContext] = input.accessibleOrgs;
    if (onlyContext) {
      return { kind: "resolved", context: onlyContext };
    }
  }

  if (input.accessibleOrgs.length === 0) {
    return { kind: "missing_scope" };
  }

  return { kind: "selection_required" };
}

export function selectInternalOrgContext(input: {
  requestedOrgId?: string | null;
  defaultOrgId?: string | null;
  requestedOrgExists?: boolean;
  defaultOrgExists?: boolean;
  discoverableOrgIds: string[];
}): InternalOrgSelection {
  const requestedOrgId = trimOrgId(input.requestedOrgId);
  const defaultOrgId = trimOrgId(input.defaultOrgId);

  if (requestedOrgId) {
    return input.requestedOrgExists ? { kind: "resolved", orgId: requestedOrgId } : { kind: "not_found" };
  }

  if (defaultOrgId && input.defaultOrgExists) {
    return { kind: "resolved", orgId: defaultOrgId };
  }

  if (input.discoverableOrgIds.length === 1) {
    const [onlyOrgId] = input.discoverableOrgIds;
    if (onlyOrgId) {
      return { kind: "resolved", orgId: onlyOrgId };
    }
  }

  if (input.discoverableOrgIds.length === 0) {
    return { kind: "missing_scope" };
  }

  return { kind: "selection_required" };
}
