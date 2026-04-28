import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateCommunicationStatusCounts,
  normalizeCommunicationProviderStatus,
} from "../lib/communication-diagnostics.ts";

test("normalizeCommunicationProviderStatus canonicalizes status casing", () => {
  assert.equal(normalizeCommunicationProviderStatus("ringing"), "RINGING");
  assert.equal(normalizeCommunicationProviderStatus(" Delivered "), "DELIVERED");
  assert.equal(normalizeCommunicationProviderStatus(""), null);
});

test("aggregateCommunicationStatusCounts merges duplicate statuses with different casing", () => {
  const rows = aggregateCommunicationStatusCounts([
    { type: "INBOUND_CALL_RECEIVED", providerStatus: "RINGING", count: 2 },
    { type: "INBOUND_CALL_RECEIVED", providerStatus: "ringing", count: 3 },
    { type: "OUTBOUND_SMS_SENT", providerStatus: "FAILED", count: 1 },
  ]);

  assert.deepEqual(rows, [
    { type: "INBOUND_CALL_RECEIVED", providerStatus: "RINGING", count: 5 },
    { type: "OUTBOUND_SMS_SENT", providerStatus: "FAILED", count: 1 },
  ]);
});
