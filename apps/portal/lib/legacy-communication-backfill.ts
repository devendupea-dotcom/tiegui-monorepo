import { createHash } from "node:crypto";
import type {
  CallDirection,
  CallStatus,
  CommunicationChannel,
  CommunicationEventType,
  MessageDirection,
  MessageStatus,
  MessageType,
  Prisma,
} from "@prisma/client";

export type BackfillConfidence = "high" | "medium" | "low";

export type LegacyBackfillResult = {
  type: CommunicationEventType;
  channel: CommunicationChannel;
  occurredAt: Date;
  summary: string;
  provider: string | null;
  providerStatus: string | null;
  providerCallSid: string | null;
  providerMessageSid: string | null;
  metadataJson: Prisma.InputJsonObject;
  idempotencyKey: string;
  confidence: BackfillConfidence;
  reviewReasons: string[];
};

export type LegacyCallBackfillRow = {
  id: string;
  orgId: string;
  leadId: string | null;
  contactId: string | null;
  conversationId: string | null;
  twilioCallSid: string | null;
  direction: CallDirection;
  status: CallStatus;
  fromNumberE164: string;
  toNumberE164: string;
  trackingNumberE164: string | null;
  landingPageUrl: string | null;
  utmCampaign: string | null;
  gclid: string | null;
  attributionSource: string;
  startedAt: Date;
  endedAt: Date | null;
};

export type LegacyMessageBackfillRow = {
  id: string;
  orgId: string;
  leadId: string;
  contactId: string | null;
  conversationId: string | null;
  direction: MessageDirection;
  type: MessageType;
  fromNumberE164: string;
  toNumberE164: string;
  body: string;
  provider: string;
  providerMessageSid: string | null;
  status: MessageStatus | null;
  createdAt: Date;
};

function buildLegacyBackfillIdempotencyKey(
  prefix: "legacy-call" | "legacy-message",
  orgId: string,
  legacyId: string,
  providerId: string | null,
) {
  const body = [orgId, providerId || legacyId].join("|");
  return `${prefix}:${createHash("sha1").update(body).digest("hex")}`;
}

function buildDurationSeconds(startedAt: Date, endedAt: Date | null) {
  if (!endedAt) return null;
  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) return null;
  return Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));
}

export function mapLegacyCallToCommunicationEvent(input: LegacyCallBackfillRow): LegacyBackfillResult {
  let type: CommunicationEventType;
  let summary: string;
  let confidence: BackfillConfidence = "high";
  const reviewReasons: string[] = [];

  switch (input.status) {
    case "ANSWERED":
      type = "COMPLETED";
      summary = input.direction === "INBOUND" ? "Legacy answered inbound call imported" : "Legacy answered call imported";
      break;
    case "VOICEMAIL":
      type = "VOICEMAIL_LEFT";
      summary = "Legacy voicemail call imported";
      confidence = "medium";
      reviewReasons.push("Legacy voicemail rows do not include recording or transcript artifacts.");
      break;
    case "MISSED":
      type = "NO_ANSWER";
      summary = "Legacy missed call imported";
      confidence = "low";
      reviewReasons.push("Legacy MISSED status could represent no-answer, busy, failed, or canceled.");
      break;
    case "RINGING":
    default:
      type = input.direction === "INBOUND" ? "INBOUND_CALL_RECEIVED" : "COMPLETED";
      summary = "Legacy ringing call imported";
      confidence = "low";
      reviewReasons.push("Legacy RINGING status was imported as a best-effort communication event.");
      break;
  }

  if (!input.twilioCallSid) {
    confidence = confidence === "high" ? "medium" : confidence;
    reviewReasons.push("Legacy call is missing a Twilio Call SID.");
  }
  if (!input.leadId) {
    confidence = "low";
    reviewReasons.push("Legacy call is not linked to a lead.");
  }
  if (!input.contactId) {
    confidence = confidence === "high" ? "medium" : confidence;
    reviewReasons.push("Legacy call is not linked to a contact.");
  }

  return {
    type,
    channel: "VOICE",
    occurredAt: input.startedAt,
    summary,
    provider: input.twilioCallSid ? "TWILIO" : "LEGACY_IMPORT",
    providerStatus: input.status,
    providerCallSid: input.twilioCallSid,
    providerMessageSid: null,
    metadataJson: {
      legacyBackfill: true,
      legacyRecordKind: "CALL",
      legacyRecordId: input.id,
      direction: input.direction,
      legacyCallStatus: input.status,
      fromNumberE164: input.fromNumberE164,
      toNumberE164: input.toNumberE164,
      trackingNumberE164: input.trackingNumberE164,
      landingPageUrl: input.landingPageUrl,
      utmCampaign: input.utmCampaign,
      gclid: input.gclid,
      attributionSource: input.attributionSource,
      startedAt: input.startedAt.toISOString(),
      endedAt: input.endedAt ? input.endedAt.toISOString() : null,
      durationSeconds: buildDurationSeconds(input.startedAt, input.endedAt),
      reviewReasons,
    },
    idempotencyKey: buildLegacyBackfillIdempotencyKey("legacy-call", input.orgId, input.id, input.twilioCallSid),
    confidence,
    reviewReasons,
  };
}

export function mapLegacyMessageToCommunicationEvent(input: LegacyMessageBackfillRow): LegacyBackfillResult {
  const reviewReasons: string[] = [];
  let confidence: BackfillConfidence = "high";

  if (!input.providerMessageSid) {
    confidence = "medium";
    reviewReasons.push("Legacy message is missing a provider message SID.");
  }
  if (!input.contactId) {
    confidence = confidence === "high" ? "medium" : confidence;
    reviewReasons.push("Legacy message is not linked to a contact.");
  }

  return {
    type: input.direction === "INBOUND" ? "INBOUND_SMS_RECEIVED" : "OUTBOUND_SMS_SENT",
    channel: "SMS",
    occurredAt: input.createdAt,
    summary: input.direction === "INBOUND" ? "Legacy inbound SMS imported" : "Legacy outbound SMS imported",
    provider: input.provider || "TWILIO",
    providerStatus: input.status,
    providerCallSid: null,
    providerMessageSid: input.providerMessageSid,
    metadataJson: {
      legacyBackfill: true,
      legacyRecordKind: "MESSAGE",
      legacyRecordId: input.id,
      direction: input.direction,
      messageType: input.type,
      body: input.body,
      fromNumberE164: input.fromNumberE164,
      toNumberE164: input.toNumberE164,
      createdAt: input.createdAt.toISOString(),
      reviewReasons,
    },
    idempotencyKey: buildLegacyBackfillIdempotencyKey("legacy-message", input.orgId, input.id, input.providerMessageSid),
    confidence,
    reviewReasons,
  };
}
