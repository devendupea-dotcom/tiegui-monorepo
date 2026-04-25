import type { MessageStatus } from "@prisma/client";

export type SmsFailureCategory =
  | "OPTED_OUT"
  | "BAD_NUMBER"
  | "LANDLINE_OR_UNREACHABLE"
  | "CARRIER_FILTERING"
  | "TWILIO_CONFIGURATION"
  | "RATE_LIMIT"
  | "TEMPORARY_PROVIDER"
  | "UNKNOWN";

export type SmsFailureOperatorAction =
  | "DO_NOT_RETRY_SMS"
  | "FIX_PHONE_NUMBER"
  | "CALL_CUSTOMER"
  | "REWRITE_MESSAGE"
  | "CHECK_TWILIO"
  | "RETRY_LATER"
  | "REVIEW_MANUALLY";

export type SmsFailureClassification = {
  category: SmsFailureCategory;
  label: string;
  operatorAction: SmsFailureOperatorAction;
  operatorActionLabel: string;
  operatorDetail: string;
  retryRecommended: boolean;
  blocksAutomationRetry: boolean;
};

function normalizeText(value: string | null | undefined): string {
  return `${value || ""}`.trim().toLowerCase();
}

function normalizeCode(value: string | null | undefined): string {
  return `${value || ""}`.trim();
}

function hasAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

export function classifySmsFailure(input: {
  providerStatus?: string | null;
  lifecycleStatus?: MessageStatus | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}): SmsFailureClassification | null {
  const lifecycleStatus = input.lifecycleStatus || null;
  const providerStatus = normalizeText(input.providerStatus);
  const errorCode = normalizeCode(input.errorCode);
  const errorText = normalizeText(input.errorMessage);
  const combinedText = [providerStatus, errorCode, errorText].filter(Boolean).join(" ");

  if (lifecycleStatus && lifecycleStatus !== "FAILED") {
    return null;
  }

  if (
    ["21610", "21612"].includes(errorCode) ||
    hasAny(combinedText, ["stop", "opt out", "opted out", "blacklist", "unsubscribed", "do not contact", "dnc"])
  ) {
    return {
      category: "OPTED_OUT",
      label: "Customer opted out",
      operatorAction: "DO_NOT_RETRY_SMS",
      operatorActionLabel: "Do not retry SMS",
      operatorDetail: "Respect the opt-out. Call only if the customer has a separate business reason to be contacted.",
      retryRecommended: false,
      blocksAutomationRetry: true,
    };
  }

  if (
    ["21211", "21614", "30005"].includes(errorCode) ||
    hasAny(combinedText, ["invalid", "not a valid", "unknown destination", "unknown handset", "not sms-capable"])
  ) {
    return {
      category: "BAD_NUMBER",
      label: "Bad or unsupported phone number",
      operatorAction: "FIX_PHONE_NUMBER",
      operatorActionLabel: "Fix phone number",
      operatorDetail: "Verify the customer phone number before any SMS retry. Call from another known number if timing matters.",
      retryRecommended: false,
      blocksAutomationRetry: true,
    };
  }

  if (
    ["30003", "30006"].includes(errorCode) ||
    hasAny(combinedText, ["unreachable destination handset", "unavailable handset", "landline", "cannot receive"])
  ) {
    return {
      category: "LANDLINE_OR_UNREACHABLE",
      label: "Unreachable or non-mobile number",
      operatorAction: "CALL_CUSTOMER",
      operatorActionLabel: "Call customer",
      operatorDetail: "SMS is unlikely to work until the customer provides a reachable mobile number.",
      retryRecommended: false,
      blocksAutomationRetry: true,
    };
  }

  if (
    ["30004", "30007"].includes(errorCode) ||
    hasAny(combinedText, ["carrier filtering", "message filtered", "message blocked", "violation", "filtered"])
  ) {
    return {
      category: "CARRIER_FILTERING",
      label: "Carrier filtering",
      operatorAction: "REWRITE_MESSAGE",
      operatorActionLabel: "Rewrite message",
      operatorDetail: "Rewrite the SMS shorter and less promotional, then retry once. Call if the update is urgent.",
      retryRecommended: true,
      blocksAutomationRetry: true,
    };
  }

  if (
    ["21408", "21606", "21608", "30002", "30010", "30032", "30034"].includes(errorCode) ||
    hasAny(combinedText, [
      "a2p",
      "10dlc",
      "registration",
      "account",
      "auth token",
      "messaging service",
      "sender",
      "not configured",
      "permission",
      "suspended",
      "toll-free",
    ])
  ) {
    return {
      category: "TWILIO_CONFIGURATION",
      label: "Twilio setup issue",
      operatorAction: "CHECK_TWILIO",
      operatorActionLabel: "Check Twilio setup",
      operatorDetail: "Fix the workspace sender, Messaging Service, A2P registration, or account state before retrying.",
      retryRecommended: false,
      blocksAutomationRetry: true,
    };
  }

  if (
    ["20429", "21611", "30001"].includes(errorCode) ||
    hasAny(combinedText, ["rate limit", "too many", "queue overflow", "throttl"])
  ) {
    return {
      category: "RATE_LIMIT",
      label: "Provider rate limit",
      operatorAction: "RETRY_LATER",
      operatorActionLabel: "Retry later",
      operatorDetail: "Wait for provider capacity or throttling to clear before retrying.",
      retryRecommended: true,
      blocksAutomationRetry: false,
    };
  }

  if (
    ["30008", "30012", "30017"].includes(errorCode) ||
    hasAny(combinedText, ["temporary", "timeout", "expired", "network", "congestion"])
  ) {
    return {
      category: "TEMPORARY_PROVIDER",
      label: "Temporary provider issue",
      operatorAction: "RETRY_LATER",
      operatorActionLabel: "Retry later",
      operatorDetail: "Retry once later. If the update is time-sensitive, call the customer.",
      retryRecommended: true,
      blocksAutomationRetry: false,
    };
  }

  if (lifecycleStatus === "FAILED" || providerStatus === "failed" || providerStatus === "undelivered") {
    return {
      category: "UNKNOWN",
      label: "Unknown SMS failure",
      operatorAction: "REVIEW_MANUALLY",
      operatorActionLabel: "Review manually",
      operatorDetail: "Check the Twilio event and customer record before retrying automation.",
      retryRecommended: false,
      blocksAutomationRetry: true,
    };
  }

  return null;
}

export function buildSmsFailureReason(input: {
  providerStatus: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  lifecycleStatus?: MessageStatus | null;
}): string | null {
  if (input.errorMessage?.trim()) {
    return input.errorMessage.trim();
  }

  const classification = classifySmsFailure(input);
  if (classification) {
    return classification.label;
  }

  if (input.errorCode?.trim()) {
    return `Twilio error ${input.errorCode.trim()}.`;
  }

  const normalizedStatus = input.providerStatus.trim().toLowerCase();
  if (!normalizedStatus) {
    return null;
  }

  return `Twilio reported ${normalizedStatus}.`;
}
