import test from "node:test";
import assert from "node:assert/strict";

import {
  buildActiveOrganizationMembershipData,
  buildLegacyWorkspaceCompatibilityUpdate,
  createProvisionedPortalUser,
  syncClientUserOrganizationAccess,
} from "../lib/user-provisioning.ts";

test("client provisioning creates organization membership from the created user's effective workspace role", async () => {
  const calls = [];
  const tx = {
    user: {
      create: async ({ data }) => {
        calls.push({ kind: "user.create", data });
        return {
          id: "user-1",
          email: data.email,
          calendarAccessRole: "ADMIN",
        };
      },
      findUnique: async ({ where }) => {
        calls.push({ kind: "user.findUnique", where });
        return { orgId: "org-1" };
      },
      update: async ({ where, data }) => {
        calls.push({ kind: "user.update", where, data });
        return { id: where.id };
      },
    },
    organizationMembership: {
      create: async ({ data }) => {
        calls.push({ kind: "organizationMembership.create", data });
        return { id: "membership-1" };
      },
      upsert: async ({ where, update, create }) => {
        calls.push({ kind: "organizationMembership.upsert", where, update, create });
        return { id: "membership-1" };
      },
    },
  };

  const user = await createProvisionedPortalUser({
    tx,
    email: "contractor@example.com",
    name: "Contractor",
    role: "CLIENT",
    orgId: "org-1",
  });

  assert.equal(user.id, "user-1");
  assert.deepEqual(calls, [
    {
      kind: "user.create",
      data: {
        email: "contractor@example.com",
        name: "Contractor",
        role: "CLIENT",
        orgId: "org-1",
        mustChangePassword: true,
      },
    },
    {
      kind: "user.findUnique",
      where: { id: "user-1" },
    },
    {
      kind: "organizationMembership.upsert",
      where: {
        organizationId_userId: {
          organizationId: "org-1",
          userId: "user-1",
        },
      },
      update: {
        role: "ADMIN",
        status: "ACTIVE",
      },
      create: {
        organizationId: "org-1",
        userId: "user-1",
        role: "ADMIN",
        status: "ACTIVE",
      },
    },
    {
      kind: "user.update",
      where: { id: "user-1" },
      data: {
        calendarAccessRole: "ADMIN",
      },
    },
  ]);
});

test("internal provisioning does not create an organization membership or retain a default org", async () => {
  const calls = [];
  const tx = {
    user: {
      create: async ({ data }) => {
        calls.push({ kind: "user.create", data });
        return {
          id: "user-2",
          email: data.email,
          calendarAccessRole: "WORKER",
        };
      },
      findUnique: async () => {
        throw new Error("findUnique should not run for internal provisioning");
      },
      update: async () => {
        throw new Error("update should not run for internal provisioning");
      },
    },
    organizationMembership: {
      create: async () => {
        throw new Error("create should not run for internal provisioning");
      },
      upsert: async () => {
        throw new Error("upsert should not run for internal provisioning");
      },
    },
  };

  await createProvisionedPortalUser({
    tx,
    email: "ops@example.com",
    name: null,
    role: "INTERNAL",
    orgId: "org-1",
  });

  assert.deepEqual(calls, [
    {
      kind: "user.create",
      data: {
        email: "ops@example.com",
        name: null,
        role: "INTERNAL",
        orgId: null,
        mustChangePassword: true,
      },
    },
  ]);
});

test("syncing client organization access adopts the org as default when the user has no default workspace yet", async () => {
  const calls = [];
  const tx = {
    user: {
      create: async () => {
        throw new Error("not used");
      },
      findUnique: async ({ where }) => {
        calls.push({ kind: "user.findUnique", where });
        return { orgId: null };
      },
      update: async ({ where, data }) => {
        calls.push({ kind: "user.update", where, data });
        return { id: where.id };
      },
    },
    organizationMembership: {
      create: async () => {
        throw new Error("not used");
      },
      upsert: async ({ where, update, create }) => {
        calls.push({ kind: "organizationMembership.upsert", where, update, create });
        return { id: "membership-2" };
      },
    },
  };

  await syncClientUserOrganizationAccess({
    tx,
    userId: "user-3",
    organizationId: "org-2",
    role: "OWNER",
  });

  assert.deepEqual(calls, [
    {
      kind: "user.findUnique",
      where: { id: "user-3" },
    },
    {
      kind: "organizationMembership.upsert",
      where: {
        organizationId_userId: {
          organizationId: "org-2",
          userId: "user-3",
        },
      },
      update: {
        role: "OWNER",
        status: "ACTIVE",
      },
      create: {
        organizationId: "org-2",
        userId: "user-3",
        role: "OWNER",
        status: "ACTIVE",
      },
    },
    {
      kind: "user.update",
      where: { id: "user-3" },
      data: {
        orgId: "org-2",
        calendarAccessRole: "OWNER",
      },
    },
  ]);
});

test("syncing client organization access leaves compatibility fields alone when another org is already the default", async () => {
  const calls = [];
  const tx = {
    user: {
      create: async () => {
        throw new Error("not used");
      },
      findUnique: async ({ where }) => {
        calls.push({ kind: "user.findUnique", where });
        return { orgId: "org-default" };
      },
      update: async ({ where, data }) => {
        calls.push({ kind: "user.update", where, data });
        return { id: where.id };
      },
    },
    organizationMembership: {
      create: async () => {
        throw new Error("not used");
      },
      upsert: async ({ where, update, create }) => {
        calls.push({ kind: "organizationMembership.upsert", where, update, create });
        return { id: "membership-3" };
      },
    },
  };

  await syncClientUserOrganizationAccess({
    tx,
    userId: "user-4",
    organizationId: "org-secondary",
    role: "WORKER",
  });

  assert.deepEqual(calls, [
    {
      kind: "user.findUnique",
      where: { id: "user-4" },
    },
    {
      kind: "organizationMembership.upsert",
      where: {
        organizationId_userId: {
          organizationId: "org-secondary",
          userId: "user-4",
        },
      },
      update: {
        role: "WORKER",
        status: "ACTIVE",
      },
      create: {
        organizationId: "org-secondary",
        userId: "user-4",
        role: "WORKER",
        status: "ACTIVE",
      },
    },
  ]);
});

test("compatibility updates only mirror the default workspace role during rollout", () => {
  assert.deepEqual(
    buildLegacyWorkspaceCompatibilityUpdate({
      currentOrgId: null,
      organizationId: "org-5",
      role: "ADMIN",
    }),
    {
      orgId: "org-5",
      calendarAccessRole: "ADMIN",
    },
  );

  assert.deepEqual(
    buildLegacyWorkspaceCompatibilityUpdate({
      currentOrgId: "org-5",
      organizationId: "org-5",
      role: "OWNER",
    }),
    {
      calendarAccessRole: "OWNER",
    },
  );

  assert.equal(
    buildLegacyWorkspaceCompatibilityUpdate({
      currentOrgId: "org-legacy",
      organizationId: "org-5",
      role: "OWNER",
    }),
    null,
  );
});

test("active organization membership data uses the target org and role directly", () => {
  assert.deepEqual(
    buildActiveOrganizationMembershipData({
      organizationId: "org-7",
      userId: "user-7",
      role: "WORKER",
    }),
    {
      organizationId: "org-7",
      userId: "user-7",
      role: "WORKER",
      status: "ACTIVE",
    },
  );
});
