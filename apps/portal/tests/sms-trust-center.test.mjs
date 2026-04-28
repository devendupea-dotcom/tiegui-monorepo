import assert from "node:assert/strict";
import test from "node:test";
import { evaluateSmsTrustOrg } from "../lib/sms-trust-center.ts";

function buildInput(overrides = {}) {
  return {
    readinessCode: "ACTIVE",
    canSendLive: true,
    hasTwilioConfig: true,
    sendEnabled: true,
    tokenEncryptionKeyPresent: true,
    webhookValidationMode: "validate",
    automationHealthStatus: "HEALTHY",
    automationIssues: [],
    automationsEnabled: {
      autoReply: true,
      followUps: true,
      autoBooking: false,
      missedCallTextBack: true,
      ghostBuster: false,
      dispatchUpdates: false,
    },
    reviewQueueCount: 0,
    dueQueueCount: 0,
    failedLast24hCount: 0,
    unmatchedCallbacks30dCount: 0,
    ...overrides,
  };
}

test("SMS trust center marks clean live automation as autopilot-ready", () => {
  const result = evaluateSmsTrustOrg(buildInput());

  assert.equal(result.mode, "AUTOPILOT");
  assert.equal(result.verdict, "READY");
  assert.equal(result.safeToAutomate, true);
  assert.equal(result.blockers.length, 0);
  assert.equal(result.activeAutomationCount, 3);
});

test("SMS trust center blocks automation when Twilio is not live", () => {
  const result = evaluateSmsTrustOrg(
    buildInput({
      readinessCode: "PENDING_A2P",
      canSendLive: false,
    }),
  );

  assert.equal(result.mode, "DRAFT_ONLY");
  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.safeToAutomate, false);
  assert.ok(result.blockers.some((blocker) => blocker.code === "TWILIO_NOT_LIVE"));
});

test("SMS trust center treats owner review and failures as assisted mode", () => {
  const result = evaluateSmsTrustOrg(
    buildInput({
      reviewQueueCount: 2,
      failedLast24hCount: 1,
    }),
  );

  assert.equal(result.mode, "ASSISTED");
  assert.equal(result.verdict, "ATTENTION");
  assert.equal(result.safeToAutomate, false);
  assert.ok(result.blockers.some((blocker) => blocker.code === "OWNER_REVIEW_QUEUE"));
  assert.ok(result.blockers.some((blocker) => blocker.code === "RECENT_FAILURES"));
});

test("SMS trust center requires webhook signature validation", () => {
  const result = evaluateSmsTrustOrg(
    buildInput({
      webhookValidationMode: "reject",
    }),
  );

  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.safeToAutomate, false);
  assert.ok(result.blockers.some((blocker) => blocker.code === "SIGNATURE_VALIDATION_OFF"));
});
