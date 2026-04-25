import assert from "node:assert/strict";
import test from "node:test";
import {
  canComposeManualSms,
  getTwilioMessagingComposeNotice,
} from "../lib/twilio-readiness.ts";

test("manual compose stays enabled for live send and queue-only deployment mode", () => {
  assert.equal(canComposeManualSms("ACTIVE"), true);
  assert.equal(canComposeManualSms("SEND_DISABLED"), true);
});

test("manual compose stays blocked when Twilio is not actually ready", () => {
  assert.equal(canComposeManualSms("NOT_CONFIGURED"), false);
  assert.equal(canComposeManualSms("TOKEN_KEY_MISSING"), false);
  assert.equal(canComposeManualSms("PENDING_A2P"), false);
  assert.equal(canComposeManualSms("PAUSED"), false);
});

test("manual compose notices explain queued deployment mode and blocked states", () => {
  assert.match(
    getTwilioMessagingComposeNotice("SEND_DISABLED") || "",
    /saved as queued/i,
  );
  assert.match(
    getTwilioMessagingComposeNotice("PENDING_A2P") || "",
    /registration is still pending/i,
  );
  assert.equal(getTwilioMessagingComposeNotice("ACTIVE"), null);
});
