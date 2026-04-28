import assert from "node:assert/strict";
import test from "node:test";
import {
  getRateLimitBackendEnv,
  isRateLimitBackendConfiguredFromEnv,
  resolveMissingRateLimitBackendDecision,
  shouldRequireRateLimitBackend,
} from "../lib/rate-limit-config.ts";

test("rate-limit backend config requires both Upstash values", () => {
  assert.equal(
    isRateLimitBackendConfiguredFromEnv({
      UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "token",
    }),
    true,
  );
  assert.equal(
    isRateLimitBackendConfiguredFromEnv({
      UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "",
    }),
    false,
  );
});

test("rate-limit backend config accepts Vercel KV REST env names", () => {
  const env = {
    KV_REST_API_URL: "https://example.upstash.io",
    KV_REST_API_TOKEN: "token",
  };

  assert.equal(isRateLimitBackendConfiguredFromEnv(env), true);
  assert.deepEqual(getRateLimitBackendEnv(env), {
    url: "https://example.upstash.io",
    token: "token",
    source: "vercel-kv",
  });
});

test("rate-limit backend config rejects partial env pairs", () => {
  assert.deepEqual(
    getRateLimitBackendEnv({
      UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "",
    }),
    {
      url: "",
      token: "",
      source: null,
      error: "Incomplete rate-limit backend env pair: UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN.",
    },
  );
  assert.equal(
    isRateLimitBackendConfiguredFromEnv({
      KV_REST_API_URL: "",
      KV_REST_API_TOKEN: "token",
    }),
    false,
  );
});

test("rate-limit backend config prefers raw Upstash env names when both are present", () => {
  assert.deepEqual(
    getRateLimitBackendEnv({
      UPSTASH_REDIS_REST_URL: "https://upstash.example",
      UPSTASH_REDIS_REST_TOKEN: "upstash-token",
      KV_REST_API_URL: "https://kv.example",
      KV_REST_API_TOKEN: "kv-token",
    }),
    {
      url: "https://upstash.example",
      token: "upstash-token",
      source: "upstash",
    },
  );
});

test("production requires a real rate-limit backend", () => {
  const env = {
    NODE_ENV: "production",
    UPSTASH_REDIS_REST_URL: "",
    UPSTASH_REDIS_REST_TOKEN: "",
  };

  assert.equal(shouldRequireRateLimitBackend(env), true);
  assert.deepEqual(resolveMissingRateLimitBackendDecision(env), {
    ok: false,
    retryAfterSeconds: 60,
  });
});

test("development can run without Upstash unless explicitly required", () => {
  assert.equal(
    shouldRequireRateLimitBackend({
      NODE_ENV: "development",
      RATE_LIMIT_REQUIRE_BACKEND: "",
    }),
    false,
  );
  assert.deepEqual(
    resolveMissingRateLimitBackendDecision({
      NODE_ENV: "development",
      RATE_LIMIT_REQUIRE_BACKEND: "",
    }),
    { ok: true },
  );
  assert.equal(
    shouldRequireRateLimitBackend({
      NODE_ENV: "development",
      RATE_LIMIT_REQUIRE_BACKEND: "true",
    }),
    true,
  );
});
