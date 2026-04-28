import { normalizeEnvValue } from "@/lib/env";

export type TwilioMessagingReadinessCode =
  | "NOT_CONFIGURED"
  | "TOKEN_KEY_MISSING"
  | "PAUSED"
  | "PENDING_A2P"
  | "SEND_DISABLED"
  | "ACTIVE";

export type TwilioMessagingEnvironmentSnapshot = {
  sendEnabled: boolean;
  tokenEncryptionKeyPresent: boolean;
};

export type TwilioMessagingConfigSnapshot = {
  phoneNumber: string | null;
  status: "PENDING_A2P" | "ACTIVE" | "PAUSED" | null;
};

export type TwilioMessagingReadiness = {
  code: TwilioMessagingReadinessCode;
  canSend: boolean;
  hasConfig: boolean;
  sendEnabled: boolean;
  tokenEncryptionKeyPresent: boolean;
};

export function getTwilioMessagingEnvironmentSnapshot(): TwilioMessagingEnvironmentSnapshot {
  return {
    sendEnabled: normalizeEnvValue(process.env.TWILIO_SEND_ENABLED) === "true",
    tokenEncryptionKeyPresent: Boolean(
      normalizeEnvValue(process.env.TWILIO_TOKEN_ENCRYPTION_KEY),
    ),
  };
}

export function resolveTwilioMessagingReadiness(input: {
  twilioConfig?: TwilioMessagingConfigSnapshot | null;
  env?: TwilioMessagingEnvironmentSnapshot;
}): TwilioMessagingReadiness {
  const env = input.env || getTwilioMessagingEnvironmentSnapshot();
  const hasConfig = Boolean(input.twilioConfig?.phoneNumber);

  let code: TwilioMessagingReadinessCode;
  if (!hasConfig) {
    code = "NOT_CONFIGURED";
  } else if (!env.tokenEncryptionKeyPresent) {
    code = "TOKEN_KEY_MISSING";
  } else if (input.twilioConfig?.status === "PAUSED") {
    code = "PAUSED";
  } else if (input.twilioConfig?.status === "PENDING_A2P") {
    code = "PENDING_A2P";
  } else if (!env.sendEnabled) {
    code = "SEND_DISABLED";
  } else if (input.twilioConfig?.status === "ACTIVE") {
    code = "ACTIVE";
  } else {
    code = "NOT_CONFIGURED";
  }

  return {
    code,
    canSend: code === "ACTIVE",
    hasConfig,
    sendEnabled: env.sendEnabled,
    tokenEncryptionKeyPresent: env.tokenEncryptionKeyPresent,
  };
}

export function canComposeManualSms(code: TwilioMessagingReadinessCode): boolean {
  return code === "ACTIVE" || code === "SEND_DISABLED";
}

export function getTwilioMessagingComposeNotice(
  code: TwilioMessagingReadinessCode,
): string | null {
  switch (code) {
    case "SEND_DISABLED":
      return "Queue-only mode: replies are saved, but customers will not receive live SMS until sending is enabled.";
    case "PENDING_A2P":
      return "SMS is not live yet because Twilio A2P registration is still pending.";
    case "PAUSED":
      return "Messaging is paused for this workspace until Twilio is reactivated.";
    case "TOKEN_KEY_MISSING":
      return "Messaging is blocked because this deployment cannot read Twilio credentials.";
    case "NOT_CONFIGURED":
      return "Messaging is not configured for this workspace yet. Calls and manual notes still work.";
    default:
      return null;
  }
}
