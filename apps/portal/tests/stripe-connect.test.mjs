import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";
import {
  buildStripeAuthorizeUrl,
  deriveStripeConnectionStatus,
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

test("stripe authorize url includes the expected standard connect parameters", () => {
  withEnv(
    {
      STRIPE_CONNECT_CLIENT_ID: "ca_test_123",
    },
    () => {
      const authorizeUrl = new URL(
        buildStripeAuthorizeUrl({
          state: "state_123",
          redirectUri: "https://app.example.com/api/integrations/stripe/callback",
        }),
      );

      assert.equal(authorizeUrl.origin + authorizeUrl.pathname, "https://connect.stripe.com/oauth/authorize");
      assert.equal(authorizeUrl.searchParams.get("client_id"), "ca_test_123");
      assert.equal(authorizeUrl.searchParams.get("response_type"), "code");
      assert.equal(authorizeUrl.searchParams.get("scope"), "read_write");
      assert.equal(authorizeUrl.searchParams.get("state"), "state_123");
      assert.equal(
        authorizeUrl.searchParams.get("redirect_uri"),
        "https://app.example.com/api/integrations/stripe/callback",
      );
    },
  );
});

test("stripe redirect uri prefers explicit env overrides", () => {
  withEnv(
    {
      STRIPE_REDIRECT_URI: "https://billing.example.com/stripe/callback",
    },
    () => {
      assert.equal(
        resolveStripeRedirectUri("https://app.example.com"),
        "https://billing.example.com/stripe/callback",
      );
    },
  );

  withEnv(
    {
      STRIPE_REDIRECT_URI: undefined,
    },
    () => {
      assert.equal(
        resolveStripeRedirectUri("https://app.example.com"),
        "https://app.example.com/api/integrations/stripe/callback",
      );
    },
  );
});
