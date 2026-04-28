import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSmsComplianceReply,
  ensureAutomatedSmsCompliance,
  ensureSmsA2POpenerDisclosure,
  ensureSmsOptOutHint,
  parseSmsComplianceKeyword,
} from "../lib/sms-compliance.ts";

test("ensureSmsOptOutHint appends the Twilio opt-out instruction for English first messages", () => {
  const body = ensureSmsOptOutHint("Hey, this is Acme Roofing. Sorry we missed your call.", "EN");
  assert.match(body, /Reply STOP to opt out\.$/);
});

test("ensureSmsOptOutHint does not duplicate the opt-out instruction when it already exists", () => {
  const original = "Hey, this is Acme Roofing. Sorry we missed your call.\n\nReply STOP to opt out.";
  const body = ensureSmsOptOutHint(original, "EN");
  assert.equal(body, original);
});

test("ensureSmsOptOutHint uses the Spanish opt-out instruction when the locale is Spanish", () => {
  const body = ensureSmsOptOutHint("Hola, habla Acme Roofing. Perdón que perdimos tu llamada.", "ES");
  assert.match(body, /Responde STOP para dejar de recibir mensajes\.$/);
});

test("ensureAutomatedSmsCompliance appends opt-out language to AI and system messages", () => {
  const aiBody = ensureAutomatedSmsCompliance({
    body: "Thanks, can you send the project address?",
    locale: "EN",
    messageType: "AUTOMATION",
  });
  const nudgeBody = ensureAutomatedSmsCompliance({
    body: "Following up from Acme Roofing.",
    locale: "EN",
    messageType: "SYSTEM_NUDGE",
  });

  assert.match(aiBody, /Reply STOP to opt out\.$/);
  assert.match(nudgeBody, /Reply STOP to opt out\.$/);
});

test("ensureAutomatedSmsCompliance leaves manual operator texts unchanged", () => {
  const body = ensureAutomatedSmsCompliance({
    body: "I can come by Thursday afternoon.",
    locale: "EN",
    messageType: "MANUAL",
  });

  assert.equal(body, "I can come by Thursday afternoon.");
});

test("ensureAutomatedSmsCompliance does not duplicate existing A2P disclosure", () => {
  const opener = ensureSmsA2POpenerDisclosure("Acme Roofing missed your call.", "EN");
  const body = ensureAutomatedSmsCompliance({
    body: opener,
    locale: "EN",
    messageType: "AUTOMATION",
  });

  assert.equal(body, opener);
});

test("ensureSmsA2POpenerDisclosure appends the opener-only disclosure for English funnels", () => {
  const body = ensureSmsA2POpenerDisclosure("Acme Roofing missed your call. What work do you need?", "EN");
  assert.match(body, /Reply STOP to unsubscribe\.$/);
});

test("ensureSmsA2POpenerDisclosure uses the bilingual disclosure when required", () => {
  const body = ensureSmsA2POpenerDisclosure("Hola de Acme Roofing. ¿Qué trabajo necesitas?", "BILINGUAL");
  assert.match(body, /Reply STOP to unsubscribe \/ Responde STOP para cancelar\.$/);
});

test("parseSmsComplianceKeyword recognizes STOP, START/UNSTOP, and HELP", () => {
  assert.equal(parseSmsComplianceKeyword("stop please"), "STOP");
  assert.equal(parseSmsComplianceKeyword("optout"), "STOP");
  assert.equal(parseSmsComplianceKeyword("revoke"), "STOP");
  assert.equal(parseSmsComplianceKeyword("UNSTOP"), "START");
  assert.equal(parseSmsComplianceKeyword("help"), "HELP");
  assert.equal(parseSmsComplianceKeyword("hello there"), null);
});

test("buildSmsComplianceReply returns the required HELP message", () => {
  const body = buildSmsComplianceReply({
    keyword: "HELP",
    bizName: "Acme Roofing",
    bizPhone: "(206) 555-0100",
  });

  assert.equal(
    body,
    "Acme Roofing automated messaging. For support contact us at (206) 555-0100. Reply STOP to unsubscribe.",
  );
});
