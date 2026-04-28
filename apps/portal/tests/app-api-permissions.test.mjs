import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAccessibleOrgContexts,
  mapAgencyRoleToCalendarAccessRole,
  selectInternalOrgContext,
  selectNonInternalOrgContext,
} from "../lib/app-api-org-access.ts";

test("direct organization membership resolves access to the requested org", () => {
  const contexts = buildAccessibleOrgContexts({
    directMemberships: [
      {
        organizationId: "org-1",
        role: "ADMIN",
        agencyId: "agency-1",
      },
    ],
    agencyAccesses: [],
  });

  const selection = selectNonInternalOrgContext({
    requestedOrgId: "org-1",
    defaultOrgId: null,
    accessibleOrgs: contexts,
  });

  assert.equal(selection.kind, "resolved");
  assert.equal(selection.context.orgId, "org-1");
  assert.equal(selection.context.effectiveOrgRole, "ADMIN");
  assert.equal(selection.context.accessSource, "organization_membership");
});

test("agency membership grants access only to child organizations", () => {
  const contexts = buildAccessibleOrgContexts({
    directMemberships: [],
    agencyAccesses: [
      {
        organizationId: "org-child",
        agencyId: "agency-1",
        agencyRole: "ADMIN",
      },
    ],
  });

  const selection = selectNonInternalOrgContext({
    requestedOrgId: "org-child",
    defaultOrgId: null,
    accessibleOrgs: contexts,
  });

  assert.equal(selection.kind, "resolved");
  assert.equal(selection.context.effectiveOrgRole, "ADMIN");
  assert.equal(selection.context.accessSource, "agency_membership");
});

test("requested org outside accessible agency scope is denied", () => {
  const contexts = buildAccessibleOrgContexts({
    directMemberships: [],
    agencyAccesses: [
      {
        organizationId: "org-1",
        agencyId: "agency-1",
        agencyRole: "OWNER",
      },
    ],
  });

  const selection = selectNonInternalOrgContext({
    requestedOrgId: "org-2",
    defaultOrgId: null,
    accessibleOrgs: contexts,
  });

  assert.deepEqual(selection, { kind: "forbidden" });
});

test("internal user access resolves explicitly requested organizations", () => {
  const selection = selectInternalOrgContext({
    requestedOrgId: "org-9",
    requestedOrgExists: true,
    defaultOrgId: null,
    defaultOrgExists: false,
    discoverableOrgIds: ["org-1", "org-2"],
  });

  assert.deepEqual(selection, {
    kind: "resolved",
    orgId: "org-9",
  });
});

test("multiple accessible orgs with no explicit org selection does not guess", () => {
  const contexts = buildAccessibleOrgContexts({
    directMemberships: [
      {
        organizationId: "org-1",
        role: "ADMIN",
        agencyId: "agency-1",
      },
      {
        organizationId: "org-2",
        role: "WORKER",
        agencyId: "agency-1",
      },
    ],
    agencyAccesses: [],
  });

  const selection = selectNonInternalOrgContext({
    requestedOrgId: null,
    defaultOrgId: null,
    accessibleOrgs: contexts,
  });

  assert.deepEqual(selection, { kind: "selection_required" });
});

test("user.orgId alone does not grant access without a membership", () => {
  const contexts = buildAccessibleOrgContexts({
    directMemberships: [],
    agencyAccesses: [],
  });

  const selection = selectNonInternalOrgContext({
    requestedOrgId: null,
    defaultOrgId: "org-legacy",
    accessibleOrgs: contexts,
  });

  assert.deepEqual(selection, { kind: "missing_scope" });
});

test("requested org is denied when user only has a legacy default org with no membership", () => {
  const contexts = buildAccessibleOrgContexts({
    directMemberships: [],
    agencyAccesses: [],
  });

  const selection = selectNonInternalOrgContext({
    requestedOrgId: "org-legacy",
    defaultOrgId: "org-legacy",
    accessibleOrgs: contexts,
  });

  assert.deepEqual(selection, { kind: "forbidden" });
});

test("precedence order is direct org membership over agency membership", () => {
  const contexts = buildAccessibleOrgContexts({
    directMemberships: [
      {
        organizationId: "org-1",
        role: "READ_ONLY",
        agencyId: "agency-1",
      },
    ],
    agencyAccesses: [
      {
        organizationId: "org-1",
        agencyId: "agency-1",
        agencyRole: "OWNER",
      },
    ],
  });

  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].orgId, "org-1");
  assert.equal(contexts[0].effectiveOrgRole, "READ_ONLY");
  assert.equal(contexts[0].accessSource, "organization_membership");
});

test("support agency role stays conservative at read-only for inherited org access", () => {
  assert.equal(mapAgencyRoleToCalendarAccessRole("SUPPORT"), "READ_ONLY");
});
