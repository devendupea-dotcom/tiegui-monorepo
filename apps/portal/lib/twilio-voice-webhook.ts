import type { CallDirection, CallStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeEnvValue } from "@/lib/env";
import { normalizeE164 } from "@/lib/phone";
import {
  queueConversationalIntroForQuietHours,
  startConversationalSmsFromMissedCall,
} from "@/lib/conversational-sms";
import { isWithinSmsSendWindow, nextSmsSendWindowStartUtc } from "@/lib/sms-quiet-hours";
import { validateTwilioWebhook } from "@/lib/twilio";
import { decryptTwilioAuthToken, maskSid } from "@/lib/twilio-config-crypto";
import { resolveTwilioVoiceForwardingNumber } from "@/lib/twilio-org";

type VoiceOrganization = {
  id: string;
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

export function mapVoiceCallStatus(value: string): CallStatus {
  const normalized = value.trim().toLowerCase();
  if (normalized === "completed" || normalized === "in-progress") {
    return "ANSWERED";
  }
  if (
    normalized === "no-answer" ||
    normalized === "busy" ||
    normalized === "failed" ||
    normalized === "canceled"
  ) {
    return "MISSED";
  }
  return "RINGING";
}

export function mapDialCallStatus(value: string): CallStatus | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "answered" || normalized === "completed") {
    return "ANSWERED";
  }
  if (
    normalized === "no-answer" ||
    normalized === "busy" ||
    normalized === "failed" ||
    normalized === "canceled"
  ) {
    return "MISSED";
  }
  return null;
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

export async function recordVoiceDialOutcome(input: {
  context: TwilioVoiceWebhookContext;
  form: FormData;
}) {
  const { context, form } = input;
  const callSid = asTwilioString(form.get("CallSid")) || null;
  const fromNumber = normalizeE164(asTwilioString(form.get("From")));
  const toNumber =
    normalizeE164(asTwilioString(form.get("To"))) ||
    normalizeE164(asTwilioString(form.get("Called"))) ||
    normalizeE164(context.twilioConfig.phoneNumber);
  const direction = mapVoiceCallDirection(asTwilioString(form.get("Direction")), "INBOUND");
  const mappedStatus =
    mapDialCallStatus(asTwilioString(form.get("DialCallStatus"))) ||
    mapVoiceCallStatus(asTwilioString(form.get("CallStatus")));
  const startedAtRaw = asTwilioString(form.get("Timestamp"));
  const startedAt = startedAtRaw ? new Date(startedAtRaw) : new Date();
  const now = new Date();

  if (!toNumber) {
    return { status: mappedStatus, leadId: null as string | null };
  }

  const senderNumber = normalizeE164(context.twilioConfig.phoneNumber) || context.organization.smsFromNumberE164;
  const calendarTimezone = getVoiceCalendarTimezone(context);

  let leadId: string | null = null;
  if (fromNumber && direction === "INBOUND") {
    const lead = await prisma.lead.findFirst({
      where: {
        orgId: context.organization.id,
        phoneE164: fromNumber,
      },
      select: {
        id: true,
        firstContactedAt: true,
      },
    });

    if (!lead) {
      const createdLead = await prisma.lead.create({
        data: {
          orgId: context.organization.id,
          phoneE164: fromNumber,
          preferredLanguage: context.organization.messageLanguage === "ES" ? "ES" : null,
          status: "NEW",
          leadSource: "CALL",
          firstContactedAt: now,
          lastContactedAt: now,
        },
        select: { id: true },
      });
      leadId = createdLead.id;
    } else {
      leadId = lead.id;
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          firstContactedAt: lead.firstContactedAt || now,
          lastContactedAt: now,
        },
      });
    }
  }

  let existingCallStatus: CallStatus | null = null;
  if (callSid) {
    const existingCall = await prisma.call.findUnique({
      where: { twilioCallSid: callSid },
      select: { status: true },
    });
    existingCallStatus = existingCall?.status || null;

    await prisma.call.upsert({
      where: { twilioCallSid: callSid },
      update: {
        orgId: context.organization.id,
        leadId,
        fromNumberE164: fromNumber || "",
        toNumberE164: toNumber,
        trackingNumberE164: toNumber,
        direction,
        status: mappedStatus,
        endedAt: mappedStatus === "RINGING" ? null : now,
      },
      create: {
        orgId: context.organization.id,
        leadId,
        fromNumberE164: fromNumber || "",
        toNumberE164: toNumber,
        trackingNumberE164: toNumber,
        direction,
        status: mappedStatus,
        twilioCallSid: callSid,
        startedAt: Number.isNaN(startedAt.getTime()) ? now : startedAt,
        endedAt: mappedStatus === "RINGING" ? null : now,
      },
    });
  } else {
    await prisma.call.create({
      data: {
        orgId: context.organization.id,
        leadId,
        fromNumberE164: fromNumber || "",
        toNumberE164: toNumber,
        trackingNumberE164: toNumber,
        direction,
        status: mappedStatus,
        startedAt: Number.isNaN(startedAt.getTime()) ? now : startedAt,
        endedAt: mappedStatus === "RINGING" ? null : now,
      },
    });
  }

  const isMissedInboundCall =
    direction === "INBOUND" &&
    mappedStatus === "MISSED" &&
    existingCallStatus !== "MISSED";

  const eligibleForReply =
    isMissedInboundCall &&
    Boolean(context.organization.missedCallAutoReplyOn) &&
    Boolean(senderNumber) &&
    Boolean(fromNumber) &&
    Boolean(leadId);

  if (eligibleForReply) {
    const inAllowedWindow = isWithinSmsSendWindow({
      at: now,
      timeZone: calendarTimezone,
      startMinute: context.organization.smsQuietHoursStartMinute,
      endMinute: context.organization.smsQuietHoursEndMinute,
    });

    if (inAllowedWindow) {
      await startConversationalSmsFromMissedCall({
        orgId: context.organization.id,
        leadId: leadId as string,
        toNumberE164: fromNumber as string,
      });
    } else {
      const sendAfterAt = nextSmsSendWindowStartUtc({
        at: now,
        timeZone: calendarTimezone,
        startMinute: context.organization.smsQuietHoursStartMinute,
        endMinute: context.organization.smsQuietHoursEndMinute,
      });
      await queueConversationalIntroForQuietHours({
        orgId: context.organization.id,
        leadId: leadId as string,
        toNumberE164: fromNumber as string,
        sendAfterAt,
      });
    }
  }

  return { status: mappedStatus, leadId };
}

export function maskTwilioAccountSid(value: string | null | undefined): string {
  return maskSid(value);
}
