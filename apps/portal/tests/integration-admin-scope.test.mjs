import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canAdministerIntegrations } from "../lib/integrations/access.ts";

const portalRoot = new URL("..", import.meta.url);

function routePath(path) {
  return new URL(path, portalRoot);
}

test("integration admin access allows owners, admins, and internal users", () => {
  assert.equal(canAdministerIntegrations({ internalUser: false, calendarAccessRole: "OWNER" }), true);
  assert.equal(canAdministerIntegrations({ internalUser: false, calendarAccessRole: "ADMIN" }), true);
  assert.equal(canAdministerIntegrations({ internalUser: true, calendarAccessRole: "READ_ONLY" }), true);
});

test("integration admin access blocks read-only and worker users", () => {
  assert.equal(canAdministerIntegrations({ internalUser: false, calendarAccessRole: "READ_ONLY" }), false);
  assert.equal(canAdministerIntegrations({ internalUser: false, calendarAccessRole: "WORKER" }), false);
});

test("sensitive integration and export routes use admin scope", async () => {
  const adminScopedRoutes = [
    "app/api/export/route.ts",
    "app/api/integrations/disconnect/route.ts",
    "app/api/integrations/import/route.ts",
    "app/api/integrations/sync/route.ts",
    "app/api/integrations/google/connect/route.ts",
    "app/api/integrations/google/disconnect/route.ts",
    "app/api/integrations/google/sync/route.ts",
    "app/api/integrations/jobber/connect/route.ts",
    "app/api/integrations/outlook/connect/route.ts",
    "app/api/integrations/qbo/connect/route.ts",
    "app/api/integrations/stripe/connect/route.ts",
  ];

  for (const path of adminScopedRoutes) {
    const source = await readFile(routePath(path), "utf8");
    assert.match(source, /resolveIntegrationAdminScope/, `${path} must require owner/admin/internal scope`);
    assert.doesNotMatch(source, /resolveIntegrationOrgScope/, `${path} must not rely on broad org scope`);
  }
});

test("integration OAuth callbacks re-check admin access before saving tokens", async () => {
  const callbackRoutes = [
    "app/api/integrations/google/callback/route.ts",
    "app/api/integrations/jobber/callback/route.ts",
    "app/api/integrations/outlook/callback/route.ts",
    "app/api/integrations/qbo/callback/route.ts",
    "app/api/integrations/stripe/callback/route.ts",
  ];

  for (const path of callbackRoutes) {
    const source = await readFile(routePath(path), "utf8");
    assert.match(source, /assertIntegrationAdminAccess/, `${path} must re-check owner/admin/internal scope`);
    assert.doesNotMatch(source, /assertOrgAccess/, `${path} must not rely on read-level org access`);
  }
});
