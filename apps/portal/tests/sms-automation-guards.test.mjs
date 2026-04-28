import assert from "node:assert/strict";
import test from "node:test";
import {
  getAutomatedFollowUpThrottleUntil,
  getQueuedSmsSkipReason,
  getRecentHardSmsFailureForAutomation,
  shouldSkipQueuedFollowUp,
  shouldSuppressMissedCallKickoff,
} from "../lib/sms-automation-guards.ts";

test("getQueuedSmsSkipReason blocks stale automation after a newer inbound reply", () => {
  const reason = getQueuedSmsSkipReason({
    jobCreatedAt: new Date("2025-01-01T12:00:00.000Z"),
    leadStatus: "FOLLOW_UP",
    leadLastInboundAt: new Date("2025-01-01T12:03:00.000Z"),
    messageType: "AUTOMATION",
    conversationState: null,
    now: new Date("2025-01-01T12:05:00.000Z"),
  });

  assert.match(reason || "", /newer inbound reply/i);
});

test("getQueuedSmsSkipReason blocks automation during human takeover", () => {
  const reason = getQueuedSmsSkipReason({
    jobCreatedAt: new Date("2025-01-01T12:00:00.000Z"),
    leadStatus: "FOLLOW_UP",
    leadLastInboundAt: null,
    messageType: "SYSTEM_NUDGE",
    conversationState: {
      stage: "HUMAN_TAKEOVER",
      pausedUntil: new Date("2025-01-01T13:00:00.000Z"),
      stoppedAt: null,
    },
    now: new Date("2025-01-01T12:05:00.000Z"),
  });

  assert.match(reason || "", /human follow-up|human_takeover/i);
});

test("getQueuedSmsSkipReason blocks automation after a hard SMS failure", () => {
  const reason = getQueuedSmsSkipReason({
    jobCreatedAt: new Date("2025-01-01T12:00:00.000Z"),
    leadStatus: "FOLLOW_UP",
    leadLastInboundAt: null,
    messageType: "AUTOMATION",
    recentHardSmsFailure: {
      occurredAt: new Date("2025-01-01T12:01:00.000Z"),
      category: "BAD_NUMBER",
      label: "Bad or unsupported phone number",
      operatorActionLabel: "Fix phone number",
      operatorDetail: "Verify the customer phone number before any SMS retry.",
    },
    conversationState: null,
    now: new Date("2025-01-01T12:05:00.000Z"),
  });

  assert.match(reason || "", /hard sms failure/i);
  assert.match(reason || "", /fix phone number/i);
});

test("getQueuedSmsSkipReason lets manual SMS override hard failure guardrails", () => {
  const reason = getQueuedSmsSkipReason({
    jobCreatedAt: new Date("2025-01-01T12:00:00.000Z"),
    leadStatus: "FOLLOW_UP",
    leadLastInboundAt: null,
    messageType: "MANUAL",
    recentHardSmsFailure: {
      occurredAt: new Date("2025-01-01T12:01:00.000Z"),
      category: "BAD_NUMBER",
      label: "Bad or unsupported phone number",
      operatorActionLabel: "Fix phone number",
      operatorDetail: "Verify the customer phone number before any SMS retry.",
    },
    conversationState: null,
    now: new Date("2025-01-01T12:05:00.000Z"),
  });

  assert.equal(reason, null);
});

test("getRecentHardSmsFailureForAutomation reads failure intelligence metadata", () => {
  const failure = getRecentHardSmsFailureForAutomation([
    {
      occurredAt: new Date("2025-01-01T12:01:00.000Z"),
      providerStatus: "undelivered",
      metadataJson: {
        providerStatus: "undelivered",
        status: "FAILED",
        failureCategory: "CARRIER_FILTERING",
        failureLabel: "Carrier filtering",
        failureOperatorActionLabel: "Rewrite message",
        failureOperatorDetail: "Rewrite the SMS shorter and less promotional, then retry once.",
        failureBlocksAutomationRetry: true,
      },
    },
  ]);

  assert.deepEqual(failure, {
    occurredAt: new Date("2025-01-01T12:01:00.000Z"),
    category: "CARRIER_FILTERING",
    label: "Carrier filtering",
    operatorActionLabel: "Rewrite message",
    operatorDetail: "Rewrite the SMS shorter and less promotional, then retry once.",
  });
});

test("getRecentHardSmsFailureForAutomation clears old failures after a newer delivery", () => {
  const failure = getRecentHardSmsFailureForAutomation([
    {
      occurredAt: new Date("2025-01-01T12:04:00.000Z"),
      providerStatus: "delivered",
      metadataJson: {
        providerStatus: "delivered",
        status: "DELIVERED",
      },
    },
    {
      occurredAt: new Date("2025-01-01T12:01:00.000Z"),
      providerStatus: "undelivered",
      metadataJson: {
        failureLabel: "Bad or unsupported phone number",
        failureBlocksAutomationRetry: true,
      },
    },
  ]);

  assert.equal(failure, null);
});

test("shouldSuppressMissedCallKickoff keeps an active conversation from rewinding", () => {
  const suppressed = shouldSuppressMissedCallKickoff({
    state: {
      stage: "ASKED_TIMEFRAME",
      workSummary: "front yard cleanup",
      addressCity: "Tacoma",
      timeframe: null,
      lastInboundAt: new Date("2025-01-01T12:01:00.000Z"),
      lastOutboundAt: new Date("2025-01-01T12:02:00.000Z"),
      nextFollowUpAt: new Date("2025-01-01T12:15:00.000Z"),
      pausedUntil: null,
      stoppedAt: null,
    },
    now: new Date("2025-01-01T12:05:00.000Z"),
  });

  assert.equal(suppressed, true);
});

test("shouldSuppressMissedCallKickoff allows a stale empty conversation to restart", () => {
  const suppressed = shouldSuppressMissedCallKickoff({
    state: {
      stage: "ASKED_WORK",
      workSummary: null,
      addressText: null,
      addressCity: null,
      timeframe: null,
      lastInboundAt: null,
      lastOutboundAt: new Date("2025-01-01T11:00:00.000Z"),
      nextFollowUpAt: null,
      pausedUntil: null,
      stoppedAt: null,
    },
    now: new Date("2025-01-01T12:05:00.000Z"),
  });

  assert.equal(suppressed, false);
});

test("shouldSkipQueuedFollowUp blocks outdated follow-ups after a newer reply", () => {
  const skipped = shouldSkipQueuedFollowUp({
    loaded: {
      stage: "ASKED_ADDRESS",
      followUpStep: 0,
      lastInboundAt: new Date("2025-01-01T12:00:00.000Z"),
    },
    current: {
      stage: "ASKED_ADDRESS",
      followUpStep: 0,
      lastInboundAt: new Date("2025-01-01T12:02:00.000Z"),
      pausedUntil: null,
      stoppedAt: null,
    },
    now: new Date("2025-01-01T12:05:00.000Z"),
  });

  assert.equal(skipped, true);
});

test("shouldSkipQueuedFollowUp keeps eligible follow-ups active", () => {
  const skipped = shouldSkipQueuedFollowUp({
    loaded: {
      stage: "ASKED_ADDRESS",
      followUpStep: 1,
      lastInboundAt: new Date("2025-01-01T12:00:00.000Z"),
    },
    current: {
      stage: "ASKED_ADDRESS",
      followUpStep: 1,
      lastInboundAt: new Date("2025-01-01T12:00:00.000Z"),
      pausedUntil: null,
      stoppedAt: null,
    },
    now: new Date("2025-01-01T12:05:00.000Z"),
  });

  assert.equal(skipped, false);
});

test("getAutomatedFollowUpThrottleUntil pushes follow-ups out when an automation just sent", () => {
  const throttledUntil = getAutomatedFollowUpThrottleUntil({
    lastOutboundAt: new Date("2025-01-01T12:00:00.000Z"),
    now: new Date("2025-01-01T12:30:00.000Z"),
  });

  assert.equal(throttledUntil?.toISOString(), "2025-01-01T13:30:00.000Z");
});

test("getAutomatedFollowUpThrottleUntil returns null once the cool-down passed", () => {
  const throttledUntil = getAutomatedFollowUpThrottleUntil({
    lastOutboundAt: new Date("2025-01-01T10:00:00.000Z"),
    now: new Date("2025-01-01T12:00:00.000Z"),
  });

  assert.equal(throttledUntil, null);
});
