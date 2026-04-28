import type { MessageStatus } from "@prisma/client";
import { normalizeEnvValue } from "./env";
import { prisma } from "@/lib/prisma";
import { startOfUtcMonth } from "@/lib/usage";
import { maybeSendSmsQuotaAlerts } from "@/lib/usage-alerts";
import { checkSlidingWindowLimit } from "@/lib/rate-limit";
import { normalizeE164 } from "@/lib/phone";
import { getTwilioOrgRuntimeConfigByOrgId, sendTwilioMessageWithConfig } from "@/lib/twilio-org";
import { getConfiguredBaseUrl } from "@/lib/urls";
import {
  mapTwilioInitialSendStatus,
} from "@/lib/sms-lifecycle";
import {
  type SmsFailureClassification,
} from "@/lib/sms-failure-intelligence";
import { getSmsConsentState } from "@/lib/sms-consent";
import { getPackageEntitlements } from "@/lib/package-entitlements";

type SendSmsInput = {
  orgId: string;
  fromNumberE164?: string | null;
  toNumberE164: string;
  body: string;
  allowPendingA2P?: boolean;
};

type SendSmsResult = {
  providerMessageSid: string | null;
  providerStatus?: string | null;
  providerErrorCode?: string | null;
  providerErrorMessage?: string | null;
  providerRequestTimedOut?: boolean;
  providerAcceptedUnknown?: boolean;
  failure?: SmsFailureClassification | null;
  status: MessageStatus;
  resolvedFromNumberE164: string | null;
  notice?: string;
  suppressed?: boolean;
};

function isTwilioSendEnabled(): boolean {
  return normalizeEnvValue(process.env.TWILIO_SEND_ENABLED) === "true";
}

async function refundReservedSmsUsage(input: {
  orgId: string;
  periodStart: Date;
  smsCostEstimateCents: number;
}) {
  await prisma.$transaction(async (tx) => {
    const usage = await tx.organizationUsage.findUnique({
      where: {
        orgId_periodStart: {
          orgId: input.orgId,
          periodStart: input.periodStart,
        },
      },
      select: {
        smsSentCount: true,
        smsCostEstimateCents: true,
      },
    });

    if (!usage || usage.smsSentCount <= 0) {
      return;
    }

    await tx.organizationUsage.update({
      where: {
        orgId_periodStart: {
          orgId: input.orgId,
          periodStart: input.periodStart,
        },
      },
      data: {
        smsSentCount: Math.max(0, usage.smsSentCount - 1),
        smsCostEstimateCents: Math.max(
          0,
          usage.smsCostEstimateCents - input.smsCostEstimateCents,
        ),
      },
    });
  });
}

export async function sendOutboundSms(input: SendSmsInput): Promise<SendSmsResult> {
  const smsCostEstimateCents = Math.max(
    0,
    Math.round(Number(normalizeEnvValue(process.env.TWILIO_SMS_COST_ESTIMATE_CENTS)) || 1),
  );

  const messagingMode = await prisma.organization.findUnique({
    where: { id: input.orgId },
    select: { package: true, messagingLaunchMode: true },
  });
  const packageEntitlements = getPackageEntitlements(messagingMode?.package);

  if (
    messagingMode?.messagingLaunchMode === "NO_SMS" ||
    !packageEntitlements.canUseLiveSms
  ) {
    return {
      providerMessageSid: null,
      status: "FAILED",
      resolvedFromNumberE164: normalizeE164(input.fromNumberE164 || null),
      notice: !packageEntitlements.canUseLiveSms
        ? "SMS is not included in this organization's package. Leads, jobs, estimates, invoices, files, and internal notes remain available without Twilio."
        : "SMS is disabled for this organization. Leads, jobs, estimates, invoices, files, and internal notes remain available without Twilio.",
      suppressed: true,
    };
  }

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
  const consent = await getSmsConsentState({
    orgId: input.orgId,
    phoneE164: normalizedToNumber,
  });

  if (consent.status === "OPTED_OUT") {
    return {
      providerMessageSid: null,
      status: "FAILED",
      resolvedFromNumberE164,
      notice: "Suppressed outbound SMS because the contact is opted out.",
      suppressed: true,
    };
  }

  if (consent.status !== "OPTED_IN") {
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
  let usageReserved = false;

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
    usageReserved = true;
  } else {
    await prisma.organizationUsage.updateMany({
      where: { orgId: input.orgId, periodStart },
      data: {
        smsSentCount: { increment: 1 },
        smsCostEstimateCents: { increment: smsCostEstimateCents },
      },
    });
    usageReserved = true;
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

  let providerResponse: Awaited<ReturnType<typeof sendTwilioMessageWithConfig>>;
  try {
    providerResponse = await sendTwilioMessageWithConfig({
      config: {
        twilioSubaccountSid: twilioConfig.twilioSubaccountSid,
        twilioAuthToken: twilioConfig.twilioAuthToken,
        messagingServiceSid: twilioConfig.messagingServiceSid,
      },
      toNumberE164: normalizedToNumber,
      body: input.body,
      statusCallbackUrl: (() => {
        const baseUrl = getConfiguredBaseUrl();
        return baseUrl ? `${baseUrl}/api/webhooks/twilio/sms/status` : null;
      })(),
    });
  } catch (error) {
    if (usageReserved) {
      await refundReservedSmsUsage({
        orgId: input.orgId,
        periodStart,
        smsCostEstimateCents,
      }).catch(() => undefined);
    }

    return {
      providerMessageSid: null,
      providerStatus: null,
      providerErrorCode: "TIEGUI_EXCEPTION",
      providerErrorMessage:
        error instanceof Error ? error.message : "Twilio send failed before the provider accepted the message.",
      status: "FAILED",
      resolvedFromNumberE164,
      notice:
        error instanceof Error
          ? error.message
          : "Twilio send failed before the provider accepted the message.",
    };
  }

  if (!providerResponse.ok) {
    if (usageReserved && !providerResponse.providerAcceptedUnknown) {
      await refundReservedSmsUsage({
        orgId: input.orgId,
        periodStart,
        smsCostEstimateCents,
      }).catch(() => undefined);
    }

    return {
      providerMessageSid: providerResponse.providerMessageSid,
      providerStatus: providerResponse.providerStatus,
      providerErrorCode: providerResponse.providerErrorCode,
      providerErrorMessage: providerResponse.providerErrorMessage,
      providerRequestTimedOut: providerResponse.requestTimedOut,
      providerAcceptedUnknown: providerResponse.providerAcceptedUnknown,
      failure: providerResponse.failure,
      status: providerResponse.providerAcceptedUnknown ? "QUEUED" : "FAILED",
      resolvedFromNumberE164,
      notice: providerResponse.error,
    };
  }

  return {
    providerMessageSid: providerResponse.providerMessageSid,
    providerStatus: providerResponse.providerStatus,
    providerErrorCode: null,
    providerErrorMessage: null,
    providerRequestTimedOut: false,
    providerAcceptedUnknown: false,
    failure: null,
    status: mapTwilioInitialSendStatus(providerResponse.providerStatus),
    resolvedFromNumberE164,
  };
}
