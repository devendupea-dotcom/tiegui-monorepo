import { handleConversationalSmsInbound } from "@/lib/conversational-sms";
import { prisma } from "@/lib/prisma";
import { normalizeE164 } from "@/lib/phone";
import { validateTwilioWebhook } from "@/lib/twilio";
import { startOfUtcMonth } from "@/lib/usage";
import { normalizeEnvValue } from "@/lib/env";
import { maskSid } from "@/lib/twilio-config-crypto";
import { getTwilioOrgRuntimeConfigByAccountSid } from "@/lib/twilio-org";

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
      messageLanguage: true,
    },
  });

  if (!organization) {
    return twimlOk();
  }

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

  let shouldAdvanceConversation = false;
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
      shouldAdvanceConversation = true;
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
    shouldAdvanceConversation = true;
  }

  if (shouldAdvanceConversation) {
    try {
      await handleConversationalSmsInbound({
        orgId: organization.id,
        leadId: lead.id,
        inboundBody: body,
      });
    } catch (error) {
      console.error("[twilio:sms] conversational handler failed", {
        orgId: organization.id,
        leadId: lead.id,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  return twimlOk();
}
