import { createWebsiteLeadSignature } from "../lib/public-website-leads";
import { createWebsiteLeadSource } from "../lib/website-lead-sources";

type SmokeResult = {
  ok: boolean;
  leadId?: string;
  customerId?: string;
  duplicate?: boolean;
  error?: string;
};

const BASE_URL = normalizeBaseUrl(process.env.BASE_URL || "http://127.0.0.1:3001");
const VERCEL_AUTOMATION_BYPASS_SECRET = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() || "";
const SOURCE_ID = process.env.WEBSITE_LEAD_SMOKE_SOURCE_ID?.trim() || "";
const SOURCE_SECRET = process.env.WEBSITE_LEAD_SMOKE_SECRET?.trim() || "";
const SMOKE_ORG_ID = process.env.WEBSITE_LEAD_SMOKE_ORG_ID?.trim() || "";
const CREATE_SOURCE = process.env.CREATE_WEBSITE_LEAD_SMOKE_SOURCE === "1";
const ALLOWED_ORIGIN = process.env.WEBSITE_LEAD_SMOKE_ALLOWED_ORIGIN?.trim() || "";
const EXPECT_ORIGIN_REJECTION = process.env.WEBSITE_LEAD_SMOKE_EXPECT_ORIGIN_REJECTION === "1";
const REQUEST_TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 15_000);

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function createSmokeHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);
  if (VERCEL_AUTOMATION_BYPASS_SECRET) {
    headers.set("x-vercel-protection-bypass", VERCEL_AUTOMATION_BYPASS_SECRET);
  }
  return headers;
}

function createPayload(label: string) {
  return {
    name: `Website Lead Smoke ${label}`,
    phone: "+12065550100",
    email: `website-lead-smoke-${label}@example.com`,
    reason: "Smoke test",
    budgetRange: "$10k-$25k",
    timeline: "Next 30 days",
    message: `Signed website lead smoke test ${label}.`,
    sourcePath: "/smoke",
    pageTitle: "Website Lead Smoke",
    smsOptIn: true,
    smsConsentText:
      "By checking this box, I agree to receive customer service and appointment text messages from the business. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help. Mobile information will not be shared with third parties for marketing or promotional purposes.",
    smsConsentCapturedAt: new Date().toISOString(),
    smsConsentPageUrl: "https://example.com/smoke",
    attribution: {
      utm_source: "smoke",
      utm_medium: "test",
    },
  };
}

async function postSignedLead(input: {
  sourceId: string;
  secret: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  timestamp?: string;
  signatureOverride?: string;
  origin?: string;
}): Promise<{ status: number; body: SmokeResult }> {
  const rawBody = JSON.stringify(input.payload);
  const timestamp = input.timestamp || new Date().toISOString();
  const signature =
    input.signatureOverride ||
    createWebsiteLeadSignature({
      secret: input.secret,
      timestamp,
      sourceId: input.sourceId,
      rawBody,
    });

  const headers = createSmokeHeaders({
    "Content-Type": "application/json",
    "X-TieGui-Source-Id": input.sourceId,
    "X-TieGui-Timestamp": timestamp,
    "X-TieGui-Signature": signature,
    "X-TieGui-Idempotency-Key": input.idempotencyKey,
  });
  if (input.origin) {
    headers.set("Origin", input.origin);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const response = await fetch(`${BASE_URL}/api/public/website-leads`, {
      method: "POST",
      headers,
      body: rawBody,
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));
  const body = (await response.json().catch(() => ({}))) as SmokeResult;
  return { status: response.status, body };
}

function assertStatus(label: string, actual: number, expected: number | number[]) {
  const expectedStatuses = Array.isArray(expected) ? expected : [expected];
  if (!expectedStatuses.includes(actual)) {
    throw new Error(`${label} expected ${expectedStatuses.join("/")} but got ${actual}`);
  }
}

async function resolveSource(): Promise<{
  sourceId: string;
  secret: string;
  originCheckConfigured: boolean;
}> {
  if (CREATE_SOURCE) {
    if (!SMOKE_ORG_ID) {
      throw new Error("WEBSITE_LEAD_SMOKE_ORG_ID is required when CREATE_WEBSITE_LEAD_SMOKE_SOURCE=1.");
    }
    const result = await createWebsiteLeadSource({
      orgId: SMOKE_ORG_ID,
      name: `Website Lead Smoke ${new Date().toISOString()}`,
      description: "Temporary source created by smoke-website-leads.ts.",
      allowedOrigin: ALLOWED_ORIGIN || "https://website-lead-smoke.example",
    });
    return {
      sourceId: result.source.id,
      secret: result.plaintextSecret,
      originCheckConfigured: true,
    };
  }

  if (!SOURCE_ID || !SOURCE_SECRET) {
    throw new Error(
      "Set WEBSITE_LEAD_SMOKE_SOURCE_ID and WEBSITE_LEAD_SMOKE_SECRET, or set CREATE_WEBSITE_LEAD_SMOKE_SOURCE=1 with WEBSITE_LEAD_SMOKE_ORG_ID.",
    );
  }

  return {
    sourceId: SOURCE_ID,
    secret: SOURCE_SECRET,
    originCheckConfigured: EXPECT_ORIGIN_REJECTION,
  };
}

async function main() {
  const source = await resolveSource();
  const runId = `${Date.now()}`;
  const idempotencyKey = `website-lead-smoke-${runId}`;
  const payload = createPayload(runId);

  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Source ID: ${source.sourceId}`);

  const created = await postSignedLead({
    sourceId: source.sourceId,
    secret: source.secret,
    payload,
    idempotencyKey,
  });
  assertStatus("valid signed submission", created.status, 201);
  console.log(`PASS valid signed submission lead=${created.body.leadId || "unknown"}`);

  const duplicate = await postSignedLead({
    sourceId: source.sourceId,
    secret: source.secret,
    payload,
    idempotencyKey,
  });
  assertStatus("duplicate idempotent submission", duplicate.status, 200);
  if (!duplicate.body.duplicate) {
    throw new Error("duplicate idempotent submission did not report duplicate=true.");
  }
  console.log("PASS duplicate idempotency returned existing result");

  const conflict = await postSignedLead({
    sourceId: source.sourceId,
    secret: source.secret,
    payload: createPayload(`${runId}-conflict`),
    idempotencyKey,
  });
  assertStatus("conflicting idempotency body", conflict.status, 409);
  console.log("PASS conflicting idempotency body rejected");

  const stale = await postSignedLead({
    sourceId: source.sourceId,
    secret: source.secret,
    payload: createPayload(`${runId}-stale`),
    idempotencyKey: `${idempotencyKey}-stale`,
    timestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  });
  assertStatus("stale timestamp", stale.status, 401);
  console.log("PASS stale timestamp rejected");

  const badSignature = await postSignedLead({
    sourceId: source.sourceId,
    secret: source.secret,
    payload: createPayload(`${runId}-bad-signature`),
    idempotencyKey: `${idempotencyKey}-bad-signature`,
    signatureOverride: "0".repeat(64),
  });
  assertStatus("wrong signature", badSignature.status, 401);
  console.log("PASS wrong signature rejected");

  if (source.originCheckConfigured) {
    const wrongOrigin = await postSignedLead({
      sourceId: source.sourceId,
      secret: source.secret,
      payload: createPayload(`${runId}-wrong-origin`),
      idempotencyKey: `${idempotencyKey}-wrong-origin`,
      origin: "https://wrong-origin.example",
    });
    assertStatus("wrong origin", wrongOrigin.status, 403);
    console.log("PASS wrong origin rejected");
  } else {
    console.log("SKIP wrong origin rejection because the smoke source origin is not declared to this script.");
  }

  console.log("Website lead smoke passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
