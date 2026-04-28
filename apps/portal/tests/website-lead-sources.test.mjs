import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  generateWebsiteLeadSourceRateLimitKey,
  normalizeWebsiteLeadAllowedOrigin,
  normalizeWebsiteLeadSourceDescription,
  normalizeWebsiteLeadSourceName,
  serializeWebsiteLeadSource,
} from "../lib/website-lead-sources.ts";

const portalRoot = new URL("..", import.meta.url);

async function readPortalFile(path) {
  return readFile(new URL(path, portalRoot), "utf8");
}

function assertThrowsCode(fn, code) {
  assert.throws(fn, (error) => error?.code === code);
}

test("website lead source validation accepts only safe origin values", () => {
  assert.equal(normalizeWebsiteLeadAllowedOrigin("https://velocitylandscapes.com/"), "https://velocitylandscapes.com");
  assert.equal(normalizeWebsiteLeadAllowedOrigin("https://VelocityLandscapes.com"), "https://velocitylandscapes.com");
  assert.equal(normalizeWebsiteLeadAllowedOrigin("http://localhost:3000"), "http://localhost:3000");
  assert.equal(normalizeWebsiteLeadAllowedOrigin(""), null);

  assertThrowsCode(
    () => normalizeWebsiteLeadAllowedOrigin("https://velocitylandscapes.com/contact"),
    "allowed_origin_must_be_origin",
  );
  assertThrowsCode(
    () => normalizeWebsiteLeadAllowedOrigin("https://velocitylandscapes.com?x=1"),
    "allowed_origin_must_be_origin",
  );
  assertThrowsCode(
    () => normalizeWebsiteLeadAllowedOrigin("http://velocitylandscapes.com"),
    "invalid_allowed_origin_protocol",
  );
  assertThrowsCode(
    () => normalizeWebsiteLeadAllowedOrigin("not-a-url"),
    "invalid_allowed_origin",
  );
});

test("website lead source validation enforces useful metadata limits", () => {
  assert.equal(normalizeWebsiteLeadSourceName(" Velocity site "), "Velocity site");
  assert.equal(normalizeWebsiteLeadSourceDescription(" Main form "), "Main form");
  assert.equal(normalizeWebsiteLeadSourceDescription(" "), null);

  assertThrowsCode(() => normalizeWebsiteLeadSourceName(""), "missing_name");
  assertThrowsCode(() => normalizeWebsiteLeadSourceName("a".repeat(101)), "name_too_long");
  assertThrowsCode(() => normalizeWebsiteLeadSourceDescription("a".repeat(501)), "description_too_long");
});

test("website lead source serialization never exposes stored secret material", () => {
  const serialized = serializeWebsiteLeadSource({
    id: "source_123456",
    orgId: "org_123",
    name: "Velocity site",
    description: null,
    allowedOrigin: "https://velocitylandscapes.com",
    active: true,
    rateLimitKey: "wlsrl_123",
    lastUsedAt: null,
    createdAt: new Date("2026-04-26T12:00:00.000Z"),
    updatedAt: new Date("2026-04-26T12:00:00.000Z"),
    hashedSecret: "should-not-appear",
    encryptedSecret: "should-not-appear",
    _count: { submissions: 3 },
  });

  assert.equal(serialized.submissionCount, 3);
  assert.equal("hashedSecret" in serialized, false);
  assert.equal("encryptedSecret" in serialized, false);
});

test("website lead source rate limit keys are server-generated", () => {
  const first = generateWebsiteLeadSourceRateLimitKey();
  const second = generateWebsiteLeadSourceRateLimitKey();

  assert.match(first, /^wlsrl_/);
  assert.notEqual(first, second);
});

test("website lead source management APIs are internal-only and org-scoped", async () => {
  const routeFiles = [
    "app/api/hq/orgs/[orgId]/website-lead-sources/route.ts",
    "app/api/hq/orgs/[orgId]/website-lead-sources/[sourceId]/route.ts",
    "app/api/hq/orgs/[orgId]/website-lead-sources/[sourceId]/rotate-secret/route.ts",
    "app/api/hq/orgs/[orgId]/website-lead-sources/[sourceId]/disable/route.ts",
    "app/api/hq/orgs/[orgId]/website-lead-sources/[sourceId]/enable/route.ts",
  ];

  for (const routeFile of routeFiles) {
    const source = await readPortalFile(routeFile);
    assert.match(source, /requireInternalApiUser/);
    assert.match(source, /params\.orgId/);
    assert.doesNotMatch(source, /WEBSITE_LEAD_WEBHOOK_SECRET/);
    assert.doesNotMatch(source, /hashedSecret/);
    assert.doesNotMatch(source, /encryptedSecret/);
  }

  const helper = await readPortalFile("lib/website-lead-sources.ts");
  assert.match(helper, /findFirst\(\{\s*where:\s*\{\s*id: sourceId,\s*orgId/s);
  assert.doesNotMatch(helper, /input\.rateLimitKey/);
});

test("website lead source APIs reveal plaintext secrets only on create and rotation", async () => {
  const createRoute = await readPortalFile("app/api/hq/orgs/[orgId]/website-lead-sources/route.ts");
  const rotateRoute = await readPortalFile(
    "app/api/hq/orgs/[orgId]/website-lead-sources/[sourceId]/rotate-secret/route.ts",
  );
  const patchRoute = await readPortalFile("app/api/hq/orgs/[orgId]/website-lead-sources/[sourceId]/route.ts");
  const disableRoute = await readPortalFile(
    "app/api/hq/orgs/[orgId]/website-lead-sources/[sourceId]/disable/route.ts",
  );
  const enableRoute = await readPortalFile(
    "app/api/hq/orgs/[orgId]/website-lead-sources/[sourceId]/enable/route.ts",
  );

  assert.match(createRoute, /plaintextSecret/);
  assert.match(rotateRoute, /plaintextSecret/);
  assert.doesNotMatch(patchRoute, /plaintextSecret/);
  assert.doesNotMatch(disableRoute, /plaintextSecret/);
  assert.doesNotMatch(enableRoute, /plaintextSecret/);
});

test("website lead source HQ UI warns that signing is server-side only", async () => {
  const page = await readPortalFile("app/hq/orgs/[orgId]/website-leads/page.tsx");
  const manager = await readPortalFile("app/hq/orgs/[orgId]/website-leads/website-lead-sources-manager.tsx");

  assert.match(page, /requireInternalUser/);
  assert.match(manager, /server-side only/i);
  assert.match(manager, /This is the only time the plaintext source secret is shown/);
  assert.match(manager, /X-TieGui-Source-Id/);
  assert.match(manager, /X-TieGui-Signature/);
});

test("website lead smoke script covers signed success, replay, stale timestamp, signature, and origin checks", async () => {
  const source = await readPortalFile("scripts/smoke-website-leads.ts");

  assert.match(source, /createWebsiteLeadSignature/);
  assert.match(source, /duplicate idempotency returned existing result/);
  assert.match(source, /conflicting idempotency body rejected/);
  assert.match(source, /stale timestamp rejected/);
  assert.match(source, /wrong signature rejected/);
  assert.match(source, /wrong origin rejected/);
});
