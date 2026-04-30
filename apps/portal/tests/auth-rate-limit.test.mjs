import assert from "node:assert/strict";
import test from "node:test";
import {
  ensureAdminVaultUnlockAllowed,
  ensureCredentialLoginAllowed,
  ensureForgotPasswordAllowed,
  getClientIpFromHeaders,
} from "../lib/auth-rate-limit.ts";

test("getClientIpFromHeaders prefers the first forwarded address", () => {
  const ip = getClientIpFromHeaders({
    headers: new Headers({
      "x-forwarded-for": "198.51.100.12, 203.0.113.20",
      "x-real-ip": "192.0.2.8",
    }),
  });

  assert.equal(ip, "198.51.100.12");
});

test("getClientIpFromHeaders falls back to x-real-ip and unknown", () => {
  assert.equal(
    getClientIpFromHeaders({
      headers: new Headers({
        "x-real-ip": "192.0.2.8",
      }),
    }),
    "192.0.2.8",
  );
  assert.equal(getClientIpFromHeaders({ headers: new Headers() }), "unknown");
});

test("ensureCredentialLoginAllowed checks both IP and credential scopes", async () => {
  const calls = [];
  const checker = async (input) => {
    calls.push(input);
    return { ok: true, remaining: 1, resetAtMs: 0 };
  };

  const result = await ensureCredentialLoginAllowed({
    email: "Owner@TieGui.com",
    ip: "198.51.100.12",
    checker,
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [
    {
      identifier: "198.51.100.12",
      prefix: "rl:auth:login:ip",
      limit: 30,
      windowSeconds: 60,
    },
    {
      identifier: "198.51.100.12:owner@tiegui.com",
      prefix: "rl:auth:login:credentials",
      limit: 10,
      windowSeconds: 60,
    },
  ]);
});

test("ensureCredentialLoginAllowed returns the longest retry when blocked", async () => {
  const checker = async (input) =>
    input.prefix === "rl:auth:login:credentials"
      ? { ok: false, remaining: 0, resetAtMs: 0, retryAfterSeconds: 45 }
      : { ok: false, remaining: 0, resetAtMs: 0, retryAfterSeconds: 12 };

  const result = await ensureCredentialLoginAllowed({
    email: "owner@tiegui.com",
    ip: "198.51.100.12",
    checker,
  });

  assert.deepEqual(result, {
    ok: false,
    retryAfterSeconds: 45,
  });
});

test("ensureForgotPasswordAllowed checks both IP and email scopes", async () => {
  const calls = [];
  const checker = async (input) => {
    calls.push(input);
    return { ok: true, remaining: 1, resetAtMs: 0 };
  };

  const result = await ensureForgotPasswordAllowed({
    email: "Client@TieGui.com",
    ip: "203.0.113.22",
    checker,
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [
    {
      identifier: "203.0.113.22",
      prefix: "rl:auth:forgot:ip",
      limit: 10,
      windowSeconds: 60,
    },
    {
      identifier: "client@tiegui.com",
      prefix: "rl:auth:forgot:email",
      limit: 5,
      windowSeconds: 60,
    },
  ]);
});

test("ensureAdminVaultUnlockAllowed checks IP and internal user scopes", async () => {
  const calls = [];
  const checker = async (input) => {
    calls.push(input);
    return { ok: true, remaining: 1, resetAtMs: 0 };
  };

  const result = await ensureAdminVaultUnlockAllowed({
    email: "Admin@TieGui.com",
    ip: "198.51.100.44",
    checker,
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [
    {
      identifier: "198.51.100.44",
      prefix: "rl:admin:vault:unlock:ip",
      limit: 12,
      windowSeconds: 300,
    },
    {
      identifier: "admin@tiegui.com",
      prefix: "rl:admin:vault:unlock:email",
      limit: 6,
      windowSeconds: 300,
    },
  ]);
});
