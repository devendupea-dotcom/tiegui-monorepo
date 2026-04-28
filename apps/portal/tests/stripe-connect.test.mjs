import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";
import {
  deriveStripeConnectionStatus,
  resolveStripeRefreshUri,
  resolveStripeRedirectUri,
} from "../lib/integrations/stripe-connect.ts";

function withEnv(overrides, fn) {
  const previous = new Map();

  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("stripe connection status only becomes active when charges and payouts are enabled", () => {
  assert.equal(
    deriveStripeConnectionStatus({
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    }),
    "ACTIVE",
  );

  assert.equal(
    deriveStripeConnectionStatus({
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: true,
    }),
    "RESTRICTED",
  );

  assert.equal(
    deriveStripeConnectionStatus({
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
    }),
    "PENDING",
  );
});

test("stripe connection status respects explicit disconnect state", () => {
  assert.equal(
    deriveStripeConnectionStatus({
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      disconnectedAt: new Date("2026-04-22T00:00:00.000Z"),
    }),
    "DISCONNECTED",
  );
});

test("stripe return url includes the org id for account-link onboarding", () => {
  const redirectUrl = new URL(
    resolveStripeRedirectUri("https://app.example.com", "org_123"),
  );

  assert.equal(
    redirectUrl.origin + redirectUrl.pathname,
    "https://app.example.com/api/integrations/stripe/callback",
  );
  assert.equal(redirectUrl.searchParams.get("orgId"), "org_123");
});

test("stripe redirect uri prefers explicit env overrides", () => {
  withEnv(
    {
      STRIPE_REDIRECT_URI: "https://billing.example.com/stripe/callback",
    },
    () => {
      assert.equal(
        resolveStripeRedirectUri("https://app.example.com", "org_123"),
        "https://billing.example.com/stripe/callback?orgId=org_123",
      );
    },
  );

  withEnv(
    {
      STRIPE_REDIRECT_URI: undefined,
    },
    () => {
      assert.equal(
        resolveStripeRedirectUri("https://app.example.com", "org_123"),
        "https://app.example.com/api/integrations/stripe/callback?orgId=org_123",
      );
    },
  );
});

test("stripe refresh uri sends the user back through the connect route", () => {
  const refreshUrl = new URL(
    resolveStripeRefreshUri("https://app.example.com", "org_123"),
  );

  assert.equal(
    refreshUrl.origin + refreshUrl.pathname,
    "https://app.example.com/api/integrations/stripe/connect",
  );
  assert.equal(refreshUrl.searchParams.get("resume"), "1");
  assert.equal(refreshUrl.searchParams.get("orgId"), "org_123");
});
