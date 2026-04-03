import { normalizeEnvValue } from "@/lib/env";
import { normalizeE164 } from "@/lib/phone";
import { isWithinSmsSendWindow } from "@/lib/sms-quiet-hours";
import { buildVoicemailFallbackTwiml } from "@/lib/twilio-voice-copy";
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
  twimlResponse,
  validateTwilioVoiceWebhookRequest,
} from "@/lib/twilio-voice-webhook";

const FORWARD_DIAL_TIMEOUT_SECONDS = 45;

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
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

  const trackedCall = await trackVoiceCallStart({ context, form });

  console.info(
    `[twilio:voice] tracked call start callSid=${asTwilioString(form.get("CallSid")) || "unknown"} status=${trackedCall.status} leadId=${trackedCall.leadId || "none"} orgId=${context.organization.id}`,
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

  const callerId = normalizeE164(context.twilioConfig.phoneNumber) || context.twilioConfig.phoneNumber;

  console.info(
    `[twilio:voice] forwarding inbound call callSid=${asTwilioString(form.get("CallSid")) || "unknown"} orgId=${context.organization.id} target=${forwardingNumber} timeout=${FORWARD_DIAL_TIMEOUT_SECONDS}s afterCall=${afterCallUrl}`,
  );

  return twimlResponse(
    [
      // Keep the caller on the forwarded leg long enough for the carrier voicemail to answer naturally.
      // The after-call webhook only runs once Twilio finishes the dial attempt or the bridged call ends.
      `<Dial timeout="${FORWARD_DIAL_TIMEOUT_SECONDS}" action="${escapeXml(afterCallUrl)}" method="POST" answerOnBridge="true" callerId="${escapeXml(callerId)}">`,
      escapeXml(forwardingNumber),
      "</Dial>",
    ].join(""),
  );
}
