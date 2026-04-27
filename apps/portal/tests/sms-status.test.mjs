import assert from "node:assert/strict";
import test from "node:test";
import {
  mapTwilioInitialSendStatus,
  mapTwilioLifecycleStatus,
  shouldAdvanceOutboundSmsLifecycle,
} from "../lib/sms-lifecycle.ts";
import { classifySmsFailure } from "../lib/sms-failure-intelligence.ts";
import { buildUnmatchedSmsStatusCallbackEvent } from "../lib/sms-status-diagnostics.ts";

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

test("mapTwilioInitialSendStatus never overstates provider acceptance as sent", () => {
  assert.equal(mapTwilioInitialSendStatus("accepted"), "QUEUED");
  assert.equal(mapTwilioInitialSendStatus("queued"), "QUEUED");
  assert.equal(mapTwilioInitialSendStatus(null), "QUEUED");
  assert.equal(mapTwilioInitialSendStatus("sent"), "SENT");
  assert.equal(mapTwilioInitialSendStatus("delivered"), "DELIVERED");
  assert.equal(mapTwilioInitialSendStatus("failed"), "FAILED");
});

test("unmatched SMS status callback diagnostics preserve provider context", () => {
  const diagnostic = buildUnmatchedSmsStatusCallbackEvent({
    orgId: "org_1",
    providerMessageSid: "SM123",
    providerStatus: "undelivered",
    lifecycleStatus: "FAILED",
    errorCode: "30007",
    errorMessage: "Carrier filtering detected.",
    occurredAt: new Date("2026-04-23T18:30:00.000Z"),
  });

  assert.equal(diagnostic.summary, "Unmatched outbound SMS status callback");
  assert.match(diagnostic.idempotencyKey, /^sms-status-unmatched:/);
  assert.deepEqual(diagnostic.metadataJson, {
    unmatchedStatusCallback: true,
    providerMessageSid: "SM123",
    providerStatus: "undelivered",
    status: "FAILED",
    providerStatusUpdatedAt: "2026-04-23T18:30:00.000Z",
    providerErrorCode: "30007",
    providerErrorMessage: "Carrier filtering detected.",
    failureCategory: "CARRIER_FILTERING",
    failureLabel: "Carrier filtering",
    failureOperatorAction: "REWRITE_MESSAGE",
    failureOperatorActionLabel: "Rewrite message",
    failureOperatorDetail: "Rewrite the SMS shorter and less promotional, then retry once. Call if the update is urgent.",
    failureRetryRecommended: true,
    failureBlocksAutomationRetry: true,
    failureReason: "Carrier filtering detected.",
  });
});

test("classifySmsFailure turns common Twilio failures into operator actions", () => {
  assert.deepEqual(
    classifySmsFailure({
      lifecycleStatus: "FAILED",
      providerStatus: "undelivered",
      errorCode: "30003",
      errorMessage: "Unreachable destination handset.",
    }),
    {
      category: "LANDLINE_OR_UNREACHABLE",
      label: "Unreachable or non-mobile number",
      operatorAction: "CALL_CUSTOMER",
      operatorActionLabel: "Call customer",
      operatorDetail: "SMS is unlikely to work until the customer provides a reachable mobile number.",
      retryRecommended: false,
      blocksAutomationRetry: true,
    },
  );

  assert.equal(
    classifySmsFailure({
      lifecycleStatus: "FAILED",
      providerStatus: "failed",
      errorCode: "21610",
      errorMessage: "User has replied STOP.",
    })?.operatorAction,
    "DO_NOT_RETRY_SMS",
  );

  assert.equal(
    classifySmsFailure({
      lifecycleStatus: "FAILED",
      providerStatus: "failed",
      errorCode: "20429",
      errorMessage: "Too many requests.",
    })?.retryRecommended,
    true,
  );

  assert.equal(
    classifySmsFailure({
      lifecycleStatus: "FAILED",
      providerStatus: "failed",
      errorCode: "21614",
      errorMessage: "To number is not a valid mobile number.",
    })?.blocksAutomationRetry,
    true,
  );

  const retryable = classifySmsFailure({
    lifecycleStatus: "FAILED",
    providerStatus: "failed",
    errorCode: "30008",
    errorMessage: "Temporary provider network issue.",
  });
  assert.equal(retryable?.retryRecommended, true);
  assert.equal(retryable?.blocksAutomationRetry, false);
});

test("classifySmsFailure blocks blind retry when provider acceptance is unknown", () => {
  const classification = classifySmsFailure({
    providerStatus: "timeout",
    errorCode: "TIEGUI_TIMEOUT",
    errorMessage: "Twilio request timed out before TieGui received provider confirmation.",
    providerAcceptedUnknown: true,
  });

  assert.equal(classification?.category, "UNKNOWN_PROVIDER_ACCEPTANCE");
  assert.equal(classification?.retryRecommended, false);
  assert.equal(classification?.blocksAutomationRetry, true);
  assert.match(classification?.operatorDetail || "", /may have been accepted/i);
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
