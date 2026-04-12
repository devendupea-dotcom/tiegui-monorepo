import assert from "node:assert/strict";
import test from "node:test";
import {
  getConversationalSmsLlmReplyBody,
  hasConversationalSmsLlmExtractionConfidence,
  hasConversationalSmsLlmHandoffConfidence,
  normalizeConversationalSmsLlmDecision,
} from "../lib/conversational-sms-llm-contract.ts";

test("normalizeConversationalSmsLlmDecision accepts valid structured output", () => {
  const decision = normalizeConversationalSmsLlmDecision({
    confidence: 0.91,
    workSummary: " Fence repair ",
    addressText: "123 Oak St ",
    addressCity: " Pasadena ",
    timeframe: "THIS_WEEK",
    selectedSlotId: "B",
    shouldHandoff: false,
    replyBody: "Sure - what's the property address?",
  });

  assert.deepEqual(decision, {
    confidence: 0.91,
    workSummary: "Fence repair",
    addressText: "123 Oak St",
    addressCity: "Pasadena",
    timeframe: "THIS_WEEK",
    selectedSlotId: "B",
    shouldHandoff: false,
    replyBody: "Sure - what's the property address?",
  });
});

test("normalizeConversationalSmsLlmDecision drops invalid enum values and sanitizes reply text", () => {
  const decision = normalizeConversationalSmsLlmDecision({
    confidence: 2,
    timeframe: "LATER",
    selectedSlotId: "D",
    shouldHandoff: true,
    replyBody: "  We can help.   What city is the property in?  ",
  });

  assert.equal(decision.confidence, 1);
  assert.equal(decision.timeframe, null);
  assert.equal(decision.selectedSlotId, null);
  assert.equal(decision.shouldHandoff, true);
  assert.equal(getConversationalSmsLlmReplyBody(decision), "We can help. What city is the property in?");
});

test("confidence helpers distinguish extraction confidence from safer handoff confidence", () => {
  const low = normalizeConversationalSmsLlmDecision({ confidence: 0.72, shouldHandoff: true });
  const high = normalizeConversationalSmsLlmDecision({ confidence: 0.84, shouldHandoff: true });

  assert.equal(hasConversationalSmsLlmHandoffConfidence(low), true);
  assert.equal(hasConversationalSmsLlmExtractionConfidence(low), false);
  assert.equal(hasConversationalSmsLlmExtractionConfidence(high), true);
});
