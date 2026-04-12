import { normalizeEnvValue } from "@/lib/env";
import { assessInboundCallRisk } from "@/lib/inbound-call-risk";
import { normalizeE164 } from "@/lib/phone";
import { isWithinSmsSendWindow } from "@/lib/sms-quiet-hours";
import { buildForwardDialTwiml, buildVoicemailFallbackTwiml } from "@/lib/twilio-voice-copy";
import { getBaseUrlFromRequest } from "@/lib/urls";
import {
  asTwilioString,
  getVoiceCalendarTimezone,
  maskTwilioAccountSid,
  recordVoiceForwarding,
  recordVoiceVoicemailReached,
  resolveForwardTarget,
  trackVoiceCallStart,
  resolveTwilioVoiceWebhookContext,
  validateTwilioVoiceWebhookRequest,
} from "@/lib/twilio-voice-webhook";

const DEFAULT_FORWARD_DIAL_TIMEOUT_SECONDS = 20;

function getForwardDialTimeoutSeconds(): number {
  const raw = Number.parseInt(normalizeEnvValue(process.env.TWILIO_VOICE_FORWARD_TIMEOUT_SECONDS) || "", 10);
  if (!Number.isFinite(raw)) {
    return DEFAULT_FORWARD_DIAL_TIMEOUT_SECONDS;
  }
  return Math.max(12, Math.min(30, raw));
}

function getAfterCallActionUrl(req: Request, params?: Record<string, string>): string {
  const configured = normalizeEnvValue(process.env.TWILIO_VOICE_AFTER_CALL_URL);
  const base =
    configured ||
    (normalizeEnvValue(process.env.VERCEL_ENV) === "production"
      ? "https://app.tieguisolutions.com/api/webhooks/twilio/after-call"
      : `${getBaseUrlFromRequest(req)}/api/webhooks/twilio/after-call`);

  const url = new URL(base);
  for (const [key, value] of Object.entries(params || {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export async function POST(req: Request) {
  const form = await req.formData();
  const accountSid = asTwilioString(form.get("AccountSid"));
  const forwardDialTimeoutSeconds = getForwardDialTimeoutSeconds();

  let context: Awaited<ReturnType<typeof resolveTwilioVoiceWebhookContext>>;
  try {
    context = await resolveTwilioVoiceWebhookContext(form);
  } catch {
    console.warn(`[twilio:voice] unable to decrypt auth token for account ${maskTwilioAccountSid(accountSid)}.`);
    return buildVoicemailFallbackTwiml({
      afterCallUrl: getAfterCallActionUrl(req),
    });
  }

  if (!context) {
    console.warn(`[twilio:voice] ignored inbound voice for unknown account ${maskTwilioAccountSid(accountSid)}.`);
    return buildVoicemailFallbackTwiml({
      afterCallUrl: getAfterCallActionUrl(req),
    });
  }

  const validation = validateTwilioVoiceWebhookRequest(req, form, context);
  if (!validation.ok) {
    return new Response(validation.error, { status: validation.status });
  }

  const riskAssessment = await assessInboundCallRisk({
    orgId: context.organization.id,
    fromNumber: asTwilioString(form.get("From")),
    stirVerstat: asTwilioString(form.get("StirVerstat")),
    excludeCallSid: asTwilioString(form.get("CallSid")) || null,
  });
  const suppressLeadCreation = riskAssessment.disposition === "VOICEMAIL_ONLY";

  const trackedCall = await trackVoiceCallStart({
    context,
    form,
    riskAssessment,
    allowLeadCreation: !suppressLeadCreation,
  });

  console.info(
    `[twilio:voice] tracked call start callSid=${asTwilioString(form.get("CallSid")) || "unknown"} status=${trackedCall.status} leadId=${trackedCall.leadId || "none"} orgId=${context.organization.id} risk=${riskAssessment.disposition}:${riskAssessment.score}`,
  );

  const afterCallUrl = getAfterCallActionUrl(req);
  const voicemailAfterCallUrl = getAfterCallActionUrl(req, { voicemailFallback: "1" });
  const inVoiceForwardingWindow = isWithinSmsSendWindow({
    at: new Date(),
    timeZone: getVoiceCalendarTimezone(context),
    startMinute: context.organization.smsQuietHoursStartMinute,
    endMinute: context.organization.smsQuietHoursEndMinute,
  });

  if (context.twilioConfig.status === "PAUSED") {
    await recordVoiceVoicemailReached({
      context,
      form,
      leadId: trackedCall.leadId,
      contactId: trackedCall.contactId,
      callId: trackedCall.callId,
      reason: "twilio_paused",
      riskAssessment,
    });
    return buildVoicemailFallbackTwiml({
      afterCallUrl: voicemailAfterCallUrl,
      businessName: context.organization.name,
    });
  }

  if (!inVoiceForwardingWindow) {
    console.info(
      `[twilio:voice] quiet-hours voicemail fallback callSid=${asTwilioString(form.get("CallSid")) || "unknown"} orgId=${context.organization.id} timezone=${getVoiceCalendarTimezone(context)} startMinute=${context.organization.smsQuietHoursStartMinute} endMinute=${context.organization.smsQuietHoursEndMinute}`,
    );
    await recordVoiceVoicemailReached({
      context,
      form,
      leadId: trackedCall.leadId,
      contactId: trackedCall.contactId,
      callId: trackedCall.callId,
      reason: "quiet_hours",
      riskAssessment,
    });
    return buildVoicemailFallbackTwiml({
      afterCallUrl: voicemailAfterCallUrl,
      businessName: context.organization.name,
    });
  }

  const forwardingNumber = await resolveForwardTarget(context);
  if (!forwardingNumber) {
    await recordVoiceVoicemailReached({
      context,
      form,
      leadId: trackedCall.leadId,
      contactId: trackedCall.contactId,
      callId: trackedCall.callId,
      reason: "missing_forward_target",
      riskAssessment,
    });
    return buildVoicemailFallbackTwiml({
      afterCallUrl: voicemailAfterCallUrl,
      businessName: context.organization.name,
    });
  }

  await recordVoiceForwarding({
    context,
    form,
    leadId: trackedCall.leadId,
    contactId: trackedCall.contactId,
    callId: trackedCall.callId,
    forwardedTo: forwardingNumber,
  });

  if (riskAssessment.disposition === "VOICEMAIL_ONLY") {
    await recordVoiceVoicemailReached({
      context,
      form,
      leadId: trackedCall.leadId,
      contactId: trackedCall.contactId,
      callId: trackedCall.callId,
      reason: "spam_high_risk",
      forwardedTo: forwardingNumber,
      riskAssessment,
    });
    return buildVoicemailFallbackTwiml({
      afterCallUrl: voicemailAfterCallUrl,
      businessName: context.organization.name,
    });
  }

  const originalCallerId = normalizeE164(asTwilioString(form.get("From")));
  const fallbackCallerId = normalizeE164(context.twilioConfig.phoneNumber) || context.twilioConfig.phoneNumber;

  console.info(
    `[twilio:voice] forwarding inbound call callSid=${asTwilioString(form.get("CallSid")) || "unknown"} orgId=${context.organization.id} target=${forwardingNumber} timeout=${forwardDialTimeoutSeconds}s callerId=${originalCallerId || fallbackCallerId || "default"} risk=${riskAssessment.disposition}:${riskAssessment.score} afterCall=${afterCallUrl}`,
  );

  return buildForwardDialTwiml({
    afterCallUrl,
    forwardingNumber,
    timeoutSeconds: forwardDialTimeoutSeconds,
    // Let the owner see the real caller whenever Twilio gives it to us. Fall back to the business line only
    // when the inbound caller number is unavailable.
    callerId: originalCallerId ? null : fallbackCallerId,
  });
}
