import assert from "node:assert/strict";
import test from "node:test";
import { buildMissedCallOpeningMessages } from "../lib/missed-call-opening.ts";
import { SMS_TEMPLATES, renderSmsTemplate } from "../lib/conversational-sms-templates.ts";

test("buildMissedCallOpeningMessages builds a single compliant opener for the missed-call funnel", () => {
  const messages = buildMissedCallOpeningMessages({
    organization: {
      name: "Velocity Landscapes",
      smsGreetingLine: null,
      smsWebsiteSignature: null,
      missedCallAutoReplyBody: null,
      missedCallAutoReplyBodyEn: null,
      missedCallAutoReplyBodyEs: null,
      smsTone: "FRIENDLY",
    },
    locale: "EN",
    openerTemplate: SMS_TEMPLATES.friendly.opener,
  });

  assert.match(messages.immediateBody, /sorry we missed ya/i);
  assert.match(messages.immediateBody, /What kind of work are you looking to get done\?/);
  assert.match(messages.immediateBody, /Reply STOP to unsubscribe\.$/);
  assert.equal(messages.delayedPromptBody, null);
});

test("buildMissedCallOpeningMessages honors localized custom opener, greeting line, and signature", () => {
  const messages = buildMissedCallOpeningMessages({
    organization: {
      name: "Velocity Landscapes",
      smsGreetingLine: "Hola, habla Velocity Landscapes",
      smsWebsiteSignature: "velocitylandscapes.com",
      missedCallAutoReplyBody: null,
      missedCallAutoReplyBodyEn: null,
      missedCallAutoReplyBodyEs: null,
      smsTone: "BILINGUAL",
    },
    locale: "ES",
    openerTemplate: "Perdón, perdimos tu llamada. ¿Qué trabajo necesitas?",
  });

  assert.match(messages.immediateBody, /Hola, habla Velocity Landscapes/);
  assert.match(messages.immediateBody, /Perd[oó]n, perdimos tu llamada\./);
  assert.match(messages.immediateBody, /Reply STOP to unsubscribe \/ Responde STOP para cancelar\./);
  assert.match(messages.immediateBody, /velocitylandscapes\.com/);
  assert.equal(messages.delayedPromptBody, null);
});

test("renderSmsTemplate fills the new slot1/slot2/slot3 variables", () => {
  const body = renderSmsTemplate(SMS_TEMPLATES.professional.afterTimeline, {
    bizName: "Velocity Landscapes",
    slot1: "A) Tue 9:00am",
    slot2: "B) Wed 1:00pm",
    slot3: "C) Thu 3:30pm",
  });

  assert.match(body, /A\) Tue 9:00am/);
  assert.match(body, /B\) Wed 1:00pm/);
  assert.match(body, /C\) Thu 3:30pm/);
});
