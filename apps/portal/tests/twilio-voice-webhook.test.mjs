import assert from "node:assert/strict";
import test from "node:test";
import { buildForwardDialTwiml, buildVoicemailFallbackTwiml } from "../lib/twilio-voice-copy.ts";
import {
  resolveExplicitVoiceForwardTarget,
  shouldSendVoiceRiskToVoicemailOnly,
  voiceConfigOwnsCalledNumber,
} from "../lib/twilio-voice-routing.ts";

test("buildVoicemailFallbackTwiml uses the business name and escapes the callback URL", async () => {
  const response = buildVoicemailFallbackTwiml({
    afterCallUrl: "https://example.com/api/webhooks/twilio/after-call?voicemailFallback=1&source=voice",
    businessName: "Acme Roofing",
  });

  const text = await response.text();

  assert.match(text, /Thanks for calling Acme Roofing\./);
  assert.match(text, /action="https:\/\/example\.com\/api\/webhooks\/twilio\/after-call\?voicemailFallback=1&amp;source=voice"/);
  assert.doesNotMatch(text, /Cesar/);
});

test("buildVoicemailFallbackTwiml falls back to generic copy when the business name is blank", async () => {
  const response = buildVoicemailFallbackTwiml({
    afterCallUrl: "https://example.com/api/webhooks/twilio/after-call",
    businessName: "   ",
  });

  const text = await response.text();

  assert.match(text, /Thanks for calling\./);
  assert.doesNotMatch(text, /Thanks for calling\s+\./);
});

test("buildForwardDialTwiml omits callerId when forwarding the real caller through", async () => {
  const response = buildForwardDialTwiml({
    afterCallUrl: "https://example.com/api/webhooks/twilio/after-call",
    forwardingNumber: "+15550001111",
    timeoutSeconds: 20,
    callerId: null,
  });

  const text = await response.text();

  assert.match(text, /<Dial timeout="20" action="https:\/\/example\.com\/api\/webhooks\/twilio\/after-call" method="POST" answerOnBridge="true">/);
  assert.doesNotMatch(text, /callerId=/);
  assert.match(text, />\+15550001111<\/Dial>/);
});

test("voice config matching rejects account and called-number mixups", () => {
  assert.equal(
    voiceConfigOwnsCalledNumber({
      configPhoneNumber: "+12533308301",
      organizationSmsFromNumberE164: "+12533308301",
      calledNumber: "(253) 330-8301",
    }),
    true,
  );

  assert.equal(
    voiceConfigOwnsCalledNumber({
      configPhoneNumber: "+12533308301",
      organizationSmsFromNumberE164: "+12533308301",
      calledNumber: "+12065550100",
    }),
    false,
  );
});

test("voice forwarding uses only the explicit Twilio forwarding number", async () => {
  assert.equal(resolveExplicitVoiceForwardTarget("+12533300042"), "+12533300042");
  assert.equal(resolveExplicitVoiceForwardTarget(null), null);
});

test("voice spam risk uses voicemail-only routing instead of owner forwarding", () => {
  assert.equal(shouldSendVoiceRiskToVoicemailOnly("VOICEMAIL_ONLY"), true);
  assert.equal(shouldSendVoiceRiskToVoicemailOnly(" voicemail_only "), true);
  assert.equal(shouldSendVoiceRiskToVoicemailOnly("CAUTION"), false);
  assert.equal(shouldSendVoiceRiskToVoicemailOnly(null), false);
});
