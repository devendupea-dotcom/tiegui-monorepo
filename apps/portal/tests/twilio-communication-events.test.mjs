import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTwilioVoiceEvent,
  normalizeTwilioVoiceOutcomeEvents,
  parseTwilioVoiceSnapshot,
} from "../lib/twilio-communication-events.ts";

function buildFormData(entries) {
  const form = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    form.set(key, value);
  }
  return form;
}

test("normalizeTwilioVoiceOutcomeEvents preserves answered outcomes as owner_answered plus completed", () => {
  const snapshot = parseTwilioVoiceSnapshot({
    form: buildFormData({
      CallSid: "CA_answered",
      From: "+15550001111",
      To: "+15550002222",
      DialCallStatus: "answered",
      CallDuration: "93",
    }),
    forwardedTo: "+15550003333",
  });

  const events = normalizeTwilioVoiceOutcomeEvents(snapshot);

  assert.deepEqual(
    events.map((event) => event.type),
    ["OWNER_ANSWERED", "COMPLETED"],
  );
  assert.equal(events[0].summary, "Owner answered at +15550003333");
  assert.equal(events[1].summary, "Call completed in 93s");
});

test("normalizeTwilioVoiceOutcomeEvents maps voicemail recordings to voicemail_left with artifact metadata", () => {
  const snapshot = parseTwilioVoiceSnapshot({
    form: buildFormData({
      CallSid: "CA_vm",
      From: "+15550001111",
      To: "+15550002222",
      RecordingSid: "RE123",
      RecordingUrl: "https://api.twilio.com/recordings/RE123",
      RecordingDuration: "41",
      TranscriptionStatus: "completed",
      TranscriptionText: "Need an estimate for a roof repair.",
    }),
    voicemailFallbackStage: true,
  });

  const event = normalizeTwilioVoiceOutcomeEvents(snapshot)[0];

  assert.equal(event.type, "VOICEMAIL_LEFT");
  assert.equal(event.summary, "Voicemail left");
  assert.equal(event.metadata.recordingSid, "RE123");
  assert.equal(event.metadata.recordingDurationSeconds, 41);
  assert.equal(event.metadata.transcriptionText, "Need an estimate for a roof repair.");
});

test("normalizeTwilioVoiceOutcomeEvents maps voicemail fallback hangups to abandoned", () => {
  const snapshot = parseTwilioVoiceSnapshot({
    form: buildFormData({
      CallSid: "CA_abandoned",
      From: "+15550001111",
      To: "+15550002222",
      CallStatus: "completed",
      CallDuration: "0",
    }),
    voicemailFallbackStage: true,
  });

  const event = normalizeTwilioVoiceOutcomeEvents(snapshot)[0];

  assert.equal(event.type, "ABANDONED");
  assert.equal(event.summary, "Caller abandoned before leaving voicemail");
});

test("buildTwilioVoiceEvent keeps raw Twilio payload details in metadata", () => {
  const snapshot = parseTwilioVoiceSnapshot({
    form: buildFormData({
      CallSid: "CA_busy",
      ParentCallSid: "CA_parent",
      From: "+15550001111",
      To: "+15550002222",
      DialCallStatus: "busy",
    }),
    forwardedTo: "+15550003333",
  });

  const event = buildTwilioVoiceEvent({
    type: "BUSY",
    snapshot,
    extraMetadata: { correlationId: "voice-1" },
  });

  assert.equal(event.providerStatus, "busy");
  assert.equal(event.metadata.callSid, "CA_busy");
  assert.equal(event.metadata.parentCallSid, "CA_parent");
  assert.equal(event.metadata.forwardedTo, "+15550003333");
  assert.equal(event.metadata.correlationId, "voice-1");
  assert.equal(event.metadata.payload.DialCallStatus, "busy");
});
