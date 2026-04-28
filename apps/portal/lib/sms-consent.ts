import {
  Prisma,
  type PrismaClient,
  type SmsConsent,
  type SmsConsentSource,
  type SmsConsentStatus,
} from "@prisma/client";
import { normalizeE164 } from "@/lib/phone";
import { prisma } from "@/lib/prisma";

const DEFAULT_BODY_PREVIEW_LENGTH = 120;
const LEGACY_DNC_BLOCK_COPY =
  "This contact has opted out (DNC/STOP). Sending is blocked until they reply START.";

type SmsConsentClient = Pick<PrismaClient, "smsConsent"> | Pick<Prisma.TransactionClient, "smsConsent">;
type SmsConsentBackfillClient =
  | Pick<PrismaClient, "lead" | "smsConsent">
  | Pick<Prisma.TransactionClient, "lead" | "smsConsent">;

export type SmsConsentState = {
  status: SmsConsentStatus;
  source: SmsConsentSource | null;
  lastKeyword: string | null;
  lastMessageBodyPreview: string | null;
  optedOutAt: Date | null;
  optedInAt: Date | null;
  lastUpdatedAt: Date | null;
  recordId: string | null;
};

export type SmsSendBlockState = {
  blocked: boolean;
  reason: string | null;
  reasonCode: "SMS_CONSENT_OPTED_OUT" | "LEGACY_LEAD_DNC" | null;
  consent: SmsConsentState;
};

type ConsentUpsertInput = {
  client?: SmsConsentClient;
  orgId: string;
  phoneE164: string;
  leadId?: string | null;
  customerId?: string | null;
  status: SmsConsentStatus;
  source: SmsConsentSource;
  keyword?: string | null;
  body?: string | null;
  occurredAt?: Date | null;
  metadataJson?: Prisma.InputJsonValue | null;
};

export function safeSmsConsentBodyPreview(
  value: string | null | undefined,
  maxLength = DEFAULT_BODY_PREVIEW_LENGTH,
): string | null {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function normalizeConsentPhone(phoneE164: string | null | undefined): string | null {
  return normalizeE164(phoneE164 || null) || null;
}

function defaultConsentState(): SmsConsentState {
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

function consentStateFromRecord(record: SmsConsent | null): SmsConsentState {
  if (!record) return defaultConsentState();
  return {
    status: record.status,
    source: record.source,
    lastKeyword: record.lastKeyword,
    lastMessageBodyPreview: record.lastMessageBodyPreview,
    optedOutAt: record.optedOutAt,
    optedInAt: record.optedInAt,
    lastUpdatedAt: record.lastUpdatedAt,
    recordId: record.id,
  };
}

function normalizeConsentKeyword(
  body: string | null | undefined,
  fallback: string,
): string {
  const firstToken = (body || "").trim().toUpperCase().split(/\s+/)[0] || "";
  return firstToken || fallback;
}

export async function getSmsConsentState(input: {
  client?: SmsConsentClient;
  orgId: string;
  phoneE164: string | null | undefined;
}): Promise<SmsConsentState> {
  const phoneE164 = normalizeConsentPhone(input.phoneE164);
  if (!phoneE164) return defaultConsentState();

  const client = input.client || prisma;
  const record = await client.smsConsent.findUnique({
    where: {
      orgId_phoneE164: {
        orgId: input.orgId,
        phoneE164,
      },
    },
  });

  return consentStateFromRecord(record);
}

async function upsertSmsConsent(input: ConsentUpsertInput): Promise<SmsConsentState> {
  const phoneE164 = normalizeConsentPhone(input.phoneE164);
  if (!phoneE164) {
    return defaultConsentState();
  }

  const client = input.client || prisma;
  const occurredAt = input.occurredAt || new Date();
  const keyword =
    input.keyword?.trim().toUpperCase() ||
    normalizeConsentKeyword(input.body, input.status === "OPTED_OUT" ? "STOP" : input.status === "OPTED_IN" ? "START" : "SYSTEM");
  const bodyPreview = safeSmsConsentBodyPreview(input.body);
  const metadataJson = input.metadataJson ?? Prisma.JsonNull;
  const metadataUpdate =
    input.metadataJson === undefined
      ? {}
      : { metadataJson: input.metadataJson ?? Prisma.JsonNull };

  const record = await client.smsConsent.upsert({
    where: {
      orgId_phoneE164: {
        orgId: input.orgId,
        phoneE164,
      },
    },
    create: {
      orgId: input.orgId,
      phoneE164,
      leadId: input.leadId || null,
      customerId: input.customerId || null,
      status: input.status,
      source: input.source,
      lastKeyword: keyword,
      lastMessageBodyPreview: bodyPreview,
      optedOutAt: input.status === "OPTED_OUT" ? occurredAt : null,
      optedInAt: input.status === "OPTED_IN" ? occurredAt : null,
      lastUpdatedAt: occurredAt,
      metadataJson,
    },
    update: {
      leadId: input.leadId || undefined,
      customerId: input.customerId || undefined,
      status: input.status,
      source: input.source,
      lastKeyword: keyword,
      lastMessageBodyPreview: bodyPreview,
      ...(input.status === "OPTED_OUT" ? { optedOutAt: occurredAt } : {}),
      ...(input.status === "OPTED_IN" ? { optedInAt: occurredAt } : {}),
      lastUpdatedAt: occurredAt,
      ...metadataUpdate,
    },
  });

  return consentStateFromRecord(record);
}

export async function recordSmsStop(input: {
  client?: SmsConsentClient;
  orgId: string;
  phoneE164: string;
  leadId?: string | null;
  customerId?: string | null;
  body?: string | null;
  occurredAt?: Date | null;
}): Promise<SmsConsentState> {
  return upsertSmsConsent({
    ...input,
    status: "OPTED_OUT",
    source: "TWILIO_STOP",
    keyword: normalizeConsentKeyword(input.body, "STOP"),
  });
}

export async function recordSmsStart(input: {
  client?: SmsConsentClient;
  orgId: string;
  phoneE164: string;
  leadId?: string | null;
  customerId?: string | null;
  body?: string | null;
  occurredAt?: Date | null;
}): Promise<SmsConsentState> {
  return upsertSmsConsent({
    ...input,
    status: "OPTED_IN",
    source: "TWILIO_START",
    keyword: normalizeConsentKeyword(input.body, "START"),
  });
}

export async function recordManualSmsConsentChange(input: {
  client?: SmsConsentClient;
  orgId: string;
  phoneE164: string;
  leadId?: string | null;
  customerId?: string | null;
  status: SmsConsentStatus;
  body?: string | null;
  occurredAt?: Date | null;
  metadataJson?: Prisma.InputJsonValue | null;
}): Promise<SmsConsentState> {
  return upsertSmsConsent({
    ...input,
    source: "MANUAL",
    keyword: input.status === "OPTED_OUT" ? "STOP" : input.status === "OPTED_IN" ? "START" : "UNKNOWN",
  });
}

export async function getSmsSendBlockState(input: {
  client?: SmsConsentClient;
  orgId: string;
  phoneE164: string | null | undefined;
  legacyLeadStatus?: string | null;
}): Promise<SmsSendBlockState> {
  const consent = await getSmsConsentState(input);
  if (consent.status === "OPTED_OUT") {
    return {
      blocked: true,
      reason: LEGACY_DNC_BLOCK_COPY,
      reasonCode: "SMS_CONSENT_OPTED_OUT",
      consent,
    };
  }

  if (consent.status !== "OPTED_IN" && input.legacyLeadStatus === "DNC") {
    return {
      blocked: true,
      reason: LEGACY_DNC_BLOCK_COPY,
      reasonCode: "LEGACY_LEAD_DNC",
      consent,
    };
  }

  return {
    blocked: false,
    reason: null,
    reasonCode: null,
    consent,
  };
}

export async function isSmsOptedOut(input: {
  client?: SmsConsentClient;
  orgId: string;
  phoneE164: string | null | undefined;
  legacyLeadStatus?: string | null;
}): Promise<boolean> {
  return (await getSmsSendBlockState(input)).blocked;
}

export function formatSmsConsentForDiagnostics(input: {
  consent: SmsConsentState;
  legacyLeadStatus?: string | null;
}): {
  status: SmsConsentStatus;
  source: SmsConsentSource | "none";
  lastKeyword: string | null;
  lastUpdatedAt: Date | null;
  legacyDncFallbackActive: boolean;
  operatorLabel: string;
} {
  const legacyDncFallbackActive =
    input.legacyLeadStatus === "DNC" && input.consent.status !== "OPTED_IN";
  const operatorLabel =
    input.consent.status === "OPTED_OUT"
      ? "SMS opted out"
      : input.consent.status === "OPTED_IN"
        ? "SMS opted in"
        : legacyDncFallbackActive
          ? "Legacy DNC fallback blocks SMS"
          : "SMS consent unknown";

  return {
    status: input.consent.status,
    source: input.consent.source || "none",
    lastKeyword: input.consent.lastKeyword,
    lastUpdatedAt: input.consent.lastUpdatedAt,
    legacyDncFallbackActive,
    operatorLabel,
  };
}

export async function backfillSmsConsentFromLegacyDnc(input?: {
  client?: SmsConsentBackfillClient;
  batchSize?: number;
  dryRun?: boolean;
  now?: Date;
}): Promise<{
  scanned: number;
  candidates: number;
  created: number;
  updated: number;
  skippedExplicitOptIn: number;
}> {
  const client = input?.client || prisma;
  const batchSize = Math.max(1, Math.min(1000, input?.batchSize ?? 500));
  const now = input?.now || new Date();
  const seen = new Set<string>();
  let cursor: { id: string } | undefined;
  let scanned = 0;
  let candidates = 0;
  let created = 0;
  let updated = 0;
  let skippedExplicitOptIn = 0;

  while (true) {
    const leads = await client.lead.findMany({
      where: {
        status: "DNC",
        phoneE164: { not: "" },
      },
      orderBy: { id: "asc" },
      take: batchSize,
      ...(cursor ? { cursor, skip: 1 } : {}),
      select: {
        id: true,
        orgId: true,
        customerId: true,
        phoneE164: true,
      },
    });

    if (leads.length === 0) break;
    scanned += leads.length;
    cursor = { id: leads[leads.length - 1]!.id };

    for (const lead of leads) {
      const phoneE164 = normalizeConsentPhone(lead.phoneE164);
      if (!phoneE164) continue;
      const key = `${lead.orgId}:${phoneE164}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates += 1;

      const existing = await client.smsConsent.findUnique({
        where: {
          orgId_phoneE164: {
            orgId: lead.orgId,
            phoneE164,
          },
        },
      });

      if (existing?.status === "OPTED_IN") {
        skippedExplicitOptIn += 1;
        continue;
      }

      if (input?.dryRun) {
        if (existing) updated += 1;
        else created += 1;
        continue;
      }

      if (existing) {
        await client.smsConsent.update({
          where: { id: existing.id },
          data: {
            leadId: existing.leadId || lead.id,
            customerId: existing.customerId || lead.customerId || null,
            status: "OPTED_OUT",
            source: "LEGACY_DNC_BACKFILL",
            lastKeyword: existing.lastKeyword || "DNC",
            optedOutAt: existing.optedOutAt || now,
            lastUpdatedAt: now,
          },
        });
        updated += 1;
      } else {
        await client.smsConsent.create({
          data: {
            orgId: lead.orgId,
            phoneE164,
            leadId: lead.id,
            customerId: lead.customerId || null,
            status: "OPTED_OUT",
            source: "LEGACY_DNC_BACKFILL",
            lastKeyword: "DNC",
            optedOutAt: now,
            lastUpdatedAt: now,
            metadataJson: Prisma.JsonNull,
          },
        });
        created += 1;
      }
    }
  }

  return {
    scanned,
    candidates,
    created,
    updated,
    skippedExplicitOptIn,
  };
}
