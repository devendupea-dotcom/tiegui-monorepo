import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import process from "node:process";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const portalRoot = new URL("..", import.meta.url);

const baseEnv = {
  DATABASE_URL: "postgresql://user:pass@example.com:5432/tiegui",
  NEXTAUTH_URL: "https://app.tieguisolutions.com",
  NEXTAUTH_SECRET: "test-nextauth-secret",
  SMTP_URL: "smtp://user:pass@example.com:587",
  EMAIL_FROM: "ops@example.com",
  CRON_SECRET: "test-cron-secret",
  UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "test-upstash-token",
  STRIPE_SECRET_KEY: "sk_test_123",
  STRIPE_CONNECT_CLIENT_ID: "ca_test_123",
  STRIPE_WEBHOOK_SECRET: "whsec_test_123",
  TWILIO_TOKEN_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  TWILIO_SEND_ENABLED: "true",
  TWILIO_VALIDATE_SIGNATURE: "true",
};

async function runPreflight(overrides = {}) {
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    PRISMA_ENV_FILE: "/dev/null",
    ...baseEnv,
    ...overrides,
  };

  try {
    const result = await execFileAsync(
      process.execPath,
      ["--import", "tsx", "scripts/check-release-env.ts"],
      {
        cwd: portalRoot,
        env,
      },
    );
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      code: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout || "",
      stderr: error.stderr || "",
    };
  }
}

test("release env preflight passes for a customer-live env shape", async () => {
  const result = await runPreflight();

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Release env preflight: ready/);
  assert.match(result.stdout, /Required failures: 0/);
});

test("release env preflight blocks queue-only or unsigned Twilio modes", async () => {
  const result = await runPreflight({
    TWILIO_SEND_ENABLED: "false",
    TWILIO_VALIDATE_SIGNATURE: "false",
  });

  assert.equal(result.code, 1);
  assert.match(result.stdout, /FAIL Twilio send mode/);
  assert.match(result.stdout, /FAIL Twilio webhook signature validation/);
  assert.match(result.stdout, /Release env preflight: blocked/);
});

test("release env preflight blocks missing rate-limit backend", async () => {
  const result = await runPreflight({
    UPSTASH_REDIS_REST_URL: "",
    UPSTASH_REDIS_REST_TOKEN: "",
  });

  assert.equal(result.code, 1);
  assert.match(result.stdout, /FAIL Rate limit backend/);
  assert.match(result.stdout, /Release env preflight: blocked/);
});

test("release env preflight accepts Vercel KV rate-limit backend env names", async () => {
  const result = await runPreflight({
    UPSTASH_REDIS_REST_URL: "",
    UPSTASH_REDIS_REST_TOKEN: "",
    KV_REST_API_URL: "https://example.upstash.io",
    KV_REST_API_TOKEN: "test-kv-token",
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /PASS Rate limit backend/);
  assert.ok(result.stdout.includes("Using KV_REST_API_URL/KV_REST_API_TOKEN"));
});

test("release env preflight blocks partial rate-limit backend env pairs", async () => {
  const result = await runPreflight({
    UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "",
  });

  assert.equal(result.code, 1);
  assert.match(result.stdout, /FAIL Rate limit backend/);
  assert.ok(result.stdout.includes("Incomplete env pair: UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN"));
});

test("release env preflight blocks malformed Stripe and Twilio secrets", async () => {
  const result = await runPreflight({
    STRIPE_SECRET_KEY: "not-a-stripe-secret",
    STRIPE_CONNECT_CLIENT_ID: "not-a-connect-client-id",
    STRIPE_WEBHOOK_SECRET: "not-a-webhook-secret",
    TWILIO_TOKEN_ENCRYPTION_KEY: "too-short",
  });

  assert.equal(result.code, 1);
  assert.match(result.stdout, /FAIL Stripe secret shape/);
  assert.match(result.stdout, /FAIL Stripe Connect client id shape/);
  assert.match(result.stdout, /FAIL Stripe webhook secret shape/);
  assert.match(result.stdout, /FAIL Twilio token encryption key shape/);
});
