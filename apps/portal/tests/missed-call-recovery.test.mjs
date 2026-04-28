import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMissedCallRecoveryKey,
  createMissedCallRecoveryRunner,
  evaluateMissedCallTextEligibility,
} from "../lib/missed-call-recovery-core.ts";

test("evaluateMissedCallTextEligibility never sends for answered calls", () => {
  const decision = evaluateMissedCallTextEligibility({
    missedCallAutoReplyOn: true,
    leadStatus: "NEW",
    fromNumberE164: "+15550001111",
    senderNumberE164: "+15550002222",
    hasAnsweredEvent: true,
    hasRecentOutbound: false,
    withinBusinessHours: true,
    sendAfterAt: null,
  });

  assert.deepEqual(decision, {
    action: "skip",
    reason: "answered",
    withinBusinessHours: true,
  });
});

test("evaluateMissedCallTextEligibility queues instead of sending during quiet hours", () => {
  const sendAfterAt = new Date("2025-03-20T15:00:00.000Z");
  const decision = evaluateMissedCallTextEligibility({
    missedCallAutoReplyOn: true,
    leadStatus: "NEW",
    fromNumberE164: "+15550001111",
    senderNumberE164: "+15550002222",
    hasAnsweredEvent: false,
    hasRecentOutbound: false,
    withinBusinessHours: false,
    sendAfterAt,
  });

  assert.deepEqual(decision, {
    action: "queue",
    reason: "quiet_hours",
    withinBusinessHours: false,
    sendAfterAt,
  });
});

test("evaluateMissedCallTextEligibility blocks explicit SMS opt-out", () => {
  const decision = evaluateMissedCallTextEligibility({
    missedCallAutoReplyOn: true,
    leadStatus: "FOLLOW_UP",
    smsConsentStatus: "OPTED_OUT",
    fromNumberE164: "+15550001111",
    senderNumberE164: "+15550002222",
    hasAnsweredEvent: false,
    hasRecentOutbound: false,
    withinBusinessHours: true,
    sendAfterAt: null,
  });

  assert.deepEqual(decision, {
    action: "skip",
    reason: "dnc",
    withinBusinessHours: true,
  });
});

test("evaluateMissedCallTextEligibility lets explicit opt-in override legacy DNC fallback", () => {
  const decision = evaluateMissedCallTextEligibility({
    missedCallAutoReplyOn: true,
    leadStatus: "DNC",
    smsConsentStatus: "OPTED_IN",
    fromNumberE164: "+15550001111",
    senderNumberE164: "+15550002222",
    hasAnsweredEvent: false,
    hasRecentOutbound: false,
    withinBusinessHours: true,
    sendAfterAt: null,
  });

  assert.deepEqual(decision, {
    action: "send",
    reason: "eligible",
    withinBusinessHours: true,
  });
});

test("createMissedCallRecoveryRunner prevents duplicate sends across realtime and cron", async () => {
  const storedDecisions = new Map();
  let dispatchCount = 0;

  const runner = createMissedCallRecoveryRunner({
    async reserveDecision(candidate) {
      const key = buildMissedCallRecoveryKey(candidate);
      const existing = storedDecisions.get(key);
      if (existing) {
        return {
          alreadyProcessed: true,
          decisionKey: key,
          decision: existing,
        };
      }

      const decision = {
        action: "send",
        reason: "eligible",
        withinBusinessHours: true,
      };
      storedDecisions.set(key, decision);
      return {
        alreadyProcessed: false,
        decisionKey: key,
        decision,
      };
    },
    async dispatchDecision(_candidate, reserved) {
      dispatchCount += 1;
      return reserved.decision;
    },
  });

  const baseCandidate = {
    orgId: "org_1",
    leadId: "lead_1",
    callId: "call_1",
    callSid: "CA123",
    fromNumberE164: "+15550001111",
    occurredAt: new Date("2025-03-20T14:15:00.000Z"),
  };

  const realtimeDecision = await runner({
    ...baseCandidate,
    source: "realtime",
  });
  const cronDecision = await runner({
    ...baseCandidate,
    source: "cron",
  });

  assert.equal(dispatchCount, 1);
  assert.deepEqual(realtimeDecision, {
    action: "send",
    reason: "eligible",
    withinBusinessHours: true,
  });
  assert.deepEqual(cronDecision, realtimeDecision);
});
