import { advanceLeadIntakeFromInbound } from "@/lib/intake-automation";
import { prisma } from "@/lib/prisma";
import { normalizeE164 } from "@/lib/phone";
import { validateTwilioWebhook } from "@/lib/twilio";
import { startOfUtcMonth } from "@/lib/usage";
import { normalizeEnvValue } from "@/lib/env";
import { maskSid } from "@/lib/twilio-config-crypto";
import { getTwilioOrgRuntimeConfigByAccountSid } from "@/lib/twilio-org";

const STOP_KEYWORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START_KEYWORDS = new Set(["START", "UNSTOP"]);

function twimlOk() {
  return new Response("<Response></Response>", {
    status: 200,
    headers: {
      "content-type": "text/xml; charset=utf-8",
    },
  });
}

function asString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(req: Request) {
  const form = await req.formData();
  const accountSid = asString(form.get("AccountSid"));
  if (!accountSid) {
    return twimlOk();
  }

  let twilioConfig: Awaited<ReturnType<typeof getTwilioOrgRuntimeConfigByAccountSid>>;
  try {
    twilioConfig = await getTwilioOrgRuntimeConfigByAccountSid(accountSid);
  } catch {
    console.warn(`[twilio:sms] unable to decrypt auth token for account ${maskSid(accountSid)}.`);
    return twimlOk();
  }

  if (!twilioConfig) {
    console.warn(`[twilio:sms] ignored inbound webhook for unknown account ${maskSid(accountSid)}.`);
    return twimlOk();
  }

  const validation = validateTwilioWebhook(req, form, { authToken: twilioConfig.twilioAuthToken });
  if (!validation.ok) {
    return new Response(validation.error, { status: validation.status });
  }

  const fromNumber = normalizeE164(asString(form.get("From")));
  const toNumber = normalizeE164(asString(form.get("To"))) || normalizeE164(twilioConfig.phoneNumber);
  const body = asString(form.get("Body"));
  const messageSid = asString(form.get("MessageSid")) || null;

  if (!fromNumber || !toNumber || !body) {
    return twimlOk();
  }
  const now = new Date();
  const periodStart = startOfUtcMonth(now);
  const smsCostEstimateCents = Math.max(
    0,
    Math.round(Number(normalizeEnvValue(process.env.TWILIO_SMS_COST_ESTIMATE_CENTS)) || 1),
  );

  const organization = await prisma.organization.findFirst({
    where: { id: twilioConfig.organizationId },
    select: {
      id: true,
      smsFromNumberE164: true,
      smsQuietHoursStartMinute: true,
      smsQuietHoursEndMinute: true,
      messageLanguage: true,
      missedCallAutoReplyBody: true,
      missedCallAutoReplyBodyEn: true,
      missedCallAutoReplyBodyEs: true,
      intakeAutomationEnabled: true,
      intakeAskLocationBody: true,
      intakeAskLocationBodyEn: true,
      intakeAskLocationBodyEs: true,
      intakeAskWorkTypeBody: true,
      intakeAskWorkTypeBodyEn: true,
      intakeAskWorkTypeBodyEs: true,
      intakeAskCallbackBody: true,
      intakeAskCallbackBodyEn: true,
      intakeAskCallbackBodyEs: true,
      intakeCompletionBody: true,
      intakeCompletionBodyEn: true,
      intakeCompletionBodyEs: true,
      dashboardConfig: {
        select: {
          calendarTimezone: true,
        },
      },
    },
  });

  if (!organization) {
    return twimlOk();
  }

  const organizationSettings = {
    ...organization,
    calendarTimezone: organization.dashboardConfig?.calendarTimezone || "America/Los_Angeles",
  };

  let lead = await prisma.lead.findFirst({
    where: {
      orgId: organization.id,
      phoneE164: fromNumber,
    },
    select: {
      id: true,
      firstContactedAt: true,
      status: true,
    },
  });

  if (!lead) {
    lead = await prisma.lead.create({
      data: {
        orgId: organization.id,
        phoneE164: fromNumber,
        preferredLanguage: organization.messageLanguage === "ES" ? "ES" : null,
        status: "NEW",
        leadSource: "CALL",
        firstContactedAt: now,
        lastContactedAt: now,
        lastInboundAt: now,
      },
      select: {
        id: true,
        firstContactedAt: true,
        status: true,
      },
    });
  } else {
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        firstContactedAt: lead.firstContactedAt || new Date(),
        lastContactedAt: now,
        lastInboundAt: now,
      },
    });
  }

  const normalizedKeyword = body.trim().toUpperCase().split(/\s+/)[0] || "";
  const isStopKeyword = STOP_KEYWORDS.has(normalizedKeyword);
  const isStartKeyword = START_KEYWORDS.has(normalizedKeyword);

  let shouldAdvanceIntakeFlow = false;
  if (messageSid) {
    const existing = await prisma.message.findUnique({
      where: { providerMessageSid: messageSid },
      select: { id: true },
    });

    if (!existing) {
      await prisma.message.create({
        data: {
          orgId: organization.id,
          leadId: lead.id,
          direction: "INBOUND",
          type: "MANUAL",
          fromNumberE164: fromNumber,
          toNumberE164: toNumber,
          body,
          provider: "TWILIO",
          providerMessageSid: messageSid,
          status: "DELIVERED",
        },
      });
      await prisma.organizationUsage.upsert({
        where: { orgId_periodStart: { orgId: organization.id, periodStart } },
        create: {
          orgId: organization.id,
          periodStart,
          smsReceivedCount: 1,
          smsCostEstimateCents,
        },
        update: {
          smsReceivedCount: { increment: 1 },
          smsCostEstimateCents: { increment: smsCostEstimateCents },
        },
      });
      shouldAdvanceIntakeFlow = true;
    }
  } else {
    await prisma.message.create({
      data: {
        orgId: organization.id,
        leadId: lead.id,
        direction: "INBOUND",
        type: "MANUAL",
        fromNumberE164: fromNumber,
        toNumberE164: toNumber,
        body,
        provider: "TWILIO",
        status: "DELIVERED",
      },
    });
    await prisma.organizationUsage.upsert({
      where: { orgId_periodStart: { orgId: organization.id, periodStart } },
      create: {
        orgId: organization.id,
        periodStart,
        smsReceivedCount: 1,
        smsCostEstimateCents,
      },
      update: {
        smsReceivedCount: { increment: 1 },
        smsCostEstimateCents: { increment: smsCostEstimateCents },
      },
    });
    shouldAdvanceIntakeFlow = true;
  }

  if (isStopKeyword) {
    await prisma.$transaction(async (tx) => {
      await tx.lead.update({
        where: { id: lead.id },
        data: {
          status: "DNC",
          nextFollowUpAt: null,
        },
      });

      await tx.smsDispatchQueue.updateMany({
        where: {
          orgId: organization.id,
          leadId: lead.id,
          status: "QUEUED",
        },
        data: {
          status: "FAILED",
          lastError: "Canceled after STOP/opt-out request.",
        },
      });
    });
    shouldAdvanceIntakeFlow = false;
  } else if (isStartKeyword && lead.status === "DNC") {
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        status: "FOLLOW_UP",
      },
    });
  }

  if (shouldAdvanceIntakeFlow) {
    await advanceLeadIntakeFromInbound({
      organization: organizationSettings,
      leadId: lead.id,
      inboundBody: body,
    });
  }

  return twimlOk();
}
