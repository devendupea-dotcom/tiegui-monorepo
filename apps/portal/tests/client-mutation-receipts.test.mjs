import assert from "node:assert/strict";
import test from "node:test";
import {
  buildScopedClientMutationIdempotencyKey,
  normalizeClientMutationIdempotencyKey,
} from "../lib/client-mutation-receipts.ts";

test("normalizeClientMutationIdempotencyKey trims valid retry keys", () => {
  assert.equal(
    normalizeClientMutationIdempotencyKey(" 9b7d4b2d-31f7-4b18-a8ea-3ca95f5e9283 "),
    "9b7d4b2d-31f7-4b18-a8ea-3ca95f5e9283",
  );
});

test("normalizeClientMutationIdempotencyKey rejects blank, unsafe, and oversized values", () => {
  assert.equal(normalizeClientMutationIdempotencyKey(""), null);
  assert.equal(normalizeClientMutationIdempotencyKey("bad key with spaces"), null);
  assert.equal(normalizeClientMutationIdempotencyKey("x".repeat(161)), null);
});

test("buildScopedClientMutationIdempotencyKey namespaces per mutation type", () => {
  assert.equal(
    buildScopedClientMutationIdempotencyKey("invoice-send", "retry-key-1"),
    "invoice-send:retry-key-1",
  );
});
