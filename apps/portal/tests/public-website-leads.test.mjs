import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  classifyWebsiteLeadReceiptReplay,
  createWebsiteLeadSignature,
  generateWebsiteLeadSourceSecret,
  hashWebsiteLeadRequestBody,
  hashWebsiteLeadSourceSecret,
  normalizeWebsiteLeadPayload,
  parseWebsiteLeadAuthHeaders,
  parseWebsiteLeadTimestamp,
  validateWebsiteLeadOrigin,
  verifyWebsiteLeadSignature,
  WEBSITE_LEAD_IDEMPOTENCY_HEADER,
  WEBSITE_LEAD_SIGNATURE_HEADER,
  WEBSITE_LEAD_SOURCE_ID_HEADER,
  WEBSITE_LEAD_TIMESTAMP_HEADER,
} from "../lib/public-website-leads.ts";

const portalRoot = new URL("..", import.meta.url);

function buildHeaders(overrides = {}) {
  return new Headers({
    [WEBSITE_LEAD_SOURCE_ID_HEADER]: "source_123456",
    [WEBSITE_LEAD_TIMESTAMP_HEADER]: String(Date.now()),
    [WEBSITE_LEAD_SIGNATURE_HEADER]: "a".repeat(64),
    [WEBSITE_LEAD_IDEMPOTENCY_HEADER]: "lead-123456",
    ...overrides,
  });
}

test("website lead auth requires source id, timestamp, signature, and idempotency key", () => {
  assert.equal(parseWebsiteLeadAuthHeaders(buildHeaders()).ok, true);
  assert.equal(parseWebsiteLeadAuthHeaders(buildHeaders({ [WEBSITE_LEAD_SOURCE_ID_HEADER]: "" })).code, "missing_source_id");
  assert.equal(parseWebsiteLeadAuthHeaders(buildHeaders({ [WEBSITE_LEAD_TIMESTAMP_HEADER]: "" })).code, "missing_timestamp");
  assert.equal(parseWebsiteLeadAuthHeaders(buildHeaders({ [WEBSITE_LEAD_SIGNATURE_HEADER]: "" })).code, "missing_signature");
  assert.equal(
    parseWebsiteLeadAuthHeaders(buildHeaders({ [WEBSITE_LEAD_IDEMPOTENCY_HEADER]: "" })).code,
    "missing_idempotency_key",
  );
});

test("website lead auth rejects unsafe source and idempotency formats", () => {
  assert.equal(
    parseWebsiteLeadAuthHeaders(buildHeaders({ [WEBSITE_LEAD_SOURCE_ID_HEADER]: "../bad" })).code,
    "invalid_source_id",
  );
  assert.equal(
    parseWebsiteLeadAuthHeaders(buildHeaders({ [WEBSITE_LEAD_IDEMPOTENCY_HEADER]: "bad key with spaces" })).code,
    "invalid_idempotency_key",
  );
});

test("website lead timestamp allows fresh unix and ISO values and rejects stale values", () => {
  const nowMs = Date.parse("2026-04-26T12:00:00.000Z");

  assert.equal(parseWebsiteLeadTimestamp(String(nowMs), nowMs).ok, true);
  assert.equal(parseWebsiteLeadTimestamp(String(Math.floor(nowMs / 1000)), nowMs).ok, true);
  assert.equal(parseWebsiteLeadTimestamp("2026-04-26T12:00:00.000Z", nowMs).ok, true);
  assert.equal(parseWebsiteLeadTimestamp("2026-04-26T11:54:59.000Z", nowMs).code, "stale_timestamp");
  assert.equal(parseWebsiteLeadTimestamp("not-a-date", nowMs).code, "invalid_timestamp");
});

test("website lead HMAC verifies only source-specific signatures", () => {
  const secret = generateWebsiteLeadSourceSecret();
  const rawBody = JSON.stringify({ name: "Cesar", phone: "+12065550100" });
  const timestamp = "1777200000000";
  const sourceId = "source_123456";
  const signature = createWebsiteLeadSignature({
    secret,
    timestamp,
    sourceId,
    rawBody,
  });

  assert.equal(
    verifyWebsiteLeadSignature({
      secret,
      timestamp,
      sourceId,
      rawBody,
      signature: `sha256=${signature}`,
    }),
    true,
  );
  assert.equal(
    verifyWebsiteLeadSignature({
      secret: `${secret}-wrong`,
      timestamp,
      sourceId,
      rawBody,
      signature,
    }),
    false,
  );
  assert.equal(
    verifyWebsiteLeadSignature({
      secret,
      timestamp,
      sourceId: "source_999999",
      rawBody,
      signature,
    }),
    false,
  );
});

test("website lead source secrets are generated once and hash without exposing plaintext", () => {
  const secret = generateWebsiteLeadSourceSecret();
  const hash = hashWebsiteLeadSourceSecret(secret);

  assert.match(secret, /^wls_/);
  assert.equal(hash.length, 64);
  assert.notEqual(hash, secret);
});

test("website lead origin binding rejects clearly wrong origins but allows server-to-server requests", () => {
  assert.equal(
    validateWebsiteLeadOrigin({
      allowedOrigin: "https://example.com",
      originHeader: "https://example.com/contact",
      refererHeader: null,
    }).ok,
    true,
  );
  assert.equal(
    validateWebsiteLeadOrigin({
      allowedOrigin: "https://example.com",
      originHeader: null,
      refererHeader: null,
    }).ok,
    true,
  );
  assert.equal(
    validateWebsiteLeadOrigin({
      allowedOrigin: "https://example.com",
      originHeader: "https://evil.example",
      refererHeader: null,
    }).code,
    "origin_not_allowed",
  );
});

test("website lead payload validation rejects malformed and abusive bodies", () => {
  assert.equal(normalizeWebsiteLeadPayload(null).code, "invalid_payload");
  assert.equal(normalizeWebsiteLeadPayload({ phone: "+12065550100" }).code, "missing_name");
  assert.equal(normalizeWebsiteLeadPayload({ name: "Cesar" }).code, "missing_phone");
  assert.equal(normalizeWebsiteLeadPayload({ name: "Cesar", phone: "not-a-phone" }).code, "invalid_phone");
  assert.equal(
    normalizeWebsiteLeadPayload({
      name: "Cesar",
      phone: "+12065550100",
      message: "a".repeat(3001),
    }).code,
    "message_too_long",
  );
  assert.equal(
    normalizeWebsiteLeadPayload({
      name: "Cesar",
      phone: "+12065550100",
      unknown: true,
    }).code,
    "unexpected_field",
  );
});

test("website lead payload ignores caller orgId and normalizes safe lead data", () => {
  const result = normalizeWebsiteLeadPayload({
    orgId: "attacker-org",
    name: " Cesar ",
    phone: "(206) 555-0100",
    email: "cesar@example.com",
    attribution: {
      utm_source: "google",
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.name, "Cesar");
  assert.equal(result.value.phoneE164, "+12065550100");
  assert.equal("orgId" in result.value, false);
});

test("website lead receipt classifier prevents duplicate and conflicting idempotency use", () => {
  const requestHash = hashWebsiteLeadRequestBody(JSON.stringify({ name: "Cesar" }));

  assert.equal(classifyWebsiteLeadReceiptReplay(null, requestHash), "new");
  assert.equal(
    classifyWebsiteLeadReceiptReplay(
      {
        requestHash,
        createdLeadId: "lead_1",
        createdCustomerId: "customer_1",
      },
      requestHash,
    ),
    "duplicate",
  );
  assert.equal(
    classifyWebsiteLeadReceiptReplay(
      {
        requestHash: "different",
        createdLeadId: "lead_1",
        createdCustomerId: "customer_1",
      },
      requestHash,
    ),
    "conflict",
  );
  assert.equal(
    classifyWebsiteLeadReceiptReplay(
      {
        requestHash,
        createdLeadId: null,
        createdCustomerId: null,
      },
      requestHash,
    ),
    "pending",
  );
});

test("website lead route no longer accepts the legacy global-secret org override path", async () => {
  const source = await readFile(new URL("app/api/public/website-leads/route.ts", portalRoot), "utf8");

  assert.doesNotMatch(source, /WEBSITE_LEAD_WEBHOOK_SECRET/);
  assert.doesNotMatch(source, /WEBSITE_LEAD_ALLOWED_ORG_IDS/);
  assert.match(source, /websiteLeadSource\.findUnique/);
  assert.match(source, /!source\.active/);
  assert.match(source, /source\.orgId/);
  assert.match(source, /websiteLeadSubmissionReceipt\.create/);
  assert.match(source, /lead\.create/);
  assert.match(source, /rl:public:website-leads:source/);
  assert.match(source, /idempotencyKey/);
});
