import type { CallDirection, CallStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildCommunicationIdempotencyKey, upsertCommunicationEvent, upsertVoicemailArtifact } from "@/lib/communication-events";
import { normalizeEnvValue } from "@/lib/env";
import { ensureLeadAndContactForInboundPhone } from "@/lib/lead-contact-resolution";
import type { InboundCallRiskAssessment } from "@/lib/inbound-call-risk";
import { processMissedCallRecovery } from "@/lib/missed-call-recovery";
import { normalizeE164 } from "@/lib/phone";
import { validateTwilioWebhook } from "@/lib/twilio";
import {
  buildTwilioVoiceEvent,
  mapCommunicationEventToLegacyCallStatus,
  mapTwilioTranscriptionStatus,
  normalizeTwilioVoiceOutcomeEvents,
  parseTwilioVoiceSnapshot,
  type NormalizedTwilioVoiceEvent,
  type TwilioVoiceSnapshot,
} from "@/lib/twilio-communication-events";
import { decryptTwilioAuthToken, maskSid } from "@/lib/twilio-config-crypto";
import { resolveTwilioVoiceForwardingNumber } from "@/lib/twilio-org";

type VoiceOrganization = {
  id: string;
  name: string;
  smsFromNumberE164: string | null;
  smsQuietHoursStartMinute: number;
  smsQuietHoursEndMinute: number;
  messageLanguage: "EN" | "ES" | "AUTO";
  missedCallAutoReplyOn: boolean;
  dashboardConfig: {
    calendarTimezone: string | null;
  } | null;
};

type VoiceConfigRecord = {
  id: string;
  organizationId: string;
  twilioSubaccountSid: string;
  twilioAuthTokenEncrypted: string;
  phoneNumber: string;
  voiceForwardingNumber: string | null;
  status: "PENDING_A2P" | "ACTIVE" | "PAUSED";
  organization: VoiceOrganization;
};

export type TwilioVoiceWebhookContext = {
  twilioConfig: {
    id: string;
    organizationId: string;
    twilioSubaccountSid: string;
    phoneNumber: string;
    voiceForwardingNumber: string | null;
    status: "PENDING_A2P" | "ACTIVE" | "PAUSED";
  };
  organization: VoiceOrganization;
  authToken: string | null;
};

type VoiceCallRecord = {
  id: string;
  leadId: string | null;
};

const voiceConfigSelect = {
  id: true,
  organizationId: true,
  twilioSubaccountSid: true,
  twilioAuthTokenEncrypted: true,
  phoneNumber: true,
  voiceForwardingNumber: true,
  status: true,
  organization: {
    select: {
      id: true,
      name: true,
      smsFromNumberE164: true,
      smsQuietHoursStartMinute: true,
      smsQuietHoursEndMinute: true,
      messageLanguage: true,
      missedCallAutoReplyOn: true,
      dashboardConfig: {
        select: {
          calendarTimezone: true,
        },
      },
    },
  },
} satisfies Prisma.OrganizationTwilioConfigSelect;

export function asTwilioString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

export function twimlResponse(body: string) {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    status: 200,
    headers: {
      "content-type": "text/xml; charset=utf-8",
    },
  });
}

export function emptyTwimlResponse() {
  return twimlResponse("");
}

export function shouldValidateTwilioSignatures(): boolean {
  return normalizeEnvValue(process.env.TWILIO_VALIDATE_SIGNATURE) === "true";
}

async function getVoiceConfigByCalledNumber(toNumber: string | null): Promise<VoiceConfigRecord | null> {
  if (!toNumber) return null;

  return prisma.organizationTwilioConfig.findFirst({
    where: {
      OR: [
        { phoneNumber: toNumber },
        { organization: { smsFromNumberE164: toNumber } },
      ],
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: voiceConfigSelect,
  }) as Promise<VoiceConfigRecord | null>;
}

async function getVoiceConfigByAccountSid(accountSid: string): Promise<VoiceConfigRecord | null> {
  if (!accountSid) return null;

  return prisma.organizationTwilioConfig.findUnique({
    where: { twilioSubaccountSid: accountSid },
    select: voiceConfigSelect,
  }) as Promise<VoiceConfigRecord | null>;
}

export async function resolveTwilioVoiceWebhookContext(form: FormData): Promise<TwilioVoiceWebhookContext | null> {
  const toNumber = normalizeE164(asTwilioString(form.get("To"))) || normalizeE164(asTwilioString(form.get("Called")));
  const accountSid = asTwilioString(form.get("AccountSid"));

  const config = (await getVoiceConfigByCalledNumber(toNumber)) || (await getVoiceConfigByAccountSid(accountSid));
  if (!config) {
    return null;
  }

  let authToken: string | null = null;
  if (shouldValidateTwilioSignatures()) {
    authToken = decryptTwilioAuthToken(config.twilioAuthTokenEncrypted);
  }

  return {
    twilioConfig: {
      id: config.id,
      organizationId: config.organizationId,
      twilioSubaccountSid: config.twilioSubaccountSid,
      phoneNumber: config.phoneNumber,
      voiceForwardingNumber: config.voiceForwardingNumber,
      status: config.status,
    },
    organization: config.organization,
    authToken,
  };
}

export function validateTwilioVoiceWebhookRequest(
  req: Request,
  form: FormData,
  context: TwilioVoiceWebhookContext,
) {
  return validateTwilioWebhook(req, form, { authToken: context.authToken });
}

export function mapVoiceCallDirection(value: string, fallback: CallDirection = "INBOUND"): CallDirection {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return normalized.includes("inbound") ? "INBOUND" : "OUTBOUND";
}

function voiceEventKey(snapshot: TwilioVoiceSnapshot, type: string, ...parts: Array<string | number | null | undefined>) {
  return buildCommunicationIdempotencyKey(
    "voice-event",
    snapshot.callSid || snapshot.parentCallSid || "unknown",
    type,
    ...parts,
  );
}

async function upsertVoiceCallRecord(
  tx: Prisma.TransactionClient,
  input: {
    context: TwilioVoiceWebhookContext;
    callSid: string | null;
    leadId: string | null;
    fromNumber: string | null;
    toNumber: string;
    direction: CallDirection;
    status: CallStatus;
    startedAt: Date;
    endedAt: Date | null;
  },
): Promise<VoiceCallRecord> {
  const baseData = {
    orgId: input.context.organization.id,
    leadId: input.leadId,
    fromNumberE164: input.fromNumber || "",
    toNumberE164: input.toNumber,
    trackingNumberE164: input.toNumber,
    direction: input.direction,
    status: input.status,
    startedAt: Number.isNaN(input.startedAt.getTime()) ? new Date() : input.startedAt,
    endedAt: input.endedAt,
  };

  if (input.callSid) {
    return tx.call.upsert({
      where: { twilioCallSid: input.callSid },
      update: baseData,
      create: {
        ...baseData,
        twilioCallSid: input.callSid,
      },
      select: {
        id: true,
        leadId: true,
      },
    });
  }

  return tx.call.create({
    data: baseData,
    select: {
      id: true,
      leadId: true,
    },
  });
}

async function persistVoiceCommunicationEvent(
  tx: Prisma.TransactionClient,
  input: {
    context: TwilioVoiceWebhookContext;
    leadId?: string | null;
    contactId?: string | null;
    callId?: string | null;
    event: NormalizedTwilioVoiceEvent;
    snapshot: TwilioVoiceSnapshot;
    occurredAt: Date;
    idempotencyKey: string;
  },
) {
  return upsertCommunicationEvent(tx, {
    orgId: input.context.organization.id,
    leadId: input.leadId || null,
    contactId: input.contactId || null,
    callId: input.callId || null,
    type: input.event.type,
    channel: "VOICE",
    occurredAt: input.occurredAt,
    summary: input.event.summary,
    metadataJson: input.event.metadata,
    provider: "TWILIO",
    providerCallSid: input.snapshot.callSid,
    providerParentCallSid: input.snapshot.parentCallSid,
    providerStatus: input.event.providerStatus,
    idempotencyKey: input.idempotencyKey,
  });
}

function voiceRiskMetadata(riskAssessment: InboundCallRiskAssessment | null | undefined) {
  if (!riskAssessment) {
    return undefined;
  }

  return {
    riskScore: riskAssessment.score,
    riskDisposition: riskAssessment.disposition,
    riskReasons: riskAssessment.reasons,
    stirVerstat: riskAssessment.stirVerstat,
    distinctRecentOrgCount: riskAssessment.distinctRecentOrgCount,
    recentCallCount: riskAssessment.recentCallCount,
    recentMissedCount: riskAssessment.recentMissedCount,
    trustedKnownCaller: riskAssessment.trustedKnownCaller,
  };
}

export async function trackVoiceCallStart(input: {
  context: TwilioVoiceWebhookContext;
  form: FormData;
  riskAssessment?: InboundCallRiskAssessment | null;
  allowLeadCreation?: boolean;
}) {
  const { context, form } = input;
  const callSid = asTwilioString(form.get("CallSid")) || null;
  const fromNumber = normalizeE164(asTwilioString(form.get("From")));
  const toNumber =
    normalizeE164(asTwilioString(form.get("To"))) ||
    normalizeE164(asTwilioString(form.get("Called"))) ||
    normalizeE164(context.twilioConfig.phoneNumber);
  const direction = mapVoiceCallDirection(asTwilioString(form.get("Direction")), "INBOUND");
  const snapshot = parseTwilioVoiceSnapshot({ form });

  if (!toNumber) {
    return {
      leadId: null as string | null,
      contactId: null as string | null,
      callId: null as string | null,
      status: "RINGING" as CallStatus,
    };
  }

  return prisma.$transaction(async (tx) => {
    const resolved =
      direction === "INBOUND"
        ? await ensureLeadAndContactForInboundPhone(tx, {
            orgId: context.organization.id,
            phoneE164: fromNumber,
            at: snapshot.timestamp,
            preferredLanguage: context.organization.messageLanguage === "ES" ? "ES" : null,
            leadSource: "CALL",
            allowCreateLead: input.allowLeadCreation,
          })
        : { leadId: null, contactId: null };

    const call = await upsertVoiceCallRecord(tx, {
      context,
      callSid,
      leadId: resolved.leadId,
      fromNumber,
      toNumber,
      direction,
      status: "RINGING",
      startedAt: snapshot.timestamp,
      endedAt: null,
    });

    await persistVoiceCommunicationEvent(tx, {
      context,
      leadId: resolved.leadId,
      contactId: resolved.contactId,
      callId: call.id,
      snapshot,
      event: buildTwilioVoiceEvent({
        type: "INBOUND_CALL_RECEIVED",
        snapshot,
        extraMetadata: voiceRiskMetadata(input.riskAssessment),
      }),
      occurredAt: snapshot.timestamp,
      idempotencyKey: voiceEventKey(snapshot, "INBOUND_CALL_RECEIVED"),
    });

    return {
      leadId: resolved.leadId,
      contactId: resolved.contactId,
      callId: call.id,
      status: "RINGING" as CallStatus,
    };
  });
}

export function getVoiceCalendarTimezone(context: TwilioVoiceWebhookContext): string {
  return context.organization.dashboardConfig?.calendarTimezone || "America/Los_Angeles";
}

export async function resolveForwardTarget(context: TwilioVoiceWebhookContext): Promise<string | null> {
  return resolveTwilioVoiceForwardingNumber({
    organizationId: context.twilioConfig.organizationId,
    configuredNumber: context.twilioConfig.voiceForwardingNumber,
  });
}

export async function recordVoiceForwarding(input: {
  context: TwilioVoiceWebhookContext;
  form: FormData;
  leadId?: string | null;
  contactId?: string | null;
  callId?: string | null;
  forwardedTo: string;
}) {
  const snapshot = parseTwilioVoiceSnapshot({
    form: input.form,
    forwardedTo: input.forwardedTo,
  });

  return prisma.$transaction(async (tx) =>
    persistVoiceCommunicationEvent(tx, {
      context: input.context,
      leadId: input.leadId || null,
      contactId: input.contactId || null,
      callId: input.callId || null,
      snapshot,
      event: buildTwilioVoiceEvent({
        type: "FORWARDED_TO_OWNER",
        snapshot,
      }),
      occurredAt: new Date(),
      idempotencyKey: voiceEventKey(snapshot, "FORWARDED_TO_OWNER", input.forwardedTo),
    }),
  );
}

export async function recordVoiceVoicemailReached(input: {
  context: TwilioVoiceWebhookContext;
  form: FormData;
  leadId?: string | null;
  contactId?: string | null;
  callId?: string | null;
  reason: string;
  forwardedTo?: string | null;
  riskAssessment?: InboundCallRiskAssessment | null;
}) {
  const snapshot = parseTwilioVoiceSnapshot({
    form: input.form,
    forwardedTo: input.forwardedTo || null,
    voicemailFallbackStage: true,
  });

  return prisma.$transaction(async (tx) =>
    persistVoiceCommunicationEvent(tx, {
      context: input.context,
      leadId: input.leadId || null,
      contactId: input.contactId || null,
      callId: input.callId || null,
      snapshot,
      event: buildTwilioVoiceEvent({
        type: "VOICEMAIL_REACHED",
        snapshot,
        extraMetadata: {
          reason: input.reason,
          ...(voiceRiskMetadata(input.riskAssessment) || {}),
        },
      }),
      occurredAt: new Date(),
      idempotencyKey: voiceEventKey(snapshot, "VOICEMAIL_REACHED", input.reason),
    }),
  );
}

export async function recordVoiceDialOutcome(input: {
  context: TwilioVoiceWebhookContext;
  form: FormData;
  voicemailFallbackStage?: boolean;
  skipMissedCallRecovery?: boolean;
  riskAssessment?: InboundCallRiskAssessment | null;
  allowLeadCreation?: boolean;
}) {
  const { context, form } = input;
  const callSid = asTwilioString(form.get("CallSid")) || null;
  const fromNumber = normalizeE164(asTwilioString(form.get("From")));
  const toNumber =
    normalizeE164(asTwilioString(form.get("To"))) ||
    normalizeE164(asTwilioString(form.get("Called"))) ||
    normalizeE164(context.twilioConfig.phoneNumber);
  const direction = mapVoiceCallDirection(asTwilioString(form.get("Direction")), "INBOUND");
  const snapshot = parseTwilioVoiceSnapshot({
    form,
    voicemailFallbackStage: input.voicemailFallbackStage,
  });
  const normalizedEvents = normalizeTwilioVoiceOutcomeEvents(snapshot);
  const finalEvent =
    normalizedEvents[normalizedEvents.length - 1] ||
    buildTwilioVoiceEvent({
      type: "FAILED",
      snapshot,
      extraMetadata: {
        normalizationFallback: "empty",
      },
    });
  const mappedStatus = mapCommunicationEventToLegacyCallStatus(finalEvent.type);
  const now = new Date();

  if (!toNumber) {
    return {
      status: mappedStatus,
      leadId: null as string | null,
      contactId: null as string | null,
      callId: null as string | null,
      eventTypes: normalizedEvents.map((event) => event.type),
    };
  }

  const persisted = await prisma.$transaction(async (tx) => {
    const existingCall = callSid
      ? await tx.call.findUnique({
          where: { twilioCallSid: callSid },
          select: {
            id: true,
            leadId: true,
          },
        })
      : null;

    const resolved =
      direction === "INBOUND"
        ? await ensureLeadAndContactForInboundPhone(tx, {
            orgId: context.organization.id,
            phoneE164: fromNumber,
            at: now,
            preferredLanguage: context.organization.messageLanguage === "ES" ? "ES" : null,
            leadSource: "CALL",
            existingLeadId: existingCall?.leadId || null,
            allowCreateLead: input.allowLeadCreation,
          })
        : { leadId: existingCall?.leadId || null, contactId: null };

    const call = await upsertVoiceCallRecord(tx, {
      context,
      callSid,
      leadId: resolved.leadId,
      fromNumber,
      toNumber,
      direction,
      status: mappedStatus,
      startedAt: snapshot.timestamp,
      endedAt: mappedStatus === "RINGING" ? null : now,
    });

    const persistedEvents = [];
    for (const event of normalizedEvents) {
      const persistedEvent = await persistVoiceCommunicationEvent(tx, {
        context,
        leadId: resolved.leadId,
        contactId: resolved.contactId,
        callId: call.id,
        snapshot,
        event: {
          ...event,
          metadata: {
            ...(event.metadata || {}),
            ...(voiceRiskMetadata(input.riskAssessment) || {}),
          },
        },
        occurredAt: now,
        idempotencyKey: voiceEventKey(
          snapshot,
          event.type,
          snapshot.recordingSid,
          snapshot.rawDialCallStatus,
          snapshot.rawCallStatus,
        ),
      });
      persistedEvents.push(persistedEvent);
    }

    const voicemailEvent = normalizedEvents.find((event) => event.type === "VOICEMAIL_LEFT");
    if (voicemailEvent) {
      const persistedVoicemailEvent = persistedEvents.find((event) => event.type === "VOICEMAIL_LEFT");
      if (persistedVoicemailEvent) {
        await upsertVoicemailArtifact(tx, {
          orgId: context.organization.id,
          leadId: resolved.leadId,
          contactId: resolved.contactId,
          callId: call.id,
          communicationEventId: persistedVoicemailEvent.id,
          providerCallSid: snapshot.callSid,
          recordingSid: snapshot.recordingSid,
          recordingUrl: snapshot.recordingUrl,
          recordingDurationSeconds: snapshot.recordingDurationSeconds,
          transcriptionStatus: mapTwilioTranscriptionStatus(snapshot.transcriptionStatus),
          transcriptionText: snapshot.transcriptionText,
          voicemailAt: now,
          metadataJson: {
            eventSummary: voicemailEvent.summary,
            payload: snapshot.payload,
          },
        });
      }
    }

    return {
      leadId: resolved.leadId,
      contactId: resolved.contactId,
      callId: call.id,
      eventTypes: normalizedEvents.map((event) => event.type),
    };
  });

  const shouldProcessMissedCallRecovery =
    !input.skipMissedCallRecovery &&
    direction === "INBOUND" &&
    Boolean(persisted.leadId) &&
    Boolean(fromNumber) &&
    persisted.eventTypes.some((type) => ["NO_ANSWER", "BUSY", "FAILED", "CANCELED", "ABANDONED"].includes(type));

  console.info(
    `[twilio:voice] dial completed callSid=${callSid || "unknown"} orgId=${context.organization.id} status=${mappedStatus} dialStatus=${snapshot.rawDialCallStatus || "unknown"} callStatus=${snapshot.rawCallStatus || "unknown"} events=${persisted.eventTypes.join(",") || "none"} triggerSms=${shouldProcessMissedCallRecovery ? "candidate" : "no"}`,
  );

  if (shouldProcessMissedCallRecovery) {
    await processMissedCallRecovery({
      orgId: context.organization.id,
      leadId: persisted.leadId as string,
      contactId: persisted.contactId,
      callId: persisted.callId,
      callSid,
      fromNumberE164: fromNumber,
      toNumberE164: toNumber,
      occurredAt: now,
      source: "realtime",
    });
  }

  return {
    status: mappedStatus,
    leadId: persisted.leadId,
    contactId: persisted.contactId,
    callId: persisted.callId,
    eventTypes: persisted.eventTypes,
  };
}

export function maskTwilioAccountSid(value: string | null | undefined): string {
  return maskSid(value);
}
