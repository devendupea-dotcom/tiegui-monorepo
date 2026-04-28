import assert from "node:assert/strict";
import test from "node:test";
import {
  mapTwilioInitialSendStatus,
  mapTwilioLifecycleStatus,
  shouldAdvanceOutboundSmsLifecycle,
} from "../lib/sms-lifecycle.ts";
import { classifySmsFailure } from "../lib/sms-failure-intelligence.ts";
import { buildUnmatchedSmsStatusCallbackEvent } from "../lib/sms-status-diagnostics.ts";
import {
  normalizeProviderMessageSid,
  reconcileOutboundSmsProviderStatus,
  recoverUnmatchedOutboundSmsStatusCallbacks,
} from "../lib/sms-status-reconciliation.ts";

function createStatusReconciliationClient() {
  const messages = new Map();
  const events = new Map();

  const client = {
    message: {
      async findFirst(input) {
        const where = input.where || {};
        return (
          [...messages.values()].find(
            (message) =>
              message.orgId === where.orgId &&
              message.providerMessageSid === where.providerMessageSid,
          ) || null
        );
      },
      async update(input) {
        const message = messages.get(input.where.id);
        if (!message) {
          throw new Error("missing message");
        }
        Object.assign(message, input.data);
        return message;
      },
    },
    communicationEvent: {
      async findMany(input) {
        const where = input.where || {};
        return [...events.values()].filter((event) => {
          if (where.orgId && event.orgId !== where.orgId) return false;
          if (where.providerMessageSid && event.providerMessageSid !== where.providerMessageSid) return false;
          if (where.summary && event.summary !== where.summary) return false;
          return true;
        });
      },
      async update(input) {
        const event = events.get(input.where.id);
        if (!event) {
          throw new Error("missing event");
        }
        Object.assign(event, input.data);
        return event;
      },
    },
  };

  return { client, messages, events };
}

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

test("normalizeProviderMessageSid trims webhook SID variants", () => {
  assert.equal(normalizeProviderMessageSid(" SM123 "), "SM123");
  assert.equal(normalizeProviderMessageSid(""), null);
  assert.equal(normalizeProviderMessageSid(null), null);
});

test("status callback reconciliation recovers a prior unmatched diagnostic once the message exists", async () => {
  const { client, messages, events } = createStatusReconciliationClient();
  messages.set("message_1", {
    id: "message_1",
    orgId: "org_1",
    leadId: "lead_1",
    providerMessageSid: "SM123",
    status: "QUEUED",
    lead: {
      customerId: "customer_1",
      conversationState: { id: "conversation_1" },
    },
  });
  events.set("event_unmatched", {
    id: "event_unmatched",
    orgId: "org_1",
    providerMessageSid: "SM123",
    summary: "Unmatched outbound SMS status callback",
    providerStatus: "undelivered",
    metadataJson: {
      unmatchedStatusCallback: true,
      providerStatus: "undelivered",
      status: "FAILED",
      providerErrorCode: "30006",
      providerErrorMessage: "Unreachable destination handset.",
    },
  });
  events.set("event_outbound", {
    id: "event_outbound",
    orgId: "org_1",
    providerMessageSid: "SM123",
    summary: "Outbound SMS sent",
    providerStatus: "queued",
    metadataJson: {
      providerStatus: "queued",
      status: "QUEUED",
    },
  });

  const result = await reconcileOutboundSmsProviderStatus({
    orgId: "org_1",
    providerMessageSid: " SM123 ",
    providerStatus: "undelivered",
    errorCode: "30006",
    errorMessage: "Unreachable destination handset.",
    occurredAt: new Date("2026-04-28T12:00:00.000Z"),
    client,
  });

  assert.deepEqual(result, {
    updatedMessages: 1,
    updatedEvents: 2,
    unmatchedCallbacks: 0,
  });
  assert.equal(messages.get("message_1").status, "FAILED");

  const recovered = events.get("event_unmatched");
  assert.equal(recovered.summary, "Recovered outbound SMS status callback");
  assert.equal(recovered.messageId, "message_1");
  assert.equal(recovered.leadId, "lead_1");
  assert.equal(recovered.contactId, "customer_1");
  assert.equal(recovered.conversationId, "conversation_1");
  assert.equal(recovered.metadataJson.unmatchedStatusCallback, false);
  assert.equal(recovered.metadataJson.recoveredFromUnmatchedStatusCallback, true);
  assert.equal(recovered.metadataJson.failureLabel, "Unreachable or non-mobile number");
});

test("manual-send recovery replays stored unmatched callbacks after the local message is committed", async () => {
  const { client, messages, events } = createStatusReconciliationClient();
  messages.set("message_2", {
    id: "message_2",
    orgId: "org_1",
    leadId: "lead_2",
    providerMessageSid: "SM456",
    status: "QUEUED",
    lead: {
      customerId: "customer_2",
      conversationState: null,
    },
  });
  events.set("event_unmatched_2", {
    id: "event_unmatched_2",
    orgId: "org_1",
    providerMessageSid: "SM456",
    summary: "Unmatched outbound SMS status callback",
    providerStatus: "failed",
    metadataJson: {
      unmatchedStatusCallback: true,
      providerStatus: "failed",
      status: "FAILED",
      providerStatusUpdatedAt: "2026-04-28T12:01:00.000Z",
      providerErrorCode: "21610",
      providerErrorMessage: "Customer replied STOP.",
    },
  });
  events.set("event_outbound_2", {
    id: "event_outbound_2",
    orgId: "org_1",
    providerMessageSid: "SM456",
    summary: "Outbound SMS sent",
    providerStatus: "queued",
    metadataJson: {
      providerStatus: "queued",
      status: "QUEUED",
    },
  });

  const result = await recoverUnmatchedOutboundSmsStatusCallbacks({
    orgId: "org_1",
    providerMessageSid: "SM456",
    client,
  });

  assert.deepEqual(result, {
    recoveredCallbacks: 1,
    updatedMessages: 1,
    updatedEvents: 2,
  });
  assert.equal(messages.get("message_2").status, "FAILED");
  assert.equal(
    events.get("event_unmatched_2").summary,
    "Recovered outbound SMS status callback",
  );
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
