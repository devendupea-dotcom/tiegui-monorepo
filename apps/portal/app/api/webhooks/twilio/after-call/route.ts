import {
  asTwilioString,
  emptyTwimlResponse,
  maskTwilioAccountSid,
  recordVoiceDialOutcome,
  recordVoiceVoicemailReached,
  resolveTwilioVoiceWebhookContext,
  validateTwilioVoiceWebhookRequest,
} from "@/lib/twilio-voice-webhook";
import { normalizeEnvValue } from "@/lib/env";
import { assessInboundCallRisk } from "@/lib/inbound-call-risk";
import { buildVoicemailFallbackTwiml } from "@/lib/twilio-voice-copy";
import { getBaseUrlFromRequest } from "@/lib/urls";

function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return value || "unknown";
  return `***${digits.slice(-4)}`;
}

function getAfterCallActionUrl(req: Request, params?: Record<string, string>): string {
  const configured = normalizeEnvValue(process.env.TWILIO_VOICE_AFTER_CALL_URL);
  const base = configured ||
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
  const requestUrl = new URL(req.url);
  const accountSid = asTwilioString(form.get("AccountSid"));
  const callSid = asTwilioString(form.get("CallSid")) || "unknown";
  const from = asTwilioString(form.get("From"));
  const to = asTwilioString(form.get("To")) || asTwilioString(form.get("Called"));
  const dialStatus = asTwilioString(form.get("DialCallStatus")) || asTwilioString(form.get("CallStatus")) || "unknown";
  const voicemailFallbackStage = requestUrl.searchParams.get("voicemailFallback") === "1";
  const hasRecording = Boolean(asTwilioString(form.get("RecordingSid")) || asTwilioString(form.get("RecordingUrl")));

  console.info(
    `[after-call] received callSid=${callSid} dialStatus=${dialStatus} from=${maskPhone(from)} to=${maskPhone(to)} account=${maskTwilioAccountSid(accountSid)} voicemailFallback=${voicemailFallbackStage ? "yes" : "no"} recording=${hasRecording ? "yes" : "no"}`,
  );

  let context: Awaited<ReturnType<typeof resolveTwilioVoiceWebhookContext>>;
  try {
    context = await resolveTwilioVoiceWebhookContext(form);
  } catch {
    console.warn(`[twilio:voice] unable to decrypt auth token for account ${maskTwilioAccountSid(accountSid)}.`);
    return emptyTwimlResponse();
  }

  if (!context) {
    console.warn(`[twilio:voice] ignored after-call webhook for unknown account ${maskTwilioAccountSid(accountSid)}.`);
    return emptyTwimlResponse();
  }

  const validation = validateTwilioVoiceWebhookRequest(req, form, context);
  if (!validation.ok) {
    return new Response(validation.error, { status: validation.status });
  }

  const riskAssessment = await assessInboundCallRisk({
    orgId: context.organization.id,
    fromNumber: asTwilioString(form.get("From")),
    stirVerstat: asTwilioString(form.get("StirVerstat")),
    excludeCallSid: callSid === "unknown" ? null : callSid,
  });
  const suppressLeadCreation = riskAssessment.disposition === "VOICEMAIL_ONLY";

  const shouldOfferVoicemailFallback =
    !voicemailFallbackStage &&
    !hasRecording &&
    (dialStatus === "no-answer" || dialStatus === "busy" || dialStatus === "failed" || dialStatus === "canceled");

  if (shouldOfferVoicemailFallback) {
    const fallbackUrl = getAfterCallActionUrl(req, { voicemailFallback: "1" });
    const interimOutcome = await recordVoiceDialOutcome({
      context,
      form,
      voicemailFallbackStage: false,
      riskAssessment,
      allowLeadCreation: !suppressLeadCreation,
      skipMissedCallRecovery: suppressLeadCreation,
    });
    await recordVoiceVoicemailReached({
      context,
      form,
      leadId: interimOutcome.leadId,
      contactId: interimOutcome.contactId,
      callId: interimOutcome.callId,
      reason: dialStatus,
      riskAssessment,
    });
    console.info(
      `[after-call] no-answer fallback to voicemail callSid=${callSid} orgId=${context.organization.id} fallbackUrl=${fallbackUrl}`,
    );
    return buildVoicemailFallbackTwiml({
      afterCallUrl: fallbackUrl,
      businessName: context.organization.name,
    });
  }

  const outcome = await recordVoiceDialOutcome({
    context,
    form,
    voicemailFallbackStage,
    riskAssessment,
    allowLeadCreation: !suppressLeadCreation,
    skipMissedCallRecovery: suppressLeadCreation,
  });

  console.info(
    `[after-call] processed callSid=${callSid} status=${outcome.status} leadId=${outcome.leadId || "none"} orgId=${context.organization.id} risk=${riskAssessment.disposition}:${riskAssessment.score}`,
  );
  return emptyTwimlResponse();
}
