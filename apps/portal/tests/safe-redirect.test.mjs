import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeRedirectPath, sanitizeSameOriginRedirectUrl } from "../lib/safe-redirect.ts";

test("sanitizeRedirectPath keeps internal paths with query and hash", () => {
  assert.equal(
    sanitizeRedirectPath("/app/jobs?orgId=org_123#details"),
    "/app/jobs?orgId=org_123#details",
  );
});

test("sanitizeRedirectPath rejects external and protocol-relative URLs", () => {
  assert.equal(sanitizeRedirectPath("https://evil.example/app", "/admin"), "/admin");
  assert.equal(sanitizeRedirectPath("//evil.example/app", "/admin"), "/admin");
});

test("sanitizeRedirectPath rejects malformed slash paths", () => {
  assert.equal(sanitizeRedirectPath("app/jobs", "/app"), "/app");
  assert.equal(sanitizeRedirectPath("/\\evil.example", "/app"), "/app");
  assert.equal(sanitizeRedirectPath("/app\n/jobs", "/app"), "/app");
});

test("sanitizeRedirectPath falls back to root when fallback is unsafe", () => {
  assert.equal(sanitizeRedirectPath("https://evil.example", "https://other.example"), "/");
});

test("sanitizeSameOriginRedirectUrl accepts same-origin absolute URLs", () => {
  assert.equal(
    sanitizeSameOriginRedirectUrl("https://app.example.com/app?x=1", "https://app.example.com", "/"),
    "/app?x=1",
  );
});

test("sanitizeSameOriginRedirectUrl rejects cross-origin absolute URLs", () => {
  assert.equal(
    sanitizeSameOriginRedirectUrl("https://evil.example/app", "https://app.example.com", "/dashboard"),
    "/dashboard",
  );
});
