import type { MessageStatus } from "@prisma/client";
import { normalizeEnvValue } from "./env";
import { prisma } from "@/lib/prisma";
import { startOfUtcMonth } from "@/lib/usage";
import { maybeSendSmsQuotaAlerts } from "@/lib/usage-alerts";
import { checkSlidingWindowLimit } from "@/lib/rate-limit";

type SendSmsInput = {
  orgId: string;
  fromNumberE164: string;
  toNumberE164: string;
  body: string;
};

type SendSmsResult = {
  providerMessageSid: string | null;
  status: MessageStatus;
  notice?: string;
};

function mapTwilioStatus(value: string | null | undefined): MessageStatus {
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

function isTwilioSendEnabled(): boolean {
  return normalizeEnvValue(process.env.TWILIO_SEND_ENABLED) === "true";
}

export async function sendOutboundSms(input: SendSmsInput): Promise<SendSmsResult> {
  const accountSid = normalizeEnvValue(process.env.TWILIO_ACCOUNT_SID);
  const authToken = normalizeEnvValue(process.env.TWILIO_AUTH_TOKEN);
  const smsCostEstimateCents = Math.max(
    0,
    Math.round(Number(normalizeEnvValue(process.env.TWILIO_SMS_COST_ESTIMATE_CENTS)) || 1),
  );

  // Safe default for development: persist outbound rows without calling Twilio.
  if (!isTwilioSendEnabled() || !accountSid || !authToken) {
    return {
      providerMessageSid: null,
      status: "QUEUED",
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

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        From: input.fromNumberE164,
        To: input.toNumberE164,
        Body: input.body,
      }),
    },
  );

  const payload = (await response.json().catch(() => null)) as
    | {
        sid?: unknown;
        status?: unknown;
        message?: unknown;
      }
    | null;

  const providerMessageSid = typeof payload?.sid === "string" ? payload.sid : null;

  if (!response.ok) {
    const notice =
      typeof payload?.message === "string"
        ? payload.message
        : `Twilio send failed (${response.status}).`;
    return {
      providerMessageSid,
      status: "FAILED",
      notice,
    };
  }

  return {
    providerMessageSid,
    status: mapTwilioStatus(typeof payload?.status === "string" ? payload.status : null),
  };
}
