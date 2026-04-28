import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSlotTemplateContext,
  formatMissingField,
  getFollowUpCadenceMinutes,
  hasStartKeyword,
  hasStopKeyword,
  parseBookingSelection,
  parseWorkAndLocation,
  shouldRouteInboundSmsToHuman,
} from "../lib/conversational-sms-core.ts";

test("stop and start keywords are recognized from the first token only", () => {
  assert.equal(hasStopKeyword("stop please"), true);
  assert.equal(hasStartKeyword("start now"), true);
  assert.equal(hasStopKeyword("please stop"), false);
});

test("parseWorkAndLocation can split explicit work and city replies", () => {
  assert.deepEqual(parseWorkAndLocation("Fence repair in Pasadena"), {
    workSummary: "Fence repair",
    addressText: null,
    addressCity: "Pasadena",
  });
});

test("parseBookingSelection matches both letter and numeric slot references", () => {
  const options = [
    { id: "A", holdId: "hold-a", startAtIso: "", endAtIso: "", workerUserId: "worker-1", label: "Today 10am", matchText: "today 10am" },
    { id: "B", holdId: "hold-b", startAtIso: "", endAtIso: "", workerUserId: "worker-2", label: "Tomorrow 2pm", matchText: "tomorrow 2pm" },
  ];

  assert.equal(parseBookingSelection({ inboundBody: "I can do 2", options })?.id, "B");
  assert.equal(parseBookingSelection({ inboundBody: "Let's do A", options })?.id, "A");
});

test("buildSlotTemplateContext keeps compact named slots for templates", () => {
  const context = buildSlotTemplateContext([
    { id: "A", holdId: "hold-a", startAtIso: "", endAtIso: "", workerUserId: "worker-1", label: "Today 10am", matchText: "today 10am" },
    { id: "B", holdId: "hold-b", startAtIso: "", endAtIso: "", workerUserId: "worker-2", label: "Tomorrow 2pm", matchText: "tomorrow 2pm" },
  ]);

  assert.deepEqual(context, {
    slotList: "A) Today 10am  B) Tomorrow 2pm",
    slot1: "A) Today 10am",
    slot2: "B) Tomorrow 2pm",
    slot3: "",
  });
});

test("follow-up cadence and missing-field labels stay stage-aware", () => {
  assert.deepEqual(getFollowUpCadenceMinutes("ASKED_WORK", ["ASKED_WORK", "ASKED_ADDRESS"]), [2880]);
  assert.equal(formatMissingField("ASKED_ADDRESS", "EN"), "the property address");
  assert.equal(formatMissingField("OFFERED_BOOKING", "ES"), "la opción (A/B/C)");
});

test("human routing catches pricing and custom questions without blocking normal intake", () => {
  assert.equal(shouldRouteInboundSmsToHuman("Can someone call me?"), true);
  assert.equal(shouldRouteInboundSmsToHuman("How much would this cost?"), true);
  assert.equal(shouldRouteInboundSmsToHuman("Are you licensed and insured?"), true);
  assert.equal(
    shouldRouteInboundSmsToHuman(
      "Cesar, neither your price nor your schedule works for me. Can you work this week at a reasonable price?",
    ),
    true,
  );
  assert.equal(shouldRouteInboundSmsToHuman("Fence repair in Pasadena"), false);
  assert.equal(shouldRouteInboundSmsToHuman("Can you do fence repair in Pasadena?"), false);
});
