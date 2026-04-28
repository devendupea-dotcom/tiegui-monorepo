import assert from "node:assert/strict";
import test from "node:test";
import { derivePotentialSpamSignals } from "../lib/lead-spam.ts";
import { shouldRouteLeadToSpamReview } from "../lib/lead-spam-lane.ts";

test("derivePotentialSpamSignals flags blocked callers immediately", () => {
  assert.deepEqual(
    derivePotentialSpamSignals({
      isBlockedCaller: true,
      failedOutboundCount: 0,
    }),
    ["blocked_caller"],
  );
});

test("derivePotentialSpamSignals flags high-risk inbound voice traffic", () => {
  assert.deepEqual(
    derivePotentialSpamSignals({
      isBlockedCaller: false,
      latestVoiceRiskDisposition: "VOICEMAIL_ONLY",
      latestVoiceRiskScore: 82,
      failedOutboundCount: 0,
    }),
    ["high_risk_inbound_call"],
  );
});

test("derivePotentialSpamSignals flags repeated failed outbound SMS", () => {
  assert.deepEqual(
    derivePotentialSpamSignals({
      isBlockedCaller: false,
      failedOutboundCount: 2,
    }),
    ["repeated_failed_outbound_sms"],
  );
});

test("derivePotentialSpamSignals does not flag a single failed SMS by itself", () => {
  assert.deepEqual(
    derivePotentialSpamSignals({
      isBlockedCaller: false,
      failedOutboundCount: 1,
    }),
    [],
  );
});

test("shouldRouteLeadToSpamReview treats failed outbound SMS as review-worthy", () => {
  assert.equal(
    shouldRouteLeadToSpamReview({
      potentialSpam: false,
      failedOutboundCount: 1,
    }),
    true,
  );
  assert.equal(
    shouldRouteLeadToSpamReview({
      potentialSpamSignals: [],
      failedOutboundCount: 0,
    }),
    false,
  );
});
