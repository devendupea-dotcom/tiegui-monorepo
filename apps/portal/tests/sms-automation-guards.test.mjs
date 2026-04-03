import assert from "node:assert/strict";
import test from "node:test";
import {
  getQueuedSmsSkipReason,
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
