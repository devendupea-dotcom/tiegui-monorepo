import { validateTwilioWebhook } from "@/lib/twilio";
import { getTwilioOrgRuntimeConfigByAccountSid } from "@/lib/twilio-org";
import { maskSid } from "@/lib/twilio-config-crypto";
import {
  normalizeProviderMessageSid,
  reconcileOutboundSmsProviderStatus,
} from "@/lib/sms-status-reconciliation";
import { capturePortalError } from "@/lib/telemetry";

function asString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function okResponse() {
  return new Response("ok", { status: 200 });
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const form = await req.formData();
  const accountSid = asString(form.get("AccountSid"));
  const providerMessageSid = normalizeProviderMessageSid(
    asString(form.get("MessageSid")) ||
      asString(form.get("SmsSid")) ||
      asString(form.get("SmsMessageSid")),
  );
  const providerStatus = asString(form.get("MessageStatus")) || asString(form.get("SmsStatus"));

  if (!accountSid || !providerMessageSid || !providerStatus) {
    return okResponse();
  }

  let twilioConfig: Awaited<ReturnType<typeof getTwilioOrgRuntimeConfigByAccountSid>>;
  try {
    twilioConfig = await getTwilioOrgRuntimeConfigByAccountSid(accountSid);
  } catch {
    console.warn(`[twilio:sms:status] unable to decrypt auth token for account ${maskSid(accountSid)}.`);
    return okResponse();
  }

  if (!twilioConfig) {
    console.warn(`[twilio:sms:status] ignored outbound status webhook for unknown account ${maskSid(accountSid)}.`);
    return okResponse();
  }

  const validation = validateTwilioWebhook(req, form, { authToken: twilioConfig.twilioAuthToken });
  if (!validation.ok) {
    return new Response(validation.error, { status: validation.status });
  }

  try {
    await reconcileOutboundSmsProviderStatus({
      orgId: twilioConfig.organizationId,
      providerMessageSid,
      providerStatus,
      errorCode: asString(form.get("ErrorCode")) || null,
      errorMessage: asString(form.get("ErrorMessage")) || null,
      occurredAt: new Date(),
    });

    return okResponse();
  } catch (error) {
    await capturePortalError(error, {
      route: "POST /api/webhooks/twilio/sms/status",
      accountSid: maskSid(accountSid),
      providerMessageSid,
      providerStatus,
    });

    const message = error instanceof Error ? error.message : "Failed to reconcile outbound SMS status.";
    return new Response(message, { status: 500 });
  }
}
