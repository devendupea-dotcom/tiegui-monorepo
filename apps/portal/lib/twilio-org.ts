import { normalizeE164 } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import { decryptTwilioAuthToken } from "@/lib/twilio-config-crypto";

type TwilioRequestInput = {
  accountSid: string;
  authToken: string;
  path: string;
  method?: "GET" | "POST";
  formBody?: URLSearchParams;
};

export type TwilioOrgRuntimeConfig = {
  id: string;
  organizationId: string;
  twilioSubaccountSid: string;
  twilioAuthToken: string;
  messagingServiceSid: string;
  phoneNumber: string;
  status: "PENDING_A2P" | "ACTIVE" | "PAUSED";
};

type TwilioApiResult = {
  ok: boolean;
  status: number;
  payload: any;
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

async function twilioRequest(input: TwilioRequestInput): Promise<TwilioApiResult> {
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${input.accountSid}${input.path}`, {
    method: input.method || "GET",
    headers: {
      Authorization: `Basic ${Buffer.from(`${input.accountSid}:${input.authToken}`).toString("base64")}`,
      ...(input.formBody ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    ...(input.formBody ? { body: input.formBody } : {}),
  });

  const payload = await response.json().catch(() => null);
  return {
    ok: response.ok,
    status: response.status,
    payload,
  };
}

function twilioErrorMessage(payload: any, status: number, fallback: string): string {
  if (payload && typeof payload.message === "string" && payload.message.trim()) {
    return payload.message.trim();
  }
  return `${fallback} (${status})`;
}

function normalizeTwilioPhone(phoneNumber: string): string | null {
  return normalizeE164(phoneNumber);
}

export async function getTwilioOrgRuntimeConfigByOrgId(orgId: string): Promise<TwilioOrgRuntimeConfig | null> {
  const config = await prisma.organizationTwilioConfig.findUnique({
    where: { organizationId: orgId },
    select: {
      id: true,
      organizationId: true,
      twilioSubaccountSid: true,
      twilioAuthTokenEncrypted: true,
      messagingServiceSid: true,
      phoneNumber: true,
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
    status: config.status,
  };
}

export async function getTwilioOrgRuntimeConfigByAccountSid(
  twilioSubaccountSid: string,
): Promise<TwilioOrgRuntimeConfig | null> {
  const config = await prisma.organizationTwilioConfig.findUnique({
    where: { twilioSubaccountSid },
    select: {
      id: true,
      organizationId: true,
      twilioSubaccountSid: true,
      twilioAuthTokenEncrypted: true,
      messagingServiceSid: true,
      phoneNumber: true,
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
    status: config.status,
  };
}

export async function validateTwilioOrgConfig(input: ValidateConfigInput): Promise<ValidateConfigResult> {
  const normalizedPhoneNumber = normalizeTwilioPhone(input.phoneNumber);
  if (!normalizedPhoneNumber) {
    return { ok: false, error: "Phone number must be valid E.164." };
  }

  const service = await twilioRequest({
    accountSid: input.twilioSubaccountSid,
    authToken: input.twilioAuthToken,
    path: `/Messaging/Services/${encodeURIComponent(input.messagingServiceSid)}.json`,
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

  const incomingNumbers = Array.isArray(incoming.payload?.incoming_phone_numbers)
    ? incoming.payload.incoming_phone_numbers
    : [];

  const incomingNumber = incomingNumbers.find((item: any) => {
    const candidate = typeof item?.phone_number === "string" ? normalizeTwilioPhone(item.phone_number) : null;
    return candidate === normalizedPhoneNumber;
  });

  if (!incomingNumber || typeof incomingNumber.sid !== "string") {
    return {
      ok: false,
      error: "Phone number was not found in this Twilio subaccount.",
    };
  }

  const servicePhoneNumbers = await twilioRequest({
    accountSid: input.twilioSubaccountSid,
    authToken: input.twilioAuthToken,
    path: `/Messaging/Services/${encodeURIComponent(input.messagingServiceSid)}/PhoneNumbers.json?PageSize=1000`,
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

  const assignedNumbers = Array.isArray(servicePhoneNumbers.payload?.phone_numbers)
    ? servicePhoneNumbers.payload.phone_numbers
    : [];

  const isAssigned = assignedNumbers.some((item: any) => item?.phone_number_sid === incomingNumber.sid);
  if (!isAssigned) {
    return {
      ok: false,
      error: "Phone number is not attached to the selected Messaging Service.",
    };
  }

  return {
    ok: true,
    normalizedPhoneNumber,
    serviceFriendlyName:
      typeof service.payload?.friendly_name === "string" ? service.payload.friendly_name : null,
    phoneNumberSid: incomingNumber.sid,
  };
}

export async function sendTwilioMessageWithConfig(input: {
  config: Pick<TwilioOrgRuntimeConfig, "twilioSubaccountSid" | "twilioAuthToken" | "messagingServiceSid">;
  toNumberE164: string;
  body: string;
}): Promise<
  | {
      ok: true;
      providerMessageSid: string | null;
      providerStatus: string | null;
    }
  | {
      ok: false;
      error: string;
      providerMessageSid: string | null;
    }
> {
  const response = await twilioRequest({
    accountSid: input.config.twilioSubaccountSid,
    authToken: input.config.twilioAuthToken,
    path: "/Messages.json",
    method: "POST",
    formBody: new URLSearchParams({
      To: input.toNumberE164,
      Body: input.body,
      MessagingServiceSid: input.config.messagingServiceSid,
    }),
  });

  const providerMessageSid = typeof response.payload?.sid === "string" ? response.payload.sid : null;

  if (!response.ok) {
    return {
      ok: false,
      providerMessageSid,
      error: twilioErrorMessage(response.payload, response.status, "Twilio send failed"),
    };
  }

  return {
    ok: true,
    providerMessageSid,
    providerStatus: typeof response.payload?.status === "string" ? response.payload.status : null,
  };
}
