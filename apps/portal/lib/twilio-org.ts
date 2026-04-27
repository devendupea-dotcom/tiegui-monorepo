import { normalizeE164 } from "@/lib/phone";
import { normalizeEnvValue } from "@/lib/env";
import {
  classifySmsFailure,
  type SmsFailureClassification,
} from "@/lib/sms-failure-intelligence";
import { decryptTwilioAuthToken } from "@/lib/twilio-config-crypto";

type TwilioRequestInput = {
  accountSid: string;
  authToken: string;
  path: string;
  baseUrl?: string;
  method?: "GET" | "POST";
  formBody?: URLSearchParams;
  timeoutMs?: number;
};

export type TwilioOrgRuntimeConfig = {
  id: string;
  organizationId: string;
  twilioSubaccountSid: string;
  twilioAuthToken: string;
  messagingServiceSid: string;
  phoneNumber: string;
  voiceForwardingNumber: string | null;
  status: "PENDING_A2P" | "ACTIVE" | "PAUSED";
};

type TwilioApiResult = {
  ok: boolean;
  status: number;
  payload: Record<string, unknown> | null;
  timedOut?: boolean;
  errorMessage?: string;
};

type ValidateConfigInput = {
  twilioSubaccountSid: string;
  twilioAuthToken: string;
  messagingServiceSid: string;
  phoneNumber: string;
};

export type ValidateConfigResult =
  | {
      ok: true;
      normalizedPhoneNumber: string;
      serviceFriendlyName: string | null;
      phoneNumberSid: string;
    }
  | {
      ok: false;
      error: string;
    };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readProviderErrorCode(payload: Record<string, unknown> | null, status: number): string | null {
  const code = payload?.code;
  if (typeof code === "string" && code.trim()) {
    return code.trim();
  }
  if (typeof code === "number" && Number.isFinite(code)) {
    return `${code}`;
  }
  if (status === 429) {
    return "20429";
  }
  return null;
}

function readArray(record: Record<string, unknown> | null, key: string): unknown[] {
  const value = record?.[key];
  return Array.isArray(value) ? value : [];
}

async function getPrismaClient() {
  return (await import("@/lib/prisma")).prisma;
}

async function twilioRequest(input: TwilioRequestInput): Promise<TwilioApiResult> {
  const baseUrl = input.baseUrl || `https://api.twilio.com/2010-04-01/Accounts/${input.accountSid}`;
  const controller = input.timeoutMs && input.timeoutMs > 0 ? new AbortController() : null;
  const timeout = controller
    ? setTimeout(() => controller.abort(), input.timeoutMs as number)
    : null;

  try {
    const response = await fetch(`${baseUrl}${input.path}`, {
      method: input.method || "GET",
      headers: {
        Authorization: `Basic ${Buffer.from(`${input.accountSid}:${input.authToken}`).toString("base64")}`,
        ...(input.formBody ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      ...(input.formBody ? { body: input.formBody } : {}),
      ...(controller ? { signal: controller.signal } : {}),
    });

    const payload = asRecord(await response.json().catch(() => null));
    return {
      ok: response.ok,
      status: response.status,
      payload,
    };
  } catch (error) {
    if (controller?.signal.aborted) {
      return {
        ok: false,
        status: 0,
        payload: null,
        timedOut: true,
        errorMessage: "Twilio request timed out before TieGui received provider confirmation.",
      };
    }

    return {
      ok: false,
      status: 0,
      payload: null,
      errorMessage: error instanceof Error ? error.message : "Twilio request failed before provider confirmation.",
    };
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function twilioErrorMessage(payload: Record<string, unknown> | null, status: number, fallback: string): string {
  const message = readString(payload?.message);
  if (message) {
    return message;
  }
  return `${fallback} (${status})`;
}

function normalizeTwilioPhone(phoneNumber: string): string | null {
  return normalizeE164(phoneNumber);
}

export async function getTwilioOrgRuntimeConfigByOrgId(orgId: string): Promise<TwilioOrgRuntimeConfig | null> {
  const prisma = await getPrismaClient();
  const config = await prisma.organizationTwilioConfig.findUnique({
    where: { organizationId: orgId },
    select: {
      id: true,
      organizationId: true,
      twilioSubaccountSid: true,
      twilioAuthTokenEncrypted: true,
      messagingServiceSid: true,
      phoneNumber: true,
      voiceForwardingNumber: true,
      status: true,
    },
  });

  if (!config) {
    return null;
  }

  return {
    id: config.id,
    organizationId: config.organizationId,
    twilioSubaccountSid: config.twilioSubaccountSid,
    twilioAuthToken: decryptTwilioAuthToken(config.twilioAuthTokenEncrypted),
    messagingServiceSid: config.messagingServiceSid,
    phoneNumber: config.phoneNumber,
    voiceForwardingNumber: config.voiceForwardingNumber,
    status: config.status,
  };
}

export async function getTwilioOrgRuntimeConfigByAccountSid(
  twilioSubaccountSid: string,
): Promise<TwilioOrgRuntimeConfig | null> {
  const prisma = await getPrismaClient();
  const config = await prisma.organizationTwilioConfig.findUnique({
    where: { twilioSubaccountSid },
    select: {
      id: true,
      organizationId: true,
      twilioSubaccountSid: true,
      twilioAuthTokenEncrypted: true,
      messagingServiceSid: true,
      phoneNumber: true,
      voiceForwardingNumber: true,
      status: true,
    },
  });

  if (!config) {
    return null;
  }

  return {
    id: config.id,
    organizationId: config.organizationId,
    twilioSubaccountSid: config.twilioSubaccountSid,
    twilioAuthToken: decryptTwilioAuthToken(config.twilioAuthTokenEncrypted),
    messagingServiceSid: config.messagingServiceSid,
    phoneNumber: config.phoneNumber,
    voiceForwardingNumber: config.voiceForwardingNumber,
    status: config.status,
  };
}

export async function resolveTwilioVoiceForwardingNumber(input: {
  organizationId: string;
  configuredNumber?: string | null;
}): Promise<string | null> {
  const configuredNumber = normalizeTwilioPhone(input.configuredNumber || "");
  if (configuredNumber) {
    return configuredNumber;
  }

  const { listWorkspaceUsers, sortWorkspaceUsersByCalendarRoleThenCreatedAt } = await import("@/lib/workspace-users");
  const candidates = sortWorkspaceUsersByCalendarRoleThenCreatedAt(
    await listWorkspaceUsers({
      organizationId: input.organizationId,
      allowedCalendarRoles: ["OWNER", "ADMIN"],
      requirePhone: true,
    }),
  );

  for (const candidate of candidates) {
    const normalizedPhone = normalizeTwilioPhone(candidate.phoneE164 || "");
    if (normalizedPhone) {
      return normalizedPhone;
    }
  }

  return null;
}

export async function validateTwilioOrgConfig(input: ValidateConfigInput): Promise<ValidateConfigResult> {
  const normalizedPhoneNumber = normalizeTwilioPhone(input.phoneNumber);
  if (!normalizedPhoneNumber) {
    return { ok: false, error: "Phone number must be valid E.164." };
  }

  const service = await twilioRequest({
    accountSid: input.twilioSubaccountSid,
    authToken: input.twilioAuthToken,
    baseUrl: "https://messaging.twilio.com/v1",
    path: `/Services/${encodeURIComponent(input.messagingServiceSid)}`,
  });

  if (!service.ok) {
    return {
      ok: false,
      error: twilioErrorMessage(service.payload, service.status, "Messaging Service validation failed"),
    };
  }

  const incoming = await twilioRequest({
    accountSid: input.twilioSubaccountSid,
    authToken: input.twilioAuthToken,
    path: `/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(normalizedPhoneNumber)}&PageSize=20`,
  });

  if (!incoming.ok) {
    return {
      ok: false,
      error: twilioErrorMessage(incoming.payload, incoming.status, "Phone number validation failed"),
    };
  }

  const incomingNumbers = readArray(incoming.payload, "incoming_phone_numbers");

  const incomingNumber = incomingNumbers.find((item) => {
    const itemRecord = asRecord(item);
    const candidate = normalizeTwilioPhone(readString(itemRecord?.phone_number) || "");
    return candidate === normalizedPhoneNumber;
  });

  const incomingNumberSid = readString(asRecord(incomingNumber)?.sid);
  if (!incomingNumberSid) {
    return {
      ok: false,
      error: "Phone number was not found in this Twilio account.",
    };
  }

  const servicePhoneNumbers = await twilioRequest({
    accountSid: input.twilioSubaccountSid,
    authToken: input.twilioAuthToken,
    baseUrl: "https://messaging.twilio.com/v1",
    path: `/Services/${encodeURIComponent(input.messagingServiceSid)}/PhoneNumbers?PageSize=1000`,
  });

  if (!servicePhoneNumbers.ok) {
    return {
      ok: false,
      error: twilioErrorMessage(
        servicePhoneNumbers.payload,
        servicePhoneNumbers.status,
        "Messaging Service sender check failed",
      ),
    };
  }

  const assignedNumbers = readArray(servicePhoneNumbers.payload, "phone_numbers");
  const isAssigned = assignedNumbers.some((item) => readString(asRecord(item)?.sid) === incomingNumberSid);
  if (!isAssigned) {
    return {
      ok: false,
      error: "Phone number is not attached to the selected Messaging Service.",
    };
  }

  return {
    ok: true,
    normalizedPhoneNumber,
    serviceFriendlyName: readString(service.payload?.friendly_name),
    phoneNumberSid: incomingNumberSid,
  };
}

export async function sendTwilioMessageWithConfig(input: {
  config: Pick<TwilioOrgRuntimeConfig, "twilioSubaccountSid" | "twilioAuthToken" | "messagingServiceSid">;
  toNumberE164: string;
  body: string;
  statusCallbackUrl?: string | null;
  requestTimeoutMs?: number;
}): Promise<
  | {
      ok: true;
      providerMessageSid: string | null;
      providerStatus: string | null;
      providerMetadata: {
        status: string | null;
        errorCode: null;
        errorMessage: null;
        requestTimedOut: false;
        providerAcceptedUnknown: false;
        failure: null;
      };
    }
  | {
      ok: false;
      error: string;
      providerMessageSid: string | null;
      providerStatus: string | null;
      providerErrorCode: string | null;
      providerErrorMessage: string | null;
      requestTimedOut: boolean;
      providerAcceptedUnknown: boolean;
      failure: SmsFailureClassification | null;
    }
> {
  const configuredTimeoutMs = Math.max(
    1000,
    Math.round(Number(normalizeEnvValue(process.env.TWILIO_SEND_TIMEOUT_MS)) || 10000),
  );
  const response = await twilioRequest({
    accountSid: input.config.twilioSubaccountSid,
    authToken: input.config.twilioAuthToken,
    path: "/Messages.json",
    method: "POST",
    formBody: new URLSearchParams(
      Object.entries({
        To: input.toNumberE164,
        Body: input.body,
        MessagingServiceSid: input.config.messagingServiceSid,
        ...(input.statusCallbackUrl ? { StatusCallback: input.statusCallbackUrl } : {}),
      }),
    ),
    timeoutMs: input.requestTimeoutMs || configuredTimeoutMs,
  });

  const providerMessageSid = typeof response.payload?.sid === "string" ? response.payload.sid : null;
  const providerStatus = typeof response.payload?.status === "string" ? response.payload.status : null;
  const providerErrorCode = response.timedOut ? "TIEGUI_TIMEOUT" : readProviderErrorCode(response.payload, response.status);
  const providerErrorMessage =
    response.errorMessage || readString(response.payload?.message) || (response.ok ? null : twilioErrorMessage(response.payload, response.status, "Twilio send failed"));

  if (!response.ok) {
    const providerAcceptedUnknown = Boolean(response.timedOut);
    const failure = classifySmsFailure({
      providerStatus: providerStatus || (response.timedOut ? "timeout" : "failed"),
      lifecycleStatus: "FAILED",
      errorCode: providerErrorCode,
      errorMessage: providerErrorMessage,
      providerAcceptedUnknown,
    });
    return {
      ok: false,
      providerMessageSid,
      providerStatus,
      providerErrorCode,
      providerErrorMessage,
      requestTimedOut: Boolean(response.timedOut),
      providerAcceptedUnknown,
      failure,
      error: response.timedOut
        ? "Twilio send timed out before TieGui received confirmation. The SMS may have been accepted; refresh the thread or check Twilio before retrying."
        : providerErrorMessage || "Twilio send failed.",
    };
  }

  return {
    ok: true,
    providerMessageSid,
    providerStatus,
    providerMetadata: {
      status: providerStatus,
      errorCode: null,
      errorMessage: null,
      requestTimedOut: false,
      providerAcceptedUnknown: false,
      failure: null,
    },
  };
}
