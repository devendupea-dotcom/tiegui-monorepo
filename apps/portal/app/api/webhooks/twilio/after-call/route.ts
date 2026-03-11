import {
  asTwilioString,
  emptyTwimlResponse,
  maskTwilioAccountSid,
  recordVoiceDialOutcome,
  resolveTwilioVoiceWebhookContext,
  validateTwilioVoiceWebhookRequest,
} from "@/lib/twilio-voice-webhook";

function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return value || "unknown";
  return `***${digits.slice(-4)}`;
}

export async function POST(req: Request) {
  const form = await req.formData();
  const accountSid = asTwilioString(form.get("AccountSid"));
  const callSid = asTwilioString(form.get("CallSid")) || "unknown";
  const from = asTwilioString(form.get("From"));
  const to = asTwilioString(form.get("To")) || asTwilioString(form.get("Called"));
  const dialStatus = asTwilioString(form.get("DialCallStatus")) || asTwilioString(form.get("CallStatus")) || "unknown";

  console.info(
    `[after-call] received callSid=${callSid} dialStatus=${dialStatus} from=${maskPhone(from)} to=${maskPhone(to)} account=${maskTwilioAccountSid(accountSid)}`,
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

  const outcome = await recordVoiceDialOutcome({ context, form });

  console.info(
    `[after-call] processed callSid=${callSid} status=${outcome.status} leadId=${outcome.leadId || "none"} orgId=${context.organization.id}`,
  );
  return emptyTwimlResponse();
}
