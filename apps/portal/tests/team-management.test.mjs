import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTeamMembershipCompatibilityUpdate,
  isTeamCalendarAccessRole,
  TEAM_CALENDAR_ROLE_OPTIONS,
  wouldLeaveWorkspaceWithoutOwner,
} from "../lib/team-management.ts";

test("team role guard only accepts supported workspace roles", () => {
  assert.deepEqual([...TEAM_CALENDAR_ROLE_OPTIONS], [
    "OWNER",
    "ADMIN",
    "WORKER",
    "READ_ONLY",
  ]);
  assert.equal(isTeamCalendarAccessRole("ADMIN"), true);
  assert.equal(isTeamCalendarAccessRole("SUPPORT"), false);
});

test("workspace owner coverage blocks removing the final active owner", () => {
  assert.equal(
    wouldLeaveWorkspaceWithoutOwner({
      currentRole: "OWNER",
      currentStatus: "ACTIVE",
      nextRole: "ADMIN",
      nextStatus: "ACTIVE",
      activeOwnerCount: 1,
    }),
    true,
  );

  assert.equal(
    wouldLeaveWorkspaceWithoutOwner({
      currentRole: "OWNER",
      currentStatus: "ACTIVE",
      nextRole: "OWNER",
      nextStatus: "SUSPENDED",
      activeOwnerCount: 2,
    }),
    false,
  );
});

test("membership compatibility switches defaults when suspending the default workspace", () => {
  assert.deepEqual(
    buildTeamMembershipCompatibilityUpdate({
      currentOrgId: "org-1",
      targetOrgId: "org-1",
      role: "WORKER",
      nextStatus: "SUSPENDED",
      fallbackActiveMembership: {
        organizationId: "org-2",
        role: "ADMIN",
      },
    }),
    {
      orgId: "org-2",
      calendarAccessRole: "ADMIN",
    },
  );

  assert.deepEqual(
    buildTeamMembershipCompatibilityUpdate({
      currentOrgId: "org-1",
      targetOrgId: "org-1",
      role: "WORKER",
      nextStatus: "SUSPENDED",
      fallbackActiveMembership: null,
    }),
    {
      orgId: null,
    },
  );
});

test("membership compatibility reuses legacy rollout behavior for active memberships", () => {
  assert.deepEqual(
    buildTeamMembershipCompatibilityUpdate({
      currentOrgId: null,
      targetOrgId: "org-9",
      role: "READ_ONLY",
      nextStatus: "ACTIVE",
    }),
    {
      orgId: "org-9",
      calendarAccessRole: "READ_ONLY",
    },
  );

  assert.equal(
    buildTeamMembershipCompatibilityUpdate({
      currentOrgId: "org-default",
      targetOrgId: "org-9",
      role: "OWNER",
      nextStatus: "ACTIVE",
    }),
    null,
  );
});
