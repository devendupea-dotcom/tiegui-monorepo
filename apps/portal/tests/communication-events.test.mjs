import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCommunicationIdempotencyKey,
  recordOutboundSmsCommunicationEvent,
  sortTimelineEventsStable,
  upsertCommunicationEvent,
  upsertVoicemailArtifact,
} from "../lib/communication-events.ts";

test("upsertCommunicationEvent uses composite orgId/idempotencyKey protection", async () => {
  const calls = [];
  const tx = {
    communicationEvent: {
      async upsert(input) {
        calls.push(input);
        return input;
      },
    },
  };

  await upsertCommunicationEvent(tx, {
    orgId: "org_1",
    leadId: "lead_1",
    contactId: "contact_1",
    conversationId: "conversation_1",
    messageId: "message_1",
    type: "OUTBOUND_SMS_SENT",
    channel: "SMS",
    occurredAt: new Date("2025-03-20T14:00:00.000Z"),
    summary: "Outbound SMS sent",
    metadataJson: { body: "Hi there" },
    provider: "TWILIO",
    providerMessageSid: "SM123",
    providerStatus: "SENT",
    idempotencyKey: buildCommunicationIdempotencyKey("sms-outbound", "org_1", "message_1"),
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].where, {
    orgId_idempotencyKey: {
      orgId: "org_1",
      idempotencyKey: buildCommunicationIdempotencyKey("sms-outbound", "org_1", "message_1"),
    },
  });
  assert.equal(calls[0].create.contactId, "contact_1");
  assert.equal(calls[0].create.conversationId, "conversation_1");
});

test("upsertCommunicationEvent creates a conversation state when the lead is linked but the conversation is missing", async () => {
  const calls = [];
  const tx = {
    lead: {
      async findUnique() {
        return {
          id: "lead_1",
          orgId: "org_1",
          customerId: "contact_1",
          conversationState: null,
        };
      },
    },
    leadConversationState: {
      async upsert() {
        return { id: "conversation_1" };
      },
    },
    communicationEvent: {
      async upsert(input) {
        calls.push(input);
        return input;
      },
    },
  };

  await upsertCommunicationEvent(tx, {
    orgId: "org_1",
    leadId: "lead_1",
    messageId: "message_1",
    type: "OUTBOUND_SMS_SENT",
    channel: "SMS",
    occurredAt: new Date("2025-03-20T14:00:00.000Z"),
    summary: "Outbound SMS sent",
    idempotencyKey: buildCommunicationIdempotencyKey("sms-outbound", "org_1", "message_1"),
  });

  assert.equal(calls[0].create.contactId, "contact_1");
  assert.equal(calls[0].create.conversationId, "conversation_1");
});

test("recordOutboundSmsCommunicationEvent audits provider timeout and failure metadata", async () => {
  const calls = [];
  const tx = {
    communicationEvent: {
      async upsert(input) {
        calls.push(input);
        return input;
      },
    },
  };

  await recordOutboundSmsCommunicationEvent(tx, {
    orgId: "org_1",
    leadId: "lead_1",
    contactId: "contact_1",
    conversationId: "conversation_1",
    messageId: "message_1",
    actorUserId: "user_1",
    body: "On my way.",
    fromNumberE164: "+15557654321",
    toNumberE164: "+15551234567",
    providerMessageSid: null,
    status: "QUEUED",
    deliveryNotice:
      "Twilio send timed out before TieGui received confirmation. The SMS may have been accepted; refresh the thread or check Twilio before retrying.",
    providerStatus: "timeout",
    providerErrorCode: "TIEGUI_TIMEOUT",
    providerErrorMessage: "Twilio request timed out before TieGui received provider confirmation.",
    providerRequestTimedOut: true,
    providerAcceptedUnknown: true,
    clientIdempotencyKey: "client-key-1",
    failure: {
      category: "UNKNOWN_PROVIDER_ACCEPTANCE",
      label: "Provider confirmation timed out",
      operatorAction: "REVIEW_MANUALLY",
      operatorActionLabel: "Check Twilio before retrying",
      operatorDetail:
        "TieGui did not receive Twilio confirmation. The SMS may have been accepted, so refresh the thread or check Twilio before sending again.",
      retryRecommended: false,
      blocksAutomationRetry: true,
    },
    occurredAt: new Date("2026-04-27T20:30:00.000Z"),
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].create.providerStatus, "timeout");
  assert.deepEqual(calls[0].create.metadataJson, {
    body: "On my way.",
    fromNumberE164: "+15557654321",
    toNumberE164: "+15551234567",
    status: "QUEUED",
    providerMessageSid: null,
    providerStatus: "timeout",
    providerErrorCode: "TIEGUI_TIMEOUT",
    providerErrorMessage: "Twilio request timed out before TieGui received provider confirmation.",
    providerRequestTimedOut: true,
    providerAcceptedUnknown: true,
    clientIdempotencyKey: "client-key-1",
    failureCategory: "UNKNOWN_PROVIDER_ACCEPTANCE",
    failureLabel: "Provider confirmation timed out",
    failureOperatorAction: "REVIEW_MANUALLY",
    failureOperatorActionLabel: "Check Twilio before retrying",
    failureOperatorDetail:
      "TieGui did not receive Twilio confirmation. The SMS may have been accepted, so refresh the thread or check Twilio before sending again.",
    failureRetryRecommended: false,
    failureBlocksAutomationRetry: true,
    deliveryNotice:
      "Twilio send timed out before TieGui received confirmation. The SMS may have been accepted; refresh the thread or check Twilio before retrying.",
  });
});

test("upsertCommunicationEvent rejects partial lead linkage when no contact can be resolved", async () => {
  const tx = {
    lead: {
      async findUnique() {
        return {
          id: "lead_1",
          orgId: "org_1",
          customerId: null,
          conversationState: {
            id: "conversation_1",
          },
        };
      },
    },
    leadConversationState: {
      async upsert() {
        throw new Error("should not create a conversation state");
      },
    },
    communicationEvent: {
      async upsert() {
        throw new Error("should not persist partial linkage");
      },
    },
  };

  await assert.rejects(
    () =>
      upsertCommunicationEvent(tx, {
        orgId: "org_1",
        leadId: "lead_1",
        messageId: "message_1",
        type: "OUTBOUND_SMS_SENT",
        channel: "SMS",
        occurredAt: new Date("2025-03-20T14:00:00.000Z"),
        summary: "Outbound SMS sent",
        idempotencyKey: buildCommunicationIdempotencyKey("sms-outbound", "org_1", "message_1"),
      }),
    /require a linked contact/i,
  );
});

test("upsertVoicemailArtifact preserves lead, contact, call, recording, and transcript linkage", async () => {
  const calls = [];
  const tx = {
    voicemailArtifact: {
      async upsert(input) {
        calls.push(input);
        return input;
      },
    },
  };

  await upsertVoicemailArtifact(tx, {
    orgId: "org_1",
    leadId: "lead_1",
    contactId: "contact_1",
    conversationId: "conversation_1",
    callId: "call_1",
    communicationEventId: "event_1",
    providerCallSid: "CA123",
    recordingSid: "RE123",
    recordingUrl: "https://api.twilio.com/recordings/RE123",
    recordingDurationSeconds: 37,
    transcriptionStatus: "COMPLETED",
    transcriptionText: "Need a concrete estimate.",
    voicemailAt: new Date("2025-03-20T14:05:00.000Z"),
    metadataJson: { source: "twilio" },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].create.leadId, "lead_1");
  assert.equal(calls[0].create.contactId, "contact_1");
  assert.equal(calls[0].create.callId, "call_1");
  assert.equal(calls[0].create.recordingSid, "RE123");
  assert.equal(calls[0].create.transcriptionText, "Need a concrete estimate.");
});

test("sortTimelineEventsStable keeps chronological order stable for equal timestamps", () => {
  const ordered = sortTimelineEventsStable([
    { id: "b", createdAt: "2025-03-20T14:00:00.000Z" },
    { id: "a", createdAt: "2025-03-20T14:00:00.000Z" },
    { id: "c", createdAt: "2025-03-20T14:01:00.000Z" },
  ]);

  assert.deepEqual(
    ordered.map((event) => event.id),
    ["a", "b", "c"],
  );
});
