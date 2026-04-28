import type { CallStatus, CommunicationEventType, Prisma, VoicemailTranscriptionStatus } from "@prisma/client";
import { normalizeE164 } from "@/lib/phone";

export type TwilioVoiceSnapshot = {
  callSid: string | null;
  parentCallSid: string | null;
  from: string | null;
  to: string | null;
  forwardedTo: string | null;
  timestamp: Date;
  durationSeconds: number | null;
  rawCallStatus: string | null;
  rawDialCallStatus: string | null;
  recordingSid: string | null;
  recordingUrl: string | null;
  recordingDurationSeconds: number | null;
  transcriptionStatus: string | null;
  transcriptionText: string | null;
  voicemailFallbackStage: boolean;
  payload: Record<string, string>;
};

export type NormalizedTwilioVoiceEvent = {
  type: CommunicationEventType;
  summary: string;
  providerStatus: string | null;
  metadata: Prisma.InputJsonObject;
};

function normalizeTwilioStatus(value: string | null | undefined): string | null {
  const normalized = `${value || ""}`.trim().toLowerCase();
  return normalized || null;
}

function parseInteger(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTimestamp(value: string | null | undefined): Date {
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function extractFormPayload(form: FormData) {
  const payload: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      payload[key] = value.trim();
    }
  }
  return payload;
}

function eventSummary(type: CommunicationEventType, snapshot: TwilioVoiceSnapshot) {
  switch (type) {
    case "INBOUND_CALL_RECEIVED":
      return "Inbound call received";
    case "FORWARDED_TO_OWNER":
      return snapshot.forwardedTo ? `Forwarded to ${snapshot.forwardedTo}` : "Forwarded to owner";
    case "OWNER_ANSWERED":
      return snapshot.forwardedTo ? `Owner answered at ${snapshot.forwardedTo}` : "Owner answered";
    case "NO_ANSWER":
      return "Owner did not answer";
    case "BUSY":
      return "Forwarding target was busy";
    case "FAILED":
      return "Call forwarding failed";
    case "CANCELED":
      return "Call forwarding was canceled";
    case "COMPLETED":
      return snapshot.durationSeconds !== null
        ? `Call completed in ${snapshot.durationSeconds}s`
        : "Call completed";
    case "VOICEMAIL_REACHED":
      return "Voicemail greeting reached";
    case "VOICEMAIL_LEFT":
      return "Voicemail left";
    case "ABANDONED":
      return "Caller abandoned before leaving voicemail";
    default:
      return "Communication event";
  }
}

export function parseTwilioVoiceSnapshot(input: {
  form: FormData;
  forwardedTo?: string | null;
  voicemailFallbackStage?: boolean;
}) {
  const payload = extractFormPayload(input.form);
  return {
    callSid: payload.CallSid || null,
    parentCallSid: payload.ParentCallSid || null,
    from: normalizeE164(payload.From || null),
    to: normalizeE164(payload.To || payload.Called || null),
    forwardedTo: normalizeE164(input.forwardedTo || null) || input.forwardedTo || null,
    timestamp: parseTimestamp(payload.Timestamp || payload.CallTimestamp || null),
    durationSeconds: parseInteger(payload.CallDuration || payload.DialCallDuration || null),
    rawCallStatus: normalizeTwilioStatus(payload.CallStatus),
    rawDialCallStatus: normalizeTwilioStatus(payload.DialCallStatus),
    recordingSid: payload.RecordingSid || null,
    recordingUrl: payload.RecordingUrl || null,
    recordingDurationSeconds: parseInteger(payload.RecordingDuration || null),
    transcriptionStatus: normalizeTwilioStatus(payload.TranscriptionStatus),
    transcriptionText: payload.TranscriptionText || null,
    voicemailFallbackStage: Boolean(input.voicemailFallbackStage),
    payload,
  } satisfies TwilioVoiceSnapshot;
}

function baseMetadata(snapshot: TwilioVoiceSnapshot) {
  return {
    callSid: snapshot.callSid,
    parentCallSid: snapshot.parentCallSid,
    from: snapshot.from,
    to: snapshot.to,
    forwardedTo: snapshot.forwardedTo,
    rawCallStatus: snapshot.rawCallStatus,
    rawDialCallStatus: snapshot.rawDialCallStatus,
    durationSeconds: snapshot.durationSeconds,
    recordingSid: snapshot.recordingSid,
    recordingUrl: snapshot.recordingUrl,
    recordingDurationSeconds: snapshot.recordingDurationSeconds,
    transcriptionStatus: snapshot.transcriptionStatus,
    transcriptionText: snapshot.transcriptionText,
    voicemailFallbackStage: snapshot.voicemailFallbackStage,
    payload: snapshot.payload,
  } satisfies Prisma.InputJsonObject;
}

export function buildTwilioVoiceEvent(input: {
  type: CommunicationEventType;
  snapshot: TwilioVoiceSnapshot;
  extraMetadata?: Record<string, unknown>;
}) {
  return {
    type: input.type,
    summary: eventSummary(input.type, input.snapshot),
    providerStatus: input.snapshot.rawDialCallStatus || input.snapshot.rawCallStatus,
    metadata: {
      ...baseMetadata(input.snapshot),
      ...(input.extraMetadata || {}),
    } as Prisma.InputJsonObject,
  } satisfies NormalizedTwilioVoiceEvent;
}

export function normalizeTwilioVoiceOutcomeEvents(snapshot: TwilioVoiceSnapshot): NormalizedTwilioVoiceEvent[] {
  if (snapshot.recordingSid || snapshot.recordingUrl) {
    return [buildTwilioVoiceEvent({ type: "VOICEMAIL_LEFT", snapshot })];
  }

  if (snapshot.voicemailFallbackStage) {
    return [buildTwilioVoiceEvent({ type: "ABANDONED", snapshot })];
  }

  const status = snapshot.rawDialCallStatus || snapshot.rawCallStatus;
  switch (status) {
    case "answered":
      return [
        buildTwilioVoiceEvent({ type: "OWNER_ANSWERED", snapshot }),
        buildTwilioVoiceEvent({ type: "COMPLETED", snapshot }),
      ];
    case "completed":
      if ((snapshot.durationSeconds || 0) > 0) {
        return [
          buildTwilioVoiceEvent({ type: "OWNER_ANSWERED", snapshot }),
          buildTwilioVoiceEvent({ type: "COMPLETED", snapshot }),
        ];
      }
      return [buildTwilioVoiceEvent({ type: "COMPLETED", snapshot })];
    case "no-answer":
      return [buildTwilioVoiceEvent({ type: "NO_ANSWER", snapshot })];
    case "busy":
      return [buildTwilioVoiceEvent({ type: "BUSY", snapshot })];
    case "failed":
      return [buildTwilioVoiceEvent({ type: "FAILED", snapshot })];
    case "canceled":
      return [buildTwilioVoiceEvent({ type: "CANCELED", snapshot })];
    default:
      if ((snapshot.durationSeconds || 0) > 0) {
        return [buildTwilioVoiceEvent({ type: "COMPLETED", snapshot })];
      }
      return [buildTwilioVoiceEvent({ type: "FAILED", snapshot, extraMetadata: { normalizationFallback: true } })];
  }
}

export function mapCommunicationEventToLegacyCallStatus(type: CommunicationEventType): CallStatus {
  switch (type) {
    case "OWNER_ANSWERED":
    case "COMPLETED":
      return "ANSWERED";
    case "VOICEMAIL_REACHED":
    case "VOICEMAIL_LEFT":
      return "VOICEMAIL";
    case "NO_ANSWER":
    case "BUSY":
    case "FAILED":
    case "CANCELED":
    case "ABANDONED":
      return "MISSED";
    default:
      return "RINGING";
  }
}

export function mapTwilioTranscriptionStatus(value: string | null | undefined): VoicemailTranscriptionStatus | null {
  switch (normalizeTwilioStatus(value)) {
    case "completed":
      return "COMPLETED";
    case "failed":
    case "absent":
      return "FAILED";
    case "in-progress":
    case "queued":
      return "PENDING";
    default:
      return null;
  }
}
