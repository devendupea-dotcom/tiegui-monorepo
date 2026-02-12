import type { CallDirection, CallStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendMissedCallIntroAndStartFlow } from "@/lib/intake-automation";
import { normalizeE164 } from "@/lib/phone";
import { validateTwilioWebhook } from "@/lib/twilio";

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

function mapCallDirection(value: string): CallDirection {
  return value.toLowerCase().includes("inbound") ? "INBOUND" : "OUTBOUND";
}

function mapCallStatus(value: string): CallStatus {
  const normalized = value.toLowerCase();
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

export async function POST(req: Request) {
  const form = await req.formData();
  const validation = validateTwilioWebhook(req, form);
  if (!validation.ok) {
    return new Response(validation.error, { status: validation.status });
  }

  const callSid = asString(form.get("CallSid")) || null;
  const fromNumber = normalizeE164(asString(form.get("From")));
  const toNumber = normalizeE164(asString(form.get("To")));
  const direction = mapCallDirection(asString(form.get("Direction")));
  const mappedStatus = mapCallStatus(asString(form.get("CallStatus")));
  const startedAtRaw = asString(form.get("Timestamp"));
  const startedAt = startedAtRaw ? new Date(startedAtRaw) : new Date();
  const now = new Date();

  if (!toNumber) {
    return twimlOk();
  }

  const organization = await prisma.organization.findFirst({
    where: { smsFromNumberE164: toNumber },
    select: {
      id: true,
      smsFromNumberE164: true,
      messageLanguage: true,
      missedCallAutoReplyOn: true,
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
    },
  });

  if (!organization) {
    return twimlOk();
  }

  let leadId: string | null = null;
  if (fromNumber && direction === "INBOUND") {
    const lead = await prisma.lead.findFirst({
      where: {
        orgId: organization.id,
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
          orgId: organization.id,
          phoneE164: fromNumber,
          preferredLanguage: organization.messageLanguage === "ES" ? "ES" : null,
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
        orgId: organization.id,
        leadId,
        fromNumberE164: fromNumber || "",
        toNumberE164: toNumber,
        trackingNumberE164: toNumber,
        direction,
        status: mappedStatus,
        endedAt: mappedStatus === "RINGING" ? null : now,
      },
      create: {
        orgId: organization.id,
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
        orgId: organization.id,
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

  const shouldSendMissedCallReply =
    direction === "INBOUND" &&
    mappedStatus === "MISSED" &&
    existingCallStatus !== "MISSED" &&
    Boolean(organization.missedCallAutoReplyOn) &&
    Boolean(organization.smsFromNumberE164) &&
    Boolean(fromNumber) &&
    Boolean(leadId);

  if (shouldSendMissedCallReply) {
    await sendMissedCallIntroAndStartFlow({
      organization,
      leadId: leadId as string,
      toNumberE164: fromNumber as string,
    });
  }

  return twimlOk();
}
