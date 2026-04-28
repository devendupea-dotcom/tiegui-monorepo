import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { normalizeEnvValue } from "@/lib/env";
import { normalizeE164 } from "@/lib/phone";

export const WEBSITE_LEAD_MAX_BODY_BYTES = 32 * 1024;
export const WEBSITE_LEAD_TIMESTAMP_WINDOW_MS = 5 * 60 * 1000;
export const WEBSITE_LEAD_SECRET_BYTES = 32;
export const WEBSITE_LEAD_SOURCE_ID_HEADER = "x-tiegui-source-id";
export const WEBSITE_LEAD_TIMESTAMP_HEADER = "x-tiegui-timestamp";
export const WEBSITE_LEAD_SIGNATURE_HEADER = "x-tiegui-signature";
export const WEBSITE_LEAD_IDEMPOTENCY_HEADER = "x-tiegui-idempotency-key";

const SOURCE_ID_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9_-]{7,127}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,160}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_PAYLOAD_KEYS = new Set([
  "orgId",
  "name",
  "email",
  "phone",
  "reason",
  "budgetRange",
  "financingNeeded",
  "timeline",
  "message",
  "smsOptIn",
  "smsConsentText",
  "smsConsentCapturedAt",
  "smsConsentPageUrl",
  "listingSlug",
  "listingContext",
  "sourcePath",
  "pageTitle",
  "attribution",
]);

const ALLOWED_LISTING_CONTEXT_KEYS = new Set([
  "slug",
  "title",
  "homeType",
  "homeTypeSlug",
  "collection",
  "priceLabel",
  "beds",
  "baths",
  "sqft",
  "status",
  "locationLabel",
  "modelSeries",
  "href",
]);

export type WebsiteLeadAuthHeaders = {
  sourceId: string;
  timestamp: string;
  signature: string;
  idempotencyKey: string;
};

export type NormalizedWebsiteLeadPayload = {
  name: string;
  email: string;
  phoneE164: string;
  reason: string;
  budgetRange: string;
  financingNeeded: string;
  timeline: string;
  message: string;
  listingSlug: string;
  listingContext: NormalizedWebsiteLeadListingContext | null;
  sourcePath: string;
  pageTitle: string;
  attribution: Record<string, string>;
  smsOptIn: boolean;
  smsConsentText: string;
  smsConsentCapturedAt: string;
  smsConsentPageUrl: string;
};

export type NormalizedWebsiteLeadListingContext = {
  slug: string;
  title: string;
  homeType: string;
  homeTypeSlug: string;
  collection: string;
  priceLabel: string;
  beds: number | null;
  baths: string;
  sqft: number | null;
  status: string;
  locationLabel: string;
  modelSeries: string;
  href: string;
};

type Result<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      status: number;
      error: string;
      code: string;
    };

export function isProductionWebsiteLeadRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return normalizeEnvValue(env.NODE_ENV) === "production" || normalizeEnvValue(env.VERCEL_ENV) === "production";
}

export function generateWebsiteLeadSourceSecret(): string {
  return `wls_${randomBytes(WEBSITE_LEAD_SECRET_BYTES).toString("base64url")}`;
}

export function hashWebsiteLeadSourceSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function hashWebsiteLeadRequestBody(rawBody: string): string {
  return createHash("sha256").update(rawBody, "utf8").digest("hex");
}

function firstHeaderValue(value: string | null): string {
  const [first] = (value || "").split(",");
  return first?.trim() || "";
}

function normalizeSignature(value: string): string {
  const trimmed = value.trim();
  return trimmed.toLowerCase().startsWith("sha256=") ? trimmed.slice(7).trim() : trimmed;
}

export function isValidWebsiteLeadSourceId(value: string): boolean {
  return UUID_PATTERN.test(value) || SOURCE_ID_PATTERN.test(value);
}

export function isValidWebsiteLeadIdempotencyKey(value: string): boolean {
  return IDEMPOTENCY_KEY_PATTERN.test(value);
}

export function parseWebsiteLeadAuthHeaders(headers: Headers): Result<WebsiteLeadAuthHeaders> {
  const sourceId = firstHeaderValue(headers.get(WEBSITE_LEAD_SOURCE_ID_HEADER));
  const timestamp = firstHeaderValue(headers.get(WEBSITE_LEAD_TIMESTAMP_HEADER));
  const signature = firstHeaderValue(headers.get(WEBSITE_LEAD_SIGNATURE_HEADER));
  const idempotencyKey = firstHeaderValue(headers.get(WEBSITE_LEAD_IDEMPOTENCY_HEADER));

  if (!sourceId) {
    return { ok: false, status: 401, error: "Missing website lead source id.", code: "missing_source_id" };
  }
  if (!isValidWebsiteLeadSourceId(sourceId)) {
    return { ok: false, status: 400, error: "Invalid website lead source id.", code: "invalid_source_id" };
  }
  if (!timestamp) {
    return { ok: false, status: 401, error: "Missing website lead timestamp.", code: "missing_timestamp" };
  }
  if (!signature) {
    return { ok: false, status: 401, error: "Missing website lead signature.", code: "missing_signature" };
  }
  if (!idempotencyKey) {
    return { ok: false, status: 400, error: "Missing idempotency key.", code: "missing_idempotency_key" };
  }
  if (!isValidWebsiteLeadIdempotencyKey(idempotencyKey)) {
    return { ok: false, status: 400, error: "Invalid idempotency key.", code: "invalid_idempotency_key" };
  }

  return {
    ok: true,
    value: {
      sourceId,
      timestamp,
      signature,
      idempotencyKey,
    },
  };
}

export function parseWebsiteLeadTimestamp(
  timestamp: string,
  nowMs = Date.now(),
): Result<Date> {
  const trimmed = timestamp.trim();
  if (!trimmed) {
    return { ok: false, status: 401, error: "Missing website lead timestamp.", code: "missing_timestamp" };
  }

  const numericTimestamp = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
  const timestampMs =
    numericTimestamp === null
      ? Date.parse(trimmed)
      : numericTimestamp < 10_000_000_000
        ? numericTimestamp * 1000
        : numericTimestamp;

  if (!Number.isFinite(timestampMs)) {
    return { ok: false, status: 400, error: "Invalid website lead timestamp.", code: "invalid_timestamp" };
  }

  if (Math.abs(nowMs - timestampMs) > WEBSITE_LEAD_TIMESTAMP_WINDOW_MS) {
    return { ok: false, status: 401, error: "Stale website lead timestamp.", code: "stale_timestamp" };
  }

  return { ok: true, value: new Date(timestampMs) };
}

export function buildWebsiteLeadSignatureBase(input: {
  timestamp: string;
  sourceId: string;
  rawBody: string;
}): string {
  return `${input.timestamp}.${input.sourceId}.${input.rawBody}`;
}

export function createWebsiteLeadSignature(input: {
  secret: string;
  timestamp: string;
  sourceId: string;
  rawBody: string;
}): string {
  return createHmac("sha256", input.secret)
    .update(buildWebsiteLeadSignatureBase(input), "utf8")
    .digest("hex");
}

export function verifyWebsiteLeadSignature(input: {
  secret: string;
  timestamp: string;
  sourceId: string;
  rawBody: string;
  signature: string;
}): boolean {
  const expected = createWebsiteLeadSignature(input);
  const provided = normalizeSignature(input.signature);
  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}

function normalizeOrigin(value: string | null): string | null {
  const trimmed = (value || "").trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin.toLowerCase();
  } catch {
    return null;
  }
}

export function validateWebsiteLeadOrigin(input: {
  allowedOrigin: string | null | undefined;
  originHeader: string | null;
  refererHeader: string | null;
}): Result<null> {
  const allowedOrigin = normalizeOrigin(input.allowedOrigin || null);
  if (!input.allowedOrigin) {
    return { ok: true, value: null };
  }

  if (!allowedOrigin) {
    return { ok: false, status: 500, error: "Website lead source origin is misconfigured.", code: "invalid_allowed_origin" };
  }

  const requestOrigin = normalizeOrigin(input.originHeader) || normalizeOrigin(input.refererHeader);
  if (!requestOrigin) {
    return { ok: true, value: null };
  }

  if (requestOrigin !== allowedOrigin) {
    return { ok: false, status: 403, error: "Website lead origin is not allowed.", code: "origin_not_allowed" };
  }

  return { ok: true, value: null };
}

function readStringField(input: Record<string, unknown>, key: string, maxLength: number, required = false): Result<string> {
  const value = input[key];
  if (value === undefined || value === null) {
    if (required) {
      return { ok: false, status: 400, error: `${key} is required.`, code: `missing_${key}` };
    }
    return { ok: true, value: "" };
  }

  if (typeof value !== "string") {
    return { ok: false, status: 400, error: `${key} must be a string.`, code: `invalid_${key}` };
  }

  const trimmed = value.trim();
  if (required && !trimmed) {
    return { ok: false, status: 400, error: `${key} is required.`, code: `missing_${key}` };
  }

  if (trimmed.length > maxLength) {
    return { ok: false, status: 400, error: `${key} is too long.`, code: `${key}_too_long` };
  }

  return { ok: true, value: trimmed };
}

function normalizeAttribution(value: unknown): Result<Record<string, string>> {
  if (value === undefined || value === null) {
    return { ok: true, value: {} };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, status: 400, error: "attribution must be an object.", code: "invalid_attribution" };
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 24) {
    return { ok: false, status: 400, error: "attribution has too many fields.", code: "attribution_too_many_fields" };
  }

  const output: Record<string, string> = {};
  for (const [key, entryValue] of entries) {
    const trimmedKey = key.trim();
    if (!trimmedKey) continue;
    if (trimmedKey.length > 64) {
      return { ok: false, status: 400, error: "attribution key is too long.", code: "attribution_key_too_long" };
    }
    if (typeof entryValue !== "string") {
      return { ok: false, status: 400, error: "attribution values must be strings.", code: "invalid_attribution_value" };
    }
    const trimmedValue = entryValue.trim();
    if (!trimmedValue) continue;
    if (trimmedValue.length > 400) {
      return { ok: false, status: 400, error: "attribution value is too long.", code: "attribution_value_too_long" };
    }
    output[trimmedKey] = trimmedValue;
  }

  return { ok: true, value: output };
}

function normalizeIntegerField(value: unknown, key: string): Result<number | null> {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null };
  }

  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100_000) {
    return { ok: false, status: 400, error: `listingContext.${key} must be a valid number.`, code: `invalid_listing_${key}` };
  }

  return { ok: true, value: parsed };
}

function readListingStringField(input: Record<string, unknown>, key: string, maxLength: number): Result<string> {
  const value = input[key];
  if (value === undefined || value === null) {
    return { ok: true, value: "" };
  }
  if (typeof value !== "string") {
    return { ok: false, status: 400, error: `listingContext.${key} must be a string.`, code: `invalid_listing_${key}` };
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    return { ok: false, status: 400, error: `listingContext.${key} is too long.`, code: `listing_${key}_too_long` };
  }
  return { ok: true, value: trimmed };
}

function normalizeListingContext(value: unknown): Result<NormalizedWebsiteLeadListingContext | null> {
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, status: 400, error: "listingContext must be an object.", code: "invalid_listing_context" };
  }

  const input = value as Record<string, unknown>;
  const unknownKey = Object.keys(input).find((key) => !ALLOWED_LISTING_CONTEXT_KEYS.has(key));
  if (unknownKey) {
    return { ok: false, status: 400, error: `Unexpected listingContext field: ${unknownKey}.`, code: "unexpected_listing_context_field" };
  }

  const slug = readListingStringField(input, "slug", 160);
  if (!slug.ok) return slug;
  const title = readListingStringField(input, "title", 180);
  if (!title.ok) return title;
  const homeType = readListingStringField(input, "homeType", 80);
  if (!homeType.ok) return homeType;
  const homeTypeSlug = readListingStringField(input, "homeTypeSlug", 80);
  if (!homeTypeSlug.ok) return homeTypeSlug;
  const collection = readListingStringField(input, "collection", 40);
  if (!collection.ok) return collection;
  const priceLabel = readListingStringField(input, "priceLabel", 80);
  if (!priceLabel.ok) return priceLabel;
  const beds = normalizeIntegerField(input.beds, "beds");
  if (!beds.ok) return beds;
  const baths =
    typeof input.baths === "number"
      ? { ok: true as const, value: String(input.baths) }
      : readListingStringField(input, "baths", 20);
  if (!baths.ok) return baths;
  const sqft = normalizeIntegerField(input.sqft, "sqft");
  if (!sqft.ok) return sqft;
  const status = readListingStringField(input, "status", 80);
  if (!status.ok) return status;
  const locationLabel = readListingStringField(input, "locationLabel", 160);
  if (!locationLabel.ok) return locationLabel;
  const modelSeries = readListingStringField(input, "modelSeries", 120);
  if (!modelSeries.ok) return modelSeries;
  const href = readListingStringField(input, "href", 240);
  if (!href.ok) return href;

  if (!slug.value && !title.value) {
    return { ok: true, value: null };
  }

  return {
    ok: true,
    value: {
      slug: slug.value,
      title: title.value,
      homeType: homeType.value,
      homeTypeSlug: homeTypeSlug.value,
      collection: collection.value,
      priceLabel: priceLabel.value,
      beds: beds.value,
      baths: baths.value,
      sqft: sqft.value,
      status: status.value,
      locationLabel: locationLabel.value,
      modelSeries: modelSeries.value,
      href: href.value,
    },
  };
}

export function normalizeWebsiteLeadPayload(payload: unknown): Result<NormalizedWebsiteLeadPayload> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { ok: false, status: 400, error: "Invalid JSON payload.", code: "invalid_payload" };
  }

  const input = payload as Record<string, unknown>;
  const unknownKey = Object.keys(input).find((key) => !ALLOWED_PAYLOAD_KEYS.has(key));
  if (unknownKey) {
    return { ok: false, status: 400, error: `Unexpected field: ${unknownKey}.`, code: "unexpected_field" };
  }

  const name = readStringField(input, "name", 120, true);
  if (!name.ok) return name;
  const email = readStringField(input, "email", 160);
  if (!email.ok) return email;
  const phone = readStringField(input, "phone", 40, true);
  if (!phone.ok) return phone;
  const reason = readStringField(input, "reason", 120);
  if (!reason.ok) return reason;
  const budgetRange = readStringField(input, "budgetRange", 60);
  if (!budgetRange.ok) return budgetRange;
  const financingNeeded = readStringField(input, "financingNeeded", 60);
  if (!financingNeeded.ok) return financingNeeded;
  const timeline = readStringField(input, "timeline", 60);
  if (!timeline.ok) return timeline;
  const message = readStringField(input, "message", 3000);
  if (!message.ok) return message;
  const listingSlug = readStringField(input, "listingSlug", 160);
  if (!listingSlug.ok) return listingSlug;
  const listingContext = normalizeListingContext(input.listingContext);
  if (!listingContext.ok) return listingContext;
  const sourcePath = readStringField(input, "sourcePath", 200);
  if (!sourcePath.ok) return sourcePath;
  const pageTitle = readStringField(input, "pageTitle", 200);
  if (!pageTitle.ok) return pageTitle;
  const attribution = normalizeAttribution(input.attribution);
  if (!attribution.ok) return attribution;

  const phoneE164 = normalizeE164(phone.value);
  if (!phoneE164) {
    return { ok: false, status: 400, error: "A valid phone is required.", code: "invalid_phone" };
  }

  if (email.value && !EMAIL_PATTERN.test(email.value)) {
    return { ok: false, status: 400, error: "Email is invalid.", code: "invalid_email" };
  }

  const smsOptInValue = input.smsOptIn;
  if (smsOptInValue !== undefined && smsOptInValue !== null && typeof smsOptInValue !== "boolean") {
    return { ok: false, status: 400, error: "smsOptIn must be a boolean.", code: "invalid_sms_opt_in" };
  }
  const smsConsentText = readStringField(input, "smsConsentText", 1200);
  if (!smsConsentText.ok) return smsConsentText;
  const smsConsentCapturedAt = readStringField(input, "smsConsentCapturedAt", 80);
  if (!smsConsentCapturedAt.ok) return smsConsentCapturedAt;
  const smsConsentPageUrl = readStringField(input, "smsConsentPageUrl", 500);
  if (!smsConsentPageUrl.ok) return smsConsentPageUrl;
  if (smsOptInValue === true && smsConsentText.value.length < 40) {
    return {
      ok: false,
      status: 400,
      error: "smsConsentText is required when smsOptIn is true.",
      code: "missing_sms_consent_text",
    };
  }

  return {
    ok: true,
    value: {
      name: name.value,
      email: email.value,
      phoneE164,
      reason: reason.value,
      budgetRange: budgetRange.value,
      financingNeeded: financingNeeded.value,
      timeline: timeline.value,
      message: message.value,
      listingSlug: listingSlug.value,
      listingContext: listingContext.value,
      sourcePath: sourcePath.value,
      pageTitle: pageTitle.value,
      attribution: attribution.value,
      smsOptIn: smsOptInValue === true,
      smsConsentText: smsConsentText.value,
      smsConsentCapturedAt: smsConsentCapturedAt.value,
      smsConsentPageUrl: smsConsentPageUrl.value,
    },
  };
}

export function classifyWebsiteLeadReceiptReplay(
  receipt: {
    requestHash: string;
    createdLeadId: string | null;
    createdCustomerId: string | null;
  } | null,
  requestHash: string,
): "new" | "duplicate" | "conflict" | "pending" {
  if (!receipt) return "new";
  if (receipt.requestHash !== requestHash) return "conflict";
  if (receipt.createdLeadId && receipt.createdCustomerId) return "duplicate";
  return "pending";
}
