import type { MessageStatus } from "@prisma/client";
import { normalizeEnvValue } from "./env";

type SendSmsInput = {
  fromNumberE164: string;
  toNumberE164: string;
  body: string;
};

type SendSmsResult = {
  providerMessageSid: string | null;
  status: MessageStatus;
  notice?: string;
};

function mapTwilioStatus(value: string | null | undefined): MessageStatus {
  switch ((value || "").toLowerCase()) {
    case "queued":
      return "QUEUED";
    case "sent":
      return "SENT";
    case "delivered":
      return "DELIVERED";
    case "failed":
    case "undelivered":
      return "FAILED";
    default:
      return "SENT";
  }
}

function isTwilioSendEnabled(): boolean {
  return normalizeEnvValue(process.env.TWILIO_SEND_ENABLED) === "true";
}

export async function sendOutboundSms(input: SendSmsInput): Promise<SendSmsResult> {
  const accountSid = normalizeEnvValue(process.env.TWILIO_ACCOUNT_SID);
  const authToken = normalizeEnvValue(process.env.TWILIO_AUTH_TOKEN);

  // Safe default for development: persist outbound rows without calling Twilio.
  if (!isTwilioSendEnabled() || !accountSid || !authToken) {
    return {
      providerMessageSid: null,
      status: "QUEUED",
      notice: "Twilio sending is disabled. Message saved in CRM and marked QUEUED.",
    };
  }

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        From: input.fromNumberE164,
        To: input.toNumberE164,
        Body: input.body,
      }),
    },
  );

  const payload = (await response.json().catch(() => null)) as
    | {
        sid?: unknown;
        status?: unknown;
        message?: unknown;
      }
    | null;

  const providerMessageSid = typeof payload?.sid === "string" ? payload.sid : null;

  if (!response.ok) {
    const notice =
      typeof payload?.message === "string"
        ? payload.message
        : `Twilio send failed (${response.status}).`;
    return {
      providerMessageSid,
      status: "FAILED",
      notice,
    };
  }

  return {
    providerMessageSid,
    status: mapTwilioStatus(typeof payload?.status === "string" ? payload.status : null),
  };
}
