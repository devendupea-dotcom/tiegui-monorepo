import type {
  Prisma,
  PrismaClient,
  SmsConsentSource,
} from "@prisma/client";
import { normalizeE164 } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import { getSmsConsentState, type SmsConsentState } from "@/lib/sms-consent";

export type SmsOutboundAudience = "CUSTOMER" | "INTERNAL_ORG" | "INTERNAL_TEST";
export type SmsOutboundUseCase =
  | "CONVERSATIONAL"
  | "TRANSACTIONAL"
  | "MARKETING"
  | "INTERNAL_ALERT"
  | "TEST";

export type SmsOutboundComplianceBlockCode =
  | "INVALID_RECIPIENT"
  | "SMS_CONSENT_OPTED_OUT"
  | "LEGACY_LEAD_DNC"
  | "MISSING_EXPLICIT_OPT_IN"
  | "UNSUPPORTED_OPT_IN_SOURCE"
  | "MARKETING_REQUIRES_WRITTEN_CONSENT";

export type SmsOutboundComplianceAllowCode =
  | "CUSTOMER_EXPLICITLY_OPTED_IN"
  | "CUSTOMER_EXPLICIT_OPT_IN_NOT_REQUIRED"
  | "INTERNAL_ORG_MESSAGE"
  | "INTERNAL_TEST_MESSAGE";

export type SmsOutboundComplianceDecision =
  | {
      allowed: true;
      audience: SmsOutboundAudience;
      useCase: SmsOutboundUseCase;
      code: SmsOutboundComplianceAllowCode;
      reason: string | null;
      normalizedToNumberE164: string;
      consent: SmsConsentState;
    }
  | {
      allowed: false;
      audience: SmsOutboundAudience;
      useCase: SmsOutboundUseCase;
      code: SmsOutboundComplianceBlockCode;
      reason: string;
      normalizedToNumberE164: string | null;
      consent: SmsConsentState | null;
    };

type SmsOutboundComplianceClient =
  | Pick<PrismaClient, "smsConsent" | "lead">
  | Pick<Prisma.TransactionClient, "smsConsent" | "lead">;

const ACCEPTED_EXPLICIT_OPT_IN_SOURCES = new Set<SmsConsentSource>([
  "TWILIO_START",
  "MANUAL",
]);

function emptyConsentState(): SmsConsentState {
  return {
    status: "UNKNOWN",
    source: null,
    lastKeyword: null,
    lastMessageBodyPreview: null,
    optedOutAt: null,
    optedInAt: null,
    lastUpdatedAt: null,
    recordId: null,
  };
}

function block(input: {
  audience: SmsOutboundAudience;
  useCase: SmsOutboundUseCase;
  code: SmsOutboundComplianceBlockCode;
  reason: string;
  normalizedToNumberE164?: string | null;
  consent?: SmsConsentState | null;
}): SmsOutboundComplianceDecision {
  return {
    allowed: false,
    audience: input.audience,
    useCase: input.useCase,
    code: input.code,
    reason: input.reason,
    normalizedToNumberE164: input.normalizedToNumberE164 || null,
    consent: input.consent || null,
  };
}

function allow(input: {
  audience: SmsOutboundAudience;
  useCase: SmsOutboundUseCase;
  code: SmsOutboundComplianceAllowCode;
  normalizedToNumberE164: string;
  consent: SmsConsentState;
  reason?: string | null;
}): SmsOutboundComplianceDecision {
  return {
    allowed: true,
    audience: input.audience,
    useCase: input.useCase,
    code: input.code,
    reason: input.reason || null,
    normalizedToNumberE164: input.normalizedToNumberE164,
    consent: input.consent,
  };
}

async function hasLegacyDncLead(input: {
  client: SmsOutboundComplianceClient;
  orgId: string;
  phoneE164: string;
  leadId?: string | null;
  legacyLeadStatus?: string | null;
}): Promise<boolean> {
  if (input.legacyLeadStatus === "DNC") {
    return true;
  }

  if (input.legacyLeadStatus && input.legacyLeadStatus !== "DNC") {
    return false;
  }

  const lead = await input.client.lead.findFirst({
    where: input.leadId
      ? {
          id: input.leadId,
          orgId: input.orgId,
          status: "DNC",
        }
      : {
          orgId: input.orgId,
          phoneE164: input.phoneE164,
          status: "DNC",
        },
    select: { id: true },
  });

  return Boolean(lead);
}

export async function canSendSms(input: {
  client?: SmsOutboundComplianceClient;
  orgId: string;
  toNumberE164: string | null | undefined;
  audience?: SmsOutboundAudience;
  useCase?: SmsOutboundUseCase;
  leadId?: string | null;
  legacyLeadStatus?: string | null;
  requiresExplicitOptIn?: boolean;
}): Promise<SmsOutboundComplianceDecision> {
  const audience = input.audience || "CUSTOMER";
  const useCase =
    input.useCase ||
    (audience === "INTERNAL_ORG"
      ? "INTERNAL_ALERT"
      : audience === "INTERNAL_TEST"
        ? "TEST"
        : "CONVERSATIONAL");
  const normalizedToNumberE164 = normalizeE164(input.toNumberE164 || null);

  if (!normalizedToNumberE164) {
    return block({
      audience,
      useCase,
      code: "INVALID_RECIPIENT",
      reason: "SMS sending is blocked because the destination number is not valid E.164.",
    });
  }

  const client = input.client || prisma;
  const consent = await getSmsConsentState({
    client,
    orgId: input.orgId,
    phoneE164: normalizedToNumberE164,
  });

  if (audience === "INTERNAL_ORG") {
    return allow({
      audience,
      useCase,
      code: "INTERNAL_ORG_MESSAGE",
      normalizedToNumberE164,
      consent,
    });
  }

  if (audience === "INTERNAL_TEST") {
    return allow({
      audience,
      useCase,
      code: "INTERNAL_TEST_MESSAGE",
      normalizedToNumberE164,
      consent,
    });
  }

  if (useCase === "MARKETING") {
    return block({
      audience,
      useCase,
      code: "MARKETING_REQUIRES_WRITTEN_CONSENT",
      reason:
        "Marketing SMS is blocked until written promotional consent is recorded separately from service/conversational consent.",
      normalizedToNumberE164,
      consent,
    });
  }

  if (consent.status === "OPTED_OUT") {
    return block({
      audience,
      useCase,
      code: "SMS_CONSENT_OPTED_OUT",
      reason:
        "This contact has opted out (DNC/STOP). Sending is blocked until they reply START.",
      normalizedToNumberE164,
      consent,
    });
  }

  if (
    consent.status !== "OPTED_IN" &&
    (await hasLegacyDncLead({
      client,
      orgId: input.orgId,
      phoneE164: normalizedToNumberE164,
      leadId: input.leadId,
      legacyLeadStatus: input.legacyLeadStatus,
    }))
  ) {
    return block({
      audience,
      useCase,
      code: "LEGACY_LEAD_DNC",
      reason:
        "This contact has opted out (DNC/STOP). Sending is blocked until they reply START.",
      normalizedToNumberE164,
      consent,
    });
  }

  if ((input.requiresExplicitOptIn ?? true) && consent.status !== "OPTED_IN") {
    return block({
      audience,
      useCase,
      code: "MISSING_EXPLICIT_OPT_IN",
      reason:
        "Customer SMS is blocked until explicit opt-in consent is recorded for this organization.",
      normalizedToNumberE164,
      consent,
    });
  }

  if (
    consent.status === "OPTED_IN" &&
    (!consent.source || !ACCEPTED_EXPLICIT_OPT_IN_SOURCES.has(consent.source))
  ) {
    return block({
      audience,
      useCase,
      code: "UNSUPPORTED_OPT_IN_SOURCE",
      reason:
        "Customer SMS is blocked because the opt-in record does not have an accepted consent source.",
      normalizedToNumberE164,
      consent,
    });
  }

  return allow({
    audience,
    useCase,
    code:
      consent.status === "OPTED_IN"
        ? "CUSTOMER_EXPLICITLY_OPTED_IN"
        : "CUSTOMER_EXPLICIT_OPT_IN_NOT_REQUIRED",
    normalizedToNumberE164,
    consent: consent.status === "OPTED_IN" ? consent : emptyConsentState(),
  });
}
