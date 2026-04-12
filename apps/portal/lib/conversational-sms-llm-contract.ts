import type { ConversationTimeframe } from "@prisma/client";

export type ConversationalSmsLlmDecision = {
  confidence: number;
  workSummary: string | null;
  addressText: string | null;
  addressCity: string | null;
  timeframe: ConversationTimeframe | null;
  selectedSlotId: "A" | "B" | "C" | null;
  shouldHandoff: boolean;
  replyBody: string | null;
};

export const CONVERSATIONAL_SMS_LLM_EXTRACTION_CONFIDENCE = 0.78;
export const CONVERSATIONAL_SMS_LLM_HANDOFF_CONFIDENCE = 0.7;
const MAX_FIELD_LENGTH = 160;
const MAX_REPLY_LENGTH = 220;

function sanitizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeNullableShortText(value: unknown, maxLength = MAX_FIELD_LENGTH): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const sanitized = sanitizeText(value);
  if (!sanitized) {
    return null;
  }

  return sanitized.slice(0, maxLength);
}

function normalizeConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}

function normalizeTimeframe(value: unknown): ConversationTimeframe | null {
  switch (value) {
    case "ASAP":
    case "THIS_WEEK":
    case "NEXT_WEEK":
    case "QUOTE_ONLY":
      return value;
    default:
      return null;
  }
}

function normalizeSlotId(value: unknown): "A" | "B" | "C" | null {
  switch (value) {
    case "A":
    case "B":
    case "C":
      return value;
    default:
      return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function normalizeConversationalSmsLlmDecision(value: unknown): ConversationalSmsLlmDecision | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  return {
    confidence: normalizeConfidence(record.confidence),
    workSummary: normalizeNullableShortText(record.workSummary),
    addressText: normalizeNullableShortText(record.addressText),
    addressCity: normalizeNullableShortText(record.addressCity, 80),
    timeframe: normalizeTimeframe(record.timeframe),
    selectedSlotId: normalizeSlotId(record.selectedSlotId),
    shouldHandoff: record.shouldHandoff === true,
    replyBody: normalizeNullableShortText(record.replyBody, MAX_REPLY_LENGTH),
  };
}

export function hasConversationalSmsLlmExtractionConfidence(
  decision: ConversationalSmsLlmDecision | null | undefined,
): boolean {
  return (decision?.confidence || 0) >= CONVERSATIONAL_SMS_LLM_EXTRACTION_CONFIDENCE;
}

export function hasConversationalSmsLlmHandoffConfidence(
  decision: ConversationalSmsLlmDecision | null | undefined,
): boolean {
  return (decision?.confidence || 0) >= CONVERSATIONAL_SMS_LLM_HANDOFF_CONFIDENCE;
}

export function getConversationalSmsLlmReplyBody(
  decision: ConversationalSmsLlmDecision | null | undefined,
): string | null {
  const reply = decision?.replyBody;
  if (!reply) {
    return null;
  }

  return sanitizeText(reply).slice(0, MAX_REPLY_LENGTH) || null;
}
