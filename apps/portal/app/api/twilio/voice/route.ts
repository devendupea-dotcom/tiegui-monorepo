import { normalizeE164 } from "@/lib/phone";
import { getBaseUrlFromRequest } from "@/lib/urls";
import { validateTwilioWebhook } from "@/lib/twilio";
import { maskSid } from "@/lib/twilio-config-crypto";
import { getTwilioOrgRuntimeConfigByAccountSid, resolveTwilioVoiceForwardingNumber } from "@/lib/twilio-org";

function asString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function twimlResponse(body: string) {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    status: 200,
    headers: {
      "content-type": "text/xml; charset=utf-8",
    },
  });
}

function getAfterCallUrl(req: Request): string {
  return `${getBaseUrlFromRequest(req)}/api/twilio/voice/status`;
}

function voicemailFallbackTwiml(afterCallUrl: string) {
  return twimlResponse(
    [
      "<Say>Thanks for calling. We are helping another customer right now. Please leave a message after the tone.</Say>",
      `<Record maxLength="60" playBeep="true" action="${escapeXml(afterCallUrl)}" method="POST" />`,
      "<Say>Thanks. We will get back to you shortly.</Say>",
    ].join(""),
  );
}

export async function POST(req: Request) {
  const form = await req.formData();
  const accountSid = asString(form.get("AccountSid"));
  const afterCallUrl = getAfterCallUrl(req);

  if (!accountSid) {
    return voicemailFallbackTwiml(afterCallUrl);
  }

  let twilioConfig: Awaited<ReturnType<typeof getTwilioOrgRuntimeConfigByAccountSid>>;
  try {
    twilioConfig = await getTwilioOrgRuntimeConfigByAccountSid(accountSid);
  } catch {
    console.warn(`[twilio:voice] unable to decrypt auth token for account ${maskSid(accountSid)}.`);
    return voicemailFallbackTwiml(afterCallUrl);
  }

  if (!twilioConfig) {
    console.warn(`[twilio:voice] ignored inbound voice for unknown account ${maskSid(accountSid)}.`);
    return voicemailFallbackTwiml(afterCallUrl);
  }

  const validation = validateTwilioWebhook(req, form, { authToken: twilioConfig.twilioAuthToken });
  if (!validation.ok) {
    return new Response(validation.error, { status: validation.status });
  }

  if (twilioConfig.status === "PAUSED") {
    return voicemailFallbackTwiml(afterCallUrl);
  }

  const forwardingNumber = await resolveTwilioVoiceForwardingNumber(twilioConfig.organizationId);
  if (!forwardingNumber) {
    console.warn(`[twilio:voice] no owner/admin forwarding target for org ${twilioConfig.organizationId}.`);
    return voicemailFallbackTwiml(afterCallUrl);
  }

  const callerId = normalizeE164(twilioConfig.phoneNumber) || twilioConfig.phoneNumber;

  return twimlResponse(
    [
      `<Dial timeout="20" action="${escapeXml(afterCallUrl)}" method="POST" answerOnBridge="true" callerId="${escapeXml(callerId)}">`,
      escapeXml(forwardingNumber),
      "</Dial>",
    ].join(""),
  );
}
