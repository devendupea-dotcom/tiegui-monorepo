import assert from "node:assert/strict";
import test from "node:test";
import {
  mapLegacyCallToCommunicationEvent,
  mapLegacyMessageToCommunicationEvent,
} from "../lib/legacy-communication-backfill.ts";

test("mapLegacyCallToCommunicationEvent marks legacy MISSED calls as low-confidence no_answer imports", () => {
  const result = mapLegacyCallToCommunicationEvent({
    id: "call_1",
    orgId: "org_1",
    leadId: "lead_1",
    contactId: "contact_1",
    conversationId: "conversation_1",
    twilioCallSid: "CA123",
    direction: "INBOUND",
    status: "MISSED",
    fromNumberE164: "+15550001111",
    toNumberE164: "+15550002222",
    trackingNumberE164: "+15550002222",
    landingPageUrl: null,
    utmCampaign: null,
    gclid: null,
    attributionSource: "UNKNOWN",
    startedAt: new Date("2025-03-20T14:00:00.000Z"),
    endedAt: new Date("2025-03-20T14:00:08.000Z"),
  });

  assert.equal(result.type, "NO_ANSWER");
  assert.equal(result.channel, "VOICE");
  assert.equal(result.providerCallSid, "CA123");
  assert.equal(result.confidence, "low");
  assert.match(result.reviewReasons[0], /MISSED status could represent no-answer, busy, failed, or canceled/i);
});

test("mapLegacyMessageToCommunicationEvent preserves outbound SMS provider data", () => {
  const result = mapLegacyMessageToCommunicationEvent({
    id: "message_1",
    orgId: "org_1",
    leadId: "lead_1",
    contactId: "contact_1",
    conversationId: "conversation_1",
    direction: "OUTBOUND",
    type: "AUTOMATION",
    fromNumberE164: "+15550002222",
    toNumberE164: "+15550001111",
    body: "Thanks for reaching out.",
    provider: "TWILIO",
    providerMessageSid: "SM123",
    status: "SENT",
    createdAt: new Date("2025-03-20T14:10:00.000Z"),
  });

  assert.equal(result.type, "OUTBOUND_SMS_SENT");
  assert.equal(result.channel, "SMS");
  assert.equal(result.provider, "TWILIO");
  assert.equal(result.providerMessageSid, "SM123");
  assert.equal(result.providerStatus, "SENT");
  assert.equal(result.confidence, "high");
});
