import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLeadSmsDebugBundle,
  buildSmsWebhookMonitorReport,
  extractSmsFailureMetadata,
  maskSmsPhone,
  maskSmsProviderSid,
  safeSmsBodyPreview,
} from "../lib/sms-operations-debug.ts";

const BASE_LEAD = {
  id: "lead_1",
  orgId: "org_1",
  orgName: "Velocity Landscapes LLC",
  contactName: "QA Contact",
  businessName: null,
  phoneE164: "+12533300042",
  status: "NEW",
  lastInboundAt: null,
  lastOutboundAt: null,
};

test("SMS operations masking and debug summary avoid full phone, SID, and long body", () => {
  const fullSid = "SMabcdef1234567890zzzz";
  const fullBody =
    "This is a deliberately long SMS body with project details that should not be copied in full into support summaries.";
  const bundle = buildLeadSmsDebugBundle({
    lead: BASE_LEAD,
    messages: [
      {
        id: "message_1",
        direction: "OUTBOUND",
        type: "MANUAL",
        status: "DELIVERED",
        fromNumberE164: "+12533308301",
        toNumberE164: BASE_LEAD.phoneE164,
        body: fullBody,
        providerMessageSid: fullSid,
        createdAt: new Date("2026-04-28T10:00:00.000Z"),
      },
    ],
    communicationEvents: [],
    receipts: [],
    callbackEvents: [],
  });

  assert.equal(maskSmsPhone("+12533300042"), "+***0042");
  assert.equal(maskSmsProviderSid(fullSid), "SMab...zzzz");
  assert.notEqual(safeSmsBodyPreview(fullBody, 40), fullBody);
  assert.match(bundle.debugSummary, /\+\*\*\*0042/);
  assert.match(bundle.debugSummary, /SMab\.\.\.zzzz/);
  assert.doesNotMatch(bundle.debugSummary, /12533300042/);
  assert.doesNotMatch(bundle.debugSummary, new RegExp(fullSid));
  assert.doesNotMatch(bundle.debugSummary, /project details/);
  assert.notEqual(bundle.messages[0].bodyPreview, fullBody);
});

test("failure metadata extraction maps category, label, and operator action", () => {
  const failure = extractSmsFailureMetadata(
    {
      failureCategory: "CARRIER_FILTERING",
      failureLabel: "Carrier filtering",
      failureOperatorAction: "REWRITE_MESSAGE",
      failureOperatorActionLabel: "Rewrite message",
      failureOperatorDetail: "Rewrite the SMS shorter and less promotional.",
      failureRetryRecommended: true,
      failureBlocksAutomationRetry: true,
      providerErrorCode: "30007",
      providerErrorMessage: "Carrier filtering detected.",
    },
    "undelivered",
  );

  assert.equal(failure?.category, "CARRIER_FILTERING");
  assert.equal(failure?.label, "Carrier filtering");
  assert.equal(failure?.operatorAction, "REWRITE_MESSAGE");
  assert.equal(failure?.operatorActionLabel, "Rewrite message");
  assert.equal(failure?.operatorDetail, "Rewrite the SMS shorter and less promotional.");
  assert.equal(failure?.retryRecommended, true);
  assert.equal(failure?.blocksAutomationRetry, true);
  assert.equal(failure?.providerErrorCode, "30007");
});

test("webhook monitor aggregation counts unmatched and recovered callbacks separately", () => {
  const now = new Date("2026-04-28T12:00:00.000Z");
  const report = buildSmsWebhookMonitorReport({
    now,
    events: [
      {
        type: "INBOUND_SMS_RECEIVED",
        channel: "SMS",
        summary: "Inbound SMS received",
        providerStatus: "delivered",
        providerMessageSid: "SM_inbound",
        occurredAt: new Date("2026-04-28T11:30:00.000Z"),
        createdAt: new Date("2026-04-28T11:30:01.000Z"),
        metadataJson: {},
      },
      {
        type: "OUTBOUND_SMS_SENT",
        channel: "SMS",
        summary: "Unmatched outbound SMS status callback",
        providerStatus: "undelivered",
        providerMessageSid: "SM_unmatched",
        occurredAt: new Date("2026-04-28T10:00:00.000Z"),
        createdAt: new Date("2026-04-28T10:00:00.000Z"),
        metadataJson: {
          providerStatusUpdatedAt: "2026-04-28T10:00:00.000Z",
          status: "FAILED",
        },
      },
      {
        type: "OUTBOUND_SMS_SENT",
        channel: "SMS",
        summary: "Recovered outbound SMS status callback",
        providerStatus: "delivered",
        providerMessageSid: "SM_recovered",
        occurredAt: new Date("2026-04-28T09:00:00.000Z"),
        createdAt: new Date("2026-04-28T09:00:00.000Z"),
        metadataJson: {
          recoveredFromUnmatchedStatusCallback: true,
          providerStatusUpdatedAt: "2026-04-28T09:00:00.000Z",
        },
      },
    ],
    messages: [
      { direction: "INBOUND", status: "DELIVERED", createdAt: new Date("2026-04-28T11:30:00.000Z") },
      { direction: "OUTBOUND", status: "DELIVERED", createdAt: new Date("2026-04-28T11:00:00.000Z") },
      { direction: "OUTBOUND", status: "DELIVERED", createdAt: new Date("2026-04-26T11:00:00.000Z") },
    ],
  });

  assert.equal(report.unmatchedCallbackCount24h, 1);
  assert.equal(report.recoveredCallbackCount24h, 1);
  assert.equal(report.callbackVolume24h, 2);
  assert.equal(report.inboundSmsVolume24h, 1);
  assert.equal(report.outboundSmsVolume24h, 1);
  assert.equal(report.latestFailedCallbackAt?.toISOString(), "2026-04-28T10:00:00.000Z");
  assert.equal(report.invalidSignatureAttemptPersistence, "deferred");
});

test("lead debug bundle includes relevant rows without raw secrets or full PII", () => {
  const bundle = buildLeadSmsDebugBundle({
    lead: BASE_LEAD,
    messages: [
      {
        id: "message_1",
        direction: "OUTBOUND",
        type: "MANUAL",
        status: "FAILED",
        fromNumberE164: "+12533308301",
        toNumberE164: BASE_LEAD.phoneE164,
        body: "A long support-sensitive customer message that should only appear as a short preview in diagnostics.",
        providerMessageSid: "SMabcdef1234567890zzzz",
        createdAt: new Date("2026-04-28T10:00:00.000Z"),
      },
    ],
    communicationEvents: [
      {
        id: "event_1",
        type: "OUTBOUND_SMS_SENT",
        channel: "SMS",
        summary: "Outbound SMS sent",
        providerStatus: "failed",
        providerMessageSid: "SMabcdef1234567890zzzz",
        occurredAt: new Date("2026-04-28T10:00:01.000Z"),
        metadataJson: {
          clientIdempotencyKey: "client-key-1",
          failureLabel: "Bad or unsupported phone number",
          failureOperatorActionLabel: "Call customer",
          providerErrorMessage: "not a mobile number",
        },
        messageId: "message_1",
      },
    ],
    receipts: [
      {
        id: "receipt_1",
        route: "/api/inbox/send",
        idempotencyKey: "manual-sms:inbox-send:client-key-1",
        createdAt: new Date("2026-04-28T10:00:02.000Z"),
        responseJson: {
          body: {
            message: {
              body: "secret response body",
              phone: BASE_LEAD.phoneE164,
            },
          },
        },
      },
    ],
    callbackEvents: [
      {
        id: "event_recovered",
        type: "OUTBOUND_SMS_SENT",
        channel: "SMS",
        summary: "Recovered outbound SMS status callback",
        providerStatus: "failed",
        providerMessageSid: "SMabcdef1234567890zzzz",
        occurredAt: new Date("2026-04-28T10:00:03.000Z"),
        metadataJson: { failureLabel: "Bad or unsupported phone number" },
      },
    ],
  });

  const serialized = JSON.stringify(bundle);
  assert.equal(bundle.messages.length, 1);
  assert.equal(bundle.communicationEvents.length, 1);
  assert.equal(bundle.receipts[0].responseJsonExists, true);
  assert.equal(bundle.recoveredCallbackCount, 1);
  assert.equal(bundle.communicationEvents[0].failure?.label, "Bad or unsupported phone number");
  assert.doesNotMatch(serialized, /12533300042/);
  assert.doesNotMatch(serialized, /SMabcdef1234567890zzzz/);
  assert.doesNotMatch(serialized, /secret response body/);
});

test("DNC and STOP state are surfaced in lead diagnostics", () => {
  const bundle = buildLeadSmsDebugBundle({
    lead: { ...BASE_LEAD, status: "DNC" },
    messages: [],
    communicationEvents: [
      {
        id: "event_stop",
        type: "INBOUND_SMS_RECEIVED",
        channel: "SMS",
        summary: "Inbound SMS received",
        providerStatus: "delivered",
        providerMessageSid: "SMstop1234567890",
        occurredAt: new Date("2026-04-28T10:00:00.000Z"),
        metadataJson: { body: "STOP" },
      },
    ],
    receipts: [],
    callbackEvents: [],
  });

  assert.equal(bundle.lead.dncBlocked, true);
  assert.equal(bundle.complianceEvents.length, 1);
  assert.equal(bundle.complianceEvents[0].complianceKeyword, "STOP");
  assert.match(bundle.debugSummary, /DNC\/STOP blocked/);
});
