import assert from "node:assert/strict";
import test from "node:test";
import {
  getBearerToken,
  getCronSecretFromRequest,
  isValidCronSecret,
} from "../lib/cron-auth.ts";

test("getBearerToken extracts bearer credentials case-insensitively", () => {
  assert.equal(getBearerToken("Bearer secret-token"), "secret-token");
  assert.equal(getBearerToken("bearer secret-token"), "secret-token");
  assert.equal(getBearerToken("Basic secret-token"), null);
});

test("getCronSecretFromRequest prefers x-cron-secret over authorization", () => {
  const req = new Request("https://example.com/api/cron/intake", {
    headers: {
      "x-cron-secret": "header-secret",
      authorization: "Bearer bearer-secret",
    },
  });

  assert.equal(getCronSecretFromRequest(req), "header-secret");
});

test("getCronSecretFromRequest falls back to bearer authorization", () => {
  const req = new Request("https://example.com/api/cron/intake", {
    headers: {
      authorization: "Bearer bearer-secret",
    },
  });

  assert.equal(getCronSecretFromRequest(req), "bearer-secret");
});

test("isValidCronSecret compares normalized configured values", () => {
  const req = new Request("https://example.com/api/cron/intake", {
    headers: {
      authorization: "Bearer shared-secret",
    },
  });

  assert.equal(isValidCronSecret(req, "  shared-secret  "), true);
  assert.equal(isValidCronSecret(req, "different-secret"), false);
  assert.equal(isValidCronSecret(req, undefined), false);
});
