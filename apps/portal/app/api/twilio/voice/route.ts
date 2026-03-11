import { normalizeEnvValue } from "@/lib/env";
import { normalizeE164 } from "@/lib/phone";
import { getBaseUrlFromRequest } from "@/lib/urls";
import {
  asTwilioString,
  maskTwilioAccountSid,
  resolveForwardTarget,
  resolveTwilioVoiceWebhookContext,
  twimlResponse,
  validateTwilioVoiceWebhookRequest,
} from "@/lib/twilio-voice-webhook";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function voicemailFallbackTwiml() {
  return twimlResponse(
    [
      "<Say>Thanks for calling. We are helping another customer right now. Please leave a message after the tone.</Say>",
      '<Record maxLength="60" playBeep="true" />',
      "<Say>Thanks. We will get back to you shortly.</Say>",
    ].join(""),
  );
}

function getAfterCallActionUrl(req: Request): string {
  const configured = normalizeEnvValue(process.env.TWILIO_VOICE_AFTER_CALL_URL);
  if (configured) {
    return configured;
  }

  const vercelEnv = normalizeEnvValue(process.env.VERCEL_ENV);
  if (vercelEnv === "production") {
    return "https://app.tieguisolutions.com/api/webhooks/twilio/after-call";
  }

  return `${getBaseUrlFromRequest(req)}/api/webhooks/twilio/after-call`;
}

export async function POST(req: Request) {
  const form = await req.formData();
  const accountSid = asTwilioString(form.get("AccountSid"));

  let context: Awaited<ReturnType<typeof resolveTwilioVoiceWebhookContext>>;
  try {
    context = await resolveTwilioVoiceWebhookContext(form);
  } catch {
    console.warn(`[twilio:voice] unable to decrypt auth token for account ${maskTwilioAccountSid(accountSid)}.`);
    return voicemailFallbackTwiml();
  }

  if (!context) {
    console.warn(`[twilio:voice] ignored inbound voice for unknown account ${maskTwilioAccountSid(accountSid)}.`);
    return voicemailFallbackTwiml();
  }

  const validation = validateTwilioVoiceWebhookRequest(req, form, context);
  if (!validation.ok) {
    return new Response(validation.error, { status: validation.status });
  }

  if (context.twilioConfig.status === "PAUSED") {
    return voicemailFallbackTwiml();
  }

  const forwardingNumber = await resolveForwardTarget(context);
  if (!forwardingNumber) {
    return voicemailFallbackTwiml();
  }

  const callerId = normalizeE164(context.twilioConfig.phoneNumber) || context.twilioConfig.phoneNumber;
  const afterCallUrl = getAfterCallActionUrl(req);

  return twimlResponse(
    [
      `<Dial timeout="20" action="${escapeXml(afterCallUrl)}" method="POST" answerOnBridge="true" callerId="${escapeXml(callerId)}">`,
      escapeXml(forwardingNumber),
      "</Dial>",
    ].join(""),
  );
}
