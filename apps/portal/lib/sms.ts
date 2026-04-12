import { Prisma, type MessageStatus } from "@prisma/client";
import { normalizeEnvValue } from "./env";
import { prisma } from "@/lib/prisma";
import { startOfUtcMonth } from "@/lib/usage";
import { maybeSendSmsQuotaAlerts } from "@/lib/usage-alerts";
import { checkSlidingWindowLimit } from "@/lib/rate-limit";
import { normalizeE164 } from "@/lib/phone";
import { getTwilioOrgRuntimeConfigByOrgId, sendTwilioMessageWithConfig } from "@/lib/twilio-org";
import { getConfiguredBaseUrl } from "@/lib/urls";
import { mapTwilioLifecycleStatus, shouldAdvanceOutboundSmsLifecycle } from "@/lib/sms-lifecycle";

type SendSmsInput = {
  orgId: string;
  fromNumberE164?: string | null;
  toNumberE164: string;
  body: string;
  allowPendingA2P?: boolean;
};

type SendSmsResult = {
  providerMessageSid: string | null;
  status: MessageStatus;
  resolvedFromNumberE164: string | null;
  notice?: string;
  suppressed?: boolean;
};

function mapTwilioSendStatus(value: string | null | undefined): MessageStatus {
  switch ((value || "").toLowerCase()) {
    case "queued":
      return "QUEUED";
    case "sent":
      return "SENT";
    case "delivered":
      return "DELIVERED";
    case "failed":
    case "undelivered":
      return "FAILED";
    default:
      return "SENT";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function recordString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function buildSmsFailureReason(input: {
  providerStatus: string;
  errorCode?: string | null;
  errorMessage?: string | null;
}): string | null {
  if (input.errorMessage?.trim()) {
    return input.errorMessage.trim();
  }

  if (input.errorCode?.trim()) {
    return `Twilio error ${input.errorCode.trim()}.`;
  }

  const normalizedStatus = input.providerStatus.trim().toLowerCase();
  if (!normalizedStatus) {
    return null;
  }

  return `Twilio reported ${normalizedStatus}.`;
}

export async function reconcileOutboundSmsProviderStatus(input: {
  orgId: string;
  providerMessageSid: string;
  providerStatus: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  occurredAt?: Date;
}): Promise<{ updatedMessages: number; updatedEvents: number }> {
  const normalizedProviderStatus = input.providerStatus.trim().toLowerCase();
  const nextLifecycle = mapTwilioLifecycleStatus(normalizedProviderStatus);
  if (!normalizedProviderStatus || !nextLifecycle) {
    return {
      updatedMessages: 0,
      updatedEvents: 0,
    };
  }

  const [message, communicationEvents] = await Promise.all([
    prisma.message.findFirst({
      where: {
        orgId: input.orgId,
        providerMessageSid: input.providerMessageSid,
      },
      select: {
        id: true,
        status: true,
      },
    }),
    prisma.communicationEvent.findMany({
      where: {
        orgId: input.orgId,
        providerMessageSid: input.providerMessageSid,
      },
      select: {
        id: true,
        providerStatus: true,
        metadataJson: true,
      },
    }),
  ]);

  let updatedMessages = 0;
  if (message && shouldAdvanceOutboundSmsLifecycle(message.status, nextLifecycle)) {
    await prisma.message.update({
      where: {
        id: message.id,
      },
      data: {
        status: nextLifecycle,
      },
    });
    updatedMessages = 1;
  }

  let updatedEvents = 0;
  for (const event of communicationEvents) {
    const metadata = asRecord(event.metadataJson);
    const currentLifecycle = mapTwilioLifecycleStatus(recordString(metadata, "status") || event.providerStatus || null);
    if (!shouldAdvanceOutboundSmsLifecycle(currentLifecycle, nextLifecycle)) {
      continue;
    }

    const hasDispatchContext = Boolean(recordString(metadata, "dispatchJobId"));
    const nextMetadata: Record<string, unknown> = {
      ...(metadata || {}),
      status: nextLifecycle,
      providerStatus: normalizedProviderStatus,
      providerStatusUpdatedAt: (input.occurredAt || new Date()).toISOString(),
      providerErrorCode: input.errorCode?.trim() || null,
      providerErrorMessage: input.errorMessage?.trim() || null,
    };

    if (hasDispatchContext) {
      nextMetadata.dispatchDeliveryState = normalizedProviderStatus;
      nextMetadata.dispatchFailureReason =
        nextLifecycle === "FAILED"
          ? buildSmsFailureReason({
              providerStatus: normalizedProviderStatus,
              errorCode: input.errorCode || null,
              errorMessage: input.errorMessage || null,
            })
          : null;
    }

    await prisma.communicationEvent.update({
      where: {
        id: event.id,
      },
      data: {
        providerStatus: normalizedProviderStatus,
        metadataJson: nextMetadata as Prisma.InputJsonValue,
      },
    });
    updatedEvents += 1;
  }

  return {
    updatedMessages,
    updatedEvents,
  };
}

function isTwilioSendEnabled(): boolean {
  return normalizeEnvValue(process.env.TWILIO_SEND_ENABLED) === "true";
}

export async function sendOutboundSms(input: SendSmsInput): Promise<SendSmsResult> {
  const smsCostEstimateCents = Math.max(
    0,
    Math.round(Number(normalizeEnvValue(process.env.TWILIO_SMS_COST_ESTIMATE_CENTS)) || 1),
  );

  let twilioConfig: Awaited<ReturnType<typeof getTwilioOrgRuntimeConfigByOrgId>>;
  try {
    twilioConfig = await getTwilioOrgRuntimeConfigByOrgId(input.orgId);
  } catch {
    return {
      providerMessageSid: null,
      status: "FAILED",
      resolvedFromNumberE164: null,
      notice: "Twilio config could not be read. Check token encryption settings.",
    };
  }

  if (!twilioConfig) {
    return {
      providerMessageSid: null,
      status: "FAILED",
      resolvedFromNumberE164: null,
      notice: "Twilio is not configured for this organization.",
    };
  }

  const canSendForStatus = twilioConfig.status === "ACTIVE" || input.allowPendingA2P === true;
  if (!canSendForStatus) {
    return {
      providerMessageSid: null,
      status: "FAILED",
      resolvedFromNumberE164: normalizeE164(twilioConfig.phoneNumber) || twilioConfig.phoneNumber,
      notice: `Twilio status is ${twilioConfig.status}. Sending is paused until ACTIVE.`,
    };
  }

  const resolvedFromNumberE164 =
    normalizeE164(input.fromNumberE164 || null) ||
    normalizeE164(twilioConfig.phoneNumber) ||
    twilioConfig.phoneNumber;

  const normalizedToNumber = normalizeE164(input.toNumberE164) || input.toNumberE164;
  const optedOutLead = await prisma.lead.findFirst({
    where: {
      orgId: input.orgId,
      phoneE164: normalizedToNumber,
      status: "DNC",
    },
    select: { id: true },
  });

  if (optedOutLead) {
    return {
      providerMessageSid: null,
      status: "FAILED",
      resolvedFromNumberE164,
      notice: "Suppressed outbound SMS because the contact is opted out.",
      suppressed: true,
    };
  }

  // Safe default for development: persist outbound rows without calling Twilio.
  if (!isTwilioSendEnabled()) {
    return {
      providerMessageSid: null,
      status: "QUEUED",
      resolvedFromNumberE164,
      notice: "Twilio sending is disabled. Message saved in CRM and marked QUEUED.",
    };
  }

  const toRate = await checkSlidingWindowLimit({
    identifier: `${input.orgId}:${input.toNumberE164}`,
    prefix: "rl:sms:to",
    limit: 6,
    windowSeconds: 60,
  });

  if (!toRate.ok) {
    return {
      providerMessageSid: null,
      status: "FAILED",
      resolvedFromNumberE164,
      notice: "Too many messages to this number. Try again in a minute.",
    };
  }

  const organization = await prisma.organization.findUnique({
    where: { id: input.orgId },
    select: {
      smsMonthlyLimit: true,
      smsHardStop: true,
    },
  });

  if (!organization) {
    return {
      providerMessageSid: null,
      status: "FAILED",
      resolvedFromNumberE164,
      notice: "Organization not found.",
    };
  }

  const limit = organization.smsMonthlyLimit || 0;
  const hardStop = organization.smsHardStop ?? true;
  const periodStart = startOfUtcMonth(new Date());

  await prisma.organizationUsage.upsert({
    where: { orgId_periodStart: { orgId: input.orgId, periodStart } },
    create: { orgId: input.orgId, periodStart },
    update: {},
  });

  if (limit > 0 && hardStop) {
    const updated = await prisma.organizationUsage.updateMany({
      where: {
        orgId: input.orgId,
        periodStart,
        smsSentCount: { lt: limit },
      },
      data: {
        smsSentCount: { increment: 1 },
        smsCostEstimateCents: { increment: smsCostEstimateCents },
      },
    });

    if (updated.count === 0) {
      return {
        providerMessageSid: null,
        status: "FAILED",
        resolvedFromNumberE164,
        notice: `SMS quota exceeded (${limit}/month). Sending blocked to prevent surprise charges.`,
      };
    }
  } else {
    await prisma.organizationUsage.updateMany({
      where: { orgId: input.orgId, periodStart },
      data: {
        smsSentCount: { increment: 1 },
        smsCostEstimateCents: { increment: smsCostEstimateCents },
      },
    });
  }

  const usage = await prisma.organizationUsage.findUnique({
    where: { orgId_periodStart: { orgId: input.orgId, periodStart } },
    select: { smsSentCount: true },
  });

  if (usage && limit > 0) {
    try {
      await maybeSendSmsQuotaAlerts({
        orgId: input.orgId,
        periodStart,
        used: usage.smsSentCount,
        limit,
      });
    } catch (error) {
      console.warn("Failed to send SMS quota alert email.", error);
    }
  }

  const providerResponse = await sendTwilioMessageWithConfig({
    config: {
      twilioSubaccountSid: twilioConfig.twilioSubaccountSid,
      twilioAuthToken: twilioConfig.twilioAuthToken,
      messagingServiceSid: twilioConfig.messagingServiceSid,
    },
    toNumberE164: input.toNumberE164,
    body: input.body,
    statusCallbackUrl: (() => {
      const baseUrl = getConfiguredBaseUrl();
      return baseUrl ? `${baseUrl}/api/webhooks/twilio/sms/status` : null;
    })(),
  });

  if (!providerResponse.ok) {
    return {
      providerMessageSid: providerResponse.providerMessageSid,
      status: "FAILED",
      resolvedFromNumberE164,
      notice: providerResponse.error,
    };
  }

  return {
    providerMessageSid: providerResponse.providerMessageSid,
    status: mapTwilioSendStatus(providerResponse.providerStatus),
    resolvedFromNumberE164,
  };
}
