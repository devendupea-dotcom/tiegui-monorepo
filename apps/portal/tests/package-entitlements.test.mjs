import assert from "node:assert/strict";
import test from "node:test";
import {
  canUseMessagingLaunchMode,
  getPackageEntitlements,
  getPackageMessagingMismatch,
} from "../lib/package-entitlements.ts";

test("portal-only package keeps CRM available but blocks live SMS", () => {
  const entitlements = getPackageEntitlements("PORTAL_ONLY");

  assert.equal(entitlements.shortLabel, "Portal Only");
  assert.equal(entitlements.canUseLiveSms, false);
  assert.equal(entitlements.requiresNoSmsMode, true);
  assert.equal(
    canUseMessagingLaunchMode({
      package: "PORTAL_ONLY",
      messagingLaunchMode: "NO_SMS",
    }),
    true,
  );
  assert.equal(
    canUseMessagingLaunchMode({
      package: "PORTAL_ONLY",
      messagingLaunchMode: "LIVE_SMS",
    }),
    false,
  );
});

test("messaging-enabled and managed packages can use live SMS", () => {
  assert.equal(getPackageEntitlements("MESSAGING_ENABLED").canUseLiveSms, true);
  assert.equal(getPackageEntitlements("MANAGED").canUseLiveSms, true);
  assert.equal(getPackageEntitlements("MANAGED").managedSetupIncluded, true);
  assert.equal(
    canUseMessagingLaunchMode({
      package: "MESSAGING_ENABLED",
      messagingLaunchMode: "LIVE_SMS",
    }),
    true,
  );
});

test("package mismatch helper only flags portal-only live SMS", () => {
  assert.match(
    getPackageMessagingMismatch({
      package: "PORTAL_ONLY",
      messagingLaunchMode: "LIVE_SMS",
    }) || "",
    /does not include/,
  );
  assert.equal(
    getPackageMessagingMismatch({
      package: "PORTAL_ONLY",
      messagingLaunchMode: "NO_SMS",
    }),
    null,
  );
  assert.equal(
    getPackageMessagingMismatch({
      package: "MANAGED",
      messagingLaunchMode: "LIVE_SMS",
    }),
    null,
  );
});
