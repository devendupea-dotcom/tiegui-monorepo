import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCommunicationIdempotencyKey,
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
