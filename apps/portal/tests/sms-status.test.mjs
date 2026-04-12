import assert from "node:assert/strict";
import test from "node:test";
import { mapTwilioLifecycleStatus, shouldAdvanceOutboundSmsLifecycle } from "../lib/sms-lifecycle.ts";

test("mapTwilioLifecycleStatus normalizes Twilio outbound callback statuses", () => {
  assert.equal(mapTwilioLifecycleStatus("accepted"), "QUEUED");
  assert.equal(mapTwilioLifecycleStatus("queued"), "QUEUED");
  assert.equal(mapTwilioLifecycleStatus("sending"), "QUEUED");
  assert.equal(mapTwilioLifecycleStatus("sent"), "SENT");
  assert.equal(mapTwilioLifecycleStatus("delivered"), "DELIVERED");
  assert.equal(mapTwilioLifecycleStatus("read"), "DELIVERED");
  assert.equal(mapTwilioLifecycleStatus("undelivered"), "FAILED");
  assert.equal(mapTwilioLifecycleStatus("failed"), "FAILED");
  assert.equal(mapTwilioLifecycleStatus("mystery"), null);
});

test("shouldAdvanceOutboundSmsLifecycle prevents weaker or conflicting regressions", () => {
  assert.equal(shouldAdvanceOutboundSmsLifecycle(null, "QUEUED"), true);
  assert.equal(shouldAdvanceOutboundSmsLifecycle("QUEUED", "SENT"), true);
  assert.equal(shouldAdvanceOutboundSmsLifecycle("QUEUED", "FAILED"), true);
  assert.equal(shouldAdvanceOutboundSmsLifecycle("SENT", "DELIVERED"), true);
  assert.equal(shouldAdvanceOutboundSmsLifecycle("SENT", "FAILED"), true);
  assert.equal(shouldAdvanceOutboundSmsLifecycle("SENT", "QUEUED"), false);
  assert.equal(shouldAdvanceOutboundSmsLifecycle("DELIVERED", "SENT"), false);
  assert.equal(shouldAdvanceOutboundSmsLifecycle("FAILED", "DELIVERED"), false);
  assert.equal(shouldAdvanceOutboundSmsLifecycle("FAILED", "FAILED"), true);
});
