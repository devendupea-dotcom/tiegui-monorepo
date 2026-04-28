import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEstimateShareEmailDraft,
  canCreateEstimateShare,
  canCustomerRespondToEstimate,
  deriveEstimateShareState,
  deriveShareExpiry,
  normalizeOptionalShareText,
} from "../lib/estimate-share.ts";

test("estimate share creation is limited to shareable statuses", () => {
  assert.equal(canCreateEstimateShare("DRAFT"), false);
  assert.equal(canCreateEstimateShare("SENT"), true);
  assert.equal(canCreateEstimateShare("VIEWED"), true);
  assert.equal(canCreateEstimateShare("APPROVED"), true);
  assert.equal(canCreateEstimateShare("DECLINED"), false);
  assert.equal(canCreateEstimateShare("CONVERTED"), false);
});

test("customer responses are blocked once the estimate is finalized", () => {
  assert.equal(canCustomerRespondToEstimate("DRAFT"), false);
  assert.equal(canCustomerRespondToEstimate("SENT"), true);
  assert.equal(canCustomerRespondToEstimate("VIEWED"), true);
  assert.equal(canCustomerRespondToEstimate("APPROVED"), false);
  assert.equal(canCustomerRespondToEstimate("DECLINED"), false);
  assert.equal(canCustomerRespondToEstimate("CONVERTED"), false);
});

test("deriveEstimateShareState prioritizes revocation and final decisions", () => {
  const now = new Date("2026-03-01T12:00:00.000Z");
  const future = new Date("2026-03-10T12:00:00.000Z");

  assert.equal(
    deriveEstimateShareState({
      revokedAt: now,
      expiresAt: future,
      approvedAt: future,
      declinedAt: null,
    }),
    "REVOKED",
  );

  assert.equal(
    deriveEstimateShareState({
      revokedAt: null,
      expiresAt: future,
      approvedAt: future,
      declinedAt: null,
    }),
    "APPROVED",
  );

  assert.equal(
    deriveEstimateShareState({
      revokedAt: null,
      expiresAt: new Date("2026-02-01T12:00:00.000Z"),
      approvedAt: null,
      declinedAt: null,
    }),
    "EXPIRED",
  );
});

test("deriveShareExpiry prefers a future valid-until date and otherwise defaults to 30 days", () => {
  const now = new Date("2026-03-01T12:00:00.000Z");
  const future = new Date("2026-03-15T12:00:00.000Z");

  assert.equal(
    deriveShareExpiry({
      validUntil: future,
      now,
    })?.toISOString(),
    future.toISOString(),
  );

  assert.equal(
    deriveShareExpiry({
      validUntil: new Date("2026-02-15T12:00:00.000Z"),
      now,
    })?.toISOString(),
    new Date("2026-03-31T12:00:00.000Z").toISOString(),
  );
});

test("normalizeOptionalShareText trims input and enforces max length", () => {
  assert.equal(normalizeOptionalShareText("  Customer Name  ", "Recipient name", 40), "Customer Name");
  assert.equal(normalizeOptionalShareText("   ", "Recipient name", 40), null);
  assert.throws(
    () => normalizeOptionalShareText("x".repeat(41), "Recipient name", 40),
    /Recipient name must be 40 characters or less/,
  );
});

test("buildEstimateShareEmailDraft uses proposal-style copy with a clear next step", () => {
  const draft = buildEstimateShareEmailDraft({
    estimate: {
      estimateNumber: "EST-1007",
      title: "Front yard refresh",
      customerName: "Maria",
      siteAddress: "123 Main St",
      projectType: "Landscaping",
      total: 2450,
      validUntil: "2026-03-22T00:00:00.000Z",
    },
    shareUrl: "https://app.tieguisolutions.com/estimate/abc123",
    recipientName: "Maria",
    senderName: "TieGui",
    senderPhone: "(555) 111-2222",
    senderEmail: "office@tiegui.com",
  });

  assert.match(draft.subject, /Your estimate from TieGui/);
  assert.match(draft.body, /Front yard refresh/);
  assert.match(draft.body, /Total investment/);
  assert.match(draft.body, /https:\/\/app\.tieguisolutions\.com\/estimate\/abc123/);
  assert.match(draft.body, /Review and approve your estimate here/);
  assert.match(draft.body, /will follow up to confirm scheduling and next steps/);
  assert.match(draft.body, /office@tiegui\.com/);
});
