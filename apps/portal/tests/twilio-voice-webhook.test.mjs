import assert from "node:assert/strict";
import test from "node:test";
import { buildForwardDialTwiml, buildVoicemailFallbackTwiml } from "../lib/twilio-voice-copy.ts";

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
