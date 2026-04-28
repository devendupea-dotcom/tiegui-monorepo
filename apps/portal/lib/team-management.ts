import type { CalendarAccessRole, MembershipStatus } from "@prisma/client";
import { buildLegacyWorkspaceCompatibilityUpdate } from "@/lib/user-provisioning";

export const TEAM_CALENDAR_ROLE_OPTIONS: readonly CalendarAccessRole[] = [
  "OWNER",
  "ADMIN",
  "WORKER",
  "READ_ONLY",
];

export function isTeamCalendarAccessRole(
  value: string,
): value is CalendarAccessRole {
  return TEAM_CALENDAR_ROLE_OPTIONS.includes(value as CalendarAccessRole);
}

export function wouldLeaveWorkspaceWithoutOwner(input: {
  currentRole: CalendarAccessRole;
  currentStatus: MembershipStatus;
  nextRole: CalendarAccessRole;
  nextStatus: MembershipStatus;
  activeOwnerCount: number;
}): boolean {
  const currentlyCounts =
    input.currentStatus === "ACTIVE" && input.currentRole === "OWNER";
  const nextCounts =
    input.nextStatus === "ACTIVE" && input.nextRole === "OWNER";

  return currentlyCounts && !nextCounts && input.activeOwnerCount <= 1;
}

export function buildTeamMembershipCompatibilityUpdate(input: {
  currentOrgId: string | null;
  targetOrgId: string;
  role: CalendarAccessRole;
  nextStatus: MembershipStatus;
  fallbackActiveMembership?:
    | {
        organizationId: string;
        role: CalendarAccessRole;
      }
    | null;
}) {
  if (input.nextStatus === "ACTIVE") {
    return buildLegacyWorkspaceCompatibilityUpdate({
      currentOrgId: input.currentOrgId,
      organizationId: input.targetOrgId,
      role: input.role,
    });
  }

  if (input.currentOrgId !== input.targetOrgId) {
    return null;
  }

  if (input.fallbackActiveMembership) {
    return {
      orgId: input.fallbackActiveMembership.organizationId,
      calendarAccessRole: input.fallbackActiveMembership.role,
    };
  }

  return {
    orgId: null,
  };
}
