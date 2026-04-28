import { Prisma } from "@prisma/client";
import { findBlockedCallerByPhone } from "@/lib/blocked-callers";
import { handleConversationalSmsInbound } from "@/lib/conversational-sms";
import { recordOutboundSmsCommunicationEvent } from "@/lib/communication-events";
import { buildCommunicationIdempotencyKey, upsertCommunicationEvent } from "@/lib/communication-events";
import { ensureLeadAndContactForInboundPhone } from "@/lib/lead-contact-resolution";
import { prisma } from "@/lib/prisma";
import { normalizeE164 } from "@/lib/phone";
import { buildSmsComplianceReply, parseSmsComplianceKeyword } from "@/lib/sms-compliance";
import { getSmsConsentState, recordSmsStart, recordSmsStop } from "@/lib/sms-consent";
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

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function twimlMessage(body: string) {
  return new Response(`<Response><Message>${escapeXml(body)}</Message></Response>`, {
    status: 200,
    headers: {
      "content-type": "text/xml; charset=utf-8",
    },
  });
}

function asString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseTwilioOptOutType(value: string): "STOP" | "START" | "HELP" | null {
  const normalized = value.trim().toUpperCase();
  if (normalized === "STOP") return "STOP";
  if (normalized === "START") return "START";
  if (normalized === "HELP") return "HELP";
  return null;
}

async function recordComplianceAutoReply(input: {
  orgId: string;
  leadId: string;
  contactId: string | null;
  conversationId: string | null;
  fromNumberE164: string;
  toNumberE164: string;
  body: string;
}) {
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: {
        orgId: input.orgId,
        leadId: input.leadId,
        direction: "OUTBOUND",
        type: "AUTOMATION",
        fromNumberE164: input.fromNumberE164,
        toNumberE164: input.toNumberE164,
        body: input.body,
        provider: "TWILIO",
        status: "SENT",
      },
      select: {
        id: true,
        createdAt: true,
      },
    });

    await recordOutboundSmsCommunicationEvent(tx, {
      orgId: input.orgId,
      leadId: input.leadId,
      contactId: input.contactId,
      conversationId: input.conversationId,
      messageId: message.id,
      body: input.body,
      fromNumberE164: input.fromNumberE164,
      toNumberE164: input.toNumberE164,
      status: "SENT",
      occurredAt: message.createdAt,
    });

    await tx.lead.update({
      where: { id: input.leadId },
      data: {
        lastContactedAt: now,
        lastOutboundAt: now,
        nextFollowUpAt: null,
      },
    });
  });
}

async function applyComplianceKeyword(input: {
  orgId: string;
  leadId: string;
  customerId: string | null;
  phoneE164: string;
  keyword: "STOP" | "START" | "HELP";
  body: string;
  occurredAt: Date;
  wasOptedOut: boolean;
}) {
  if (input.keyword === "HELP") {
    return;
  }

  await prisma.$transaction(async (tx) => {
    if (input.keyword === "STOP") {
      await recordSmsStop({
        client: tx,
        orgId: input.orgId,
        phoneE164: input.phoneE164,
        leadId: input.leadId,
        customerId: input.customerId,
        body: input.body,
        occurredAt: input.occurredAt,
      });

      await tx.lead.update({
        where: { id: input.leadId },
        data: {
          status: "DNC",
          intakeStage: "COMPLETED",
          nextFollowUpAt: null,
        },
      });

      await tx.leadConversationState.updateMany({
        where: { leadId: input.leadId },
        data: {
          stage: "CLOSED",
          stoppedAt: input.occurredAt,
          pausedUntil: null,
          nextFollowUpAt: null,
          bookingOptions: Prisma.DbNull,
          followUpStep: 0,
        },
      });

      await tx.smsDispatchQueue.updateMany({
        where: {
          orgId: input.orgId,
          leadId: input.leadId,
          status: "QUEUED",
        },
        data: {
          status: "FAILED",
          lastError: "Canceled after inbound STOP keyword.",
        },
      });

      return;
    }

    await recordSmsStart({
      client: tx,
      orgId: input.orgId,
      phoneE164: input.phoneE164,
      leadId: input.leadId,
      customerId: input.customerId,
      body: input.body,
      occurredAt: input.occurredAt,
    });

    if (input.wasOptedOut) {
      await tx.leadConversationState.updateMany({
        where: { leadId: input.leadId },
        data: {
          stage: "ASKED_WORK",
          stoppedAt: null,
          pausedUntil: null,
          nextFollowUpAt: null,
          followUpStep: 0,
        },
      });
    }
  });
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
  const optOutType = parseTwilioOptOutType(asString(form.get("OptOutType")));

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
      name: true,
      phone: true,
      messageLanguage: true,
    },
  });

  if (!organization) {
    return twimlOk();
  }

  const blockedCaller = await findBlockedCallerByPhone({
    orgId: organization.id,
    phone: fromNumber,
  });

  if (blockedCaller) {
    console.info(
      `[twilio:sms] ignored inbound sms from blocked caller orgId=${organization.id} phone=${fromNumber} blockId=${blockedCaller.id}`,
    );
    return twimlOk();
  }

  const lead = await prisma.$transaction(async (tx) => {
    const resolved = await ensureLeadAndContactForInboundPhone(tx, {
      orgId: organization.id,
      phoneE164: fromNumber,
      at: now,
      preferredLanguage: organization.messageLanguage === "ES" ? "ES" : null,
      leadSource: "CALL",
    });

    if (!resolved.leadId) {
      return null;
    }

    return tx.lead.findUnique({
      where: { id: resolved.leadId },
      select: {
        id: true,
        status: true,
        customerId: true,
        conversationState: {
          select: {
            id: true,
          },
        },
      },
    });
  });

  if (!lead) {
    return twimlOk();
  }
  const complianceKeyword = optOutType || parseSmsComplianceKeyword(body);

  let shouldAdvanceConversation = false;
  if (messageSid) {
    const existing = await prisma.message.findUnique({
      where: { providerMessageSid: messageSid },
      select: { id: true },
    });

    if (!existing) {
      await prisma.$transaction(async (tx) => {
        const message = await tx.message.create({
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
          select: {
            id: true,
          },
        });
        await upsertCommunicationEvent(tx, {
          orgId: organization.id,
          leadId: lead.id,
          contactId: lead.customerId,
          conversationId: lead.conversationState?.id || null,
          messageId: message.id,
          type: "INBOUND_SMS_RECEIVED",
          channel: "SMS",
          occurredAt: now,
          summary: "Inbound SMS received",
          metadataJson: {
            body,
            fromNumberE164: fromNumber,
            toNumberE164: toNumber,
          },
          provider: "TWILIO",
          providerMessageSid: messageSid,
          providerStatus: "delivered",
          idempotencyKey: buildCommunicationIdempotencyKey("sms-inbound", organization.id, messageSid),
        });
        await tx.organizationUsage.upsert({
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
      });
      shouldAdvanceConversation = true;
    }
  } else {
    await prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
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
        select: {
          id: true,
        },
      });
      await upsertCommunicationEvent(tx, {
        orgId: organization.id,
        leadId: lead.id,
        contactId: lead.customerId,
        conversationId: lead.conversationState?.id || null,
        messageId: message.id,
        type: "INBOUND_SMS_RECEIVED",
        channel: "SMS",
        occurredAt: now,
        summary: "Inbound SMS received",
        metadataJson: {
          body,
          fromNumberE164: fromNumber,
          toNumberE164: toNumber,
        },
        provider: "TWILIO",
        providerStatus: "delivered",
        idempotencyKey: buildCommunicationIdempotencyKey(
          "sms-inbound",
          organization.id,
          lead.id,
          body,
          now.toISOString(),
        ),
      });
      await tx.organizationUsage.upsert({
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
    });
    shouldAdvanceConversation = true;
  }

  if (complianceKeyword) {
    const smsConsentBeforeKeyword =
      complianceKeyword === "START"
        ? await getSmsConsentState({
            orgId: organization.id,
            phoneE164: fromNumber,
          })
        : null;
    const complianceReply = buildSmsComplianceReply({
      keyword: complianceKeyword,
      bizName: organization.name,
      bizPhone: organization.phone || twilioConfig.phoneNumber || toNumber,
    });

    if (shouldAdvanceConversation) {
      try {
        await applyComplianceKeyword({
          orgId: organization.id,
          leadId: lead.id,
          customerId: lead.customerId,
          phoneE164: fromNumber,
          keyword: complianceKeyword,
          body,
          occurredAt: now,
          wasOptedOut:
            lead.status === "DNC" ||
            smsConsentBeforeKeyword?.status === "OPTED_OUT",
        });
        if (!optOutType) {
          await recordComplianceAutoReply({
            orgId: organization.id,
            leadId: lead.id,
            contactId: lead.customerId,
            conversationId: lead.conversationState?.id || null,
            fromNumberE164: toNumber,
            toNumberE164: fromNumber,
            body: complianceReply,
          });
        }
      } catch (error) {
        console.error("[twilio:sms] compliance keyword handler failed", {
          orgId: organization.id,
          leadId: lead.id,
          keyword: complianceKeyword,
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    }

    if (optOutType) {
      return twimlOk();
    }

    return twimlMessage(complianceReply);
  }

  if (shouldAdvanceConversation) {
    try {
      await handleConversationalSmsInbound({
        orgId: organization.id,
        leadId: lead.id,
        inboundBody: body,
        toNumberE164: toNumber,
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
