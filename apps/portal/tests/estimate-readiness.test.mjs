import assert from "node:assert/strict";
import test from "node:test";
import {
  getEstimateCustomerFacingIssues,
  isPlaceholderEstimateTitle,
  requiresEstimateCustomerFacingReadiness,
} from "../lib/estimates.ts";

test("isPlaceholderEstimateTitle detects blank and default placeholder titles", () => {
  assert.equal(isPlaceholderEstimateTitle(""), true);
  assert.equal(isPlaceholderEstimateTitle("   "), true);
  assert.equal(isPlaceholderEstimateTitle("Untitled Estimate"), true);
  assert.equal(isPlaceholderEstimateTitle("Retaining Wall Proposal"), false);
});

test("getEstimateCustomerFacingIssues blocks incomplete customer-facing estimates", () => {
  const issues = getEstimateCustomerFacingIssues({
    title: "Untitled Estimate",
    customerName: "",
    leadLabel: "",
    lineItemCount: 0,
    total: 0,
  });

  assert.deepEqual(issues, [
    "Add a specific estimate title.",
    "Attach a customer before sharing or sending this estimate.",
    "Add at least one line item before sharing or sending this estimate.",
    "Set a positive total before sharing or sending this estimate.",
  ]);
});

test("getEstimateCustomerFacingIssues allows estimates with a lead-backed customer and positive total", () => {
  const issues = getEstimateCustomerFacingIssues({
    title: "Front Yard Refresh",
    customerName: "",
    leadLabel: "Maria Lopez · +12065550100",
    lineItemCount: 2,
    total: 2450,
  });

  assert.deepEqual(issues, []);
});

test("requiresEstimateCustomerFacingReadiness only exempts draft and converted states", () => {
  assert.equal(requiresEstimateCustomerFacingReadiness("DRAFT"), false);
  assert.equal(requiresEstimateCustomerFacingReadiness("CONVERTED"), false);
  assert.equal(requiresEstimateCustomerFacingReadiness("SENT"), true);
  assert.equal(requiresEstimateCustomerFacingReadiness("APPROVED"), true);
  assert.equal(requiresEstimateCustomerFacingReadiness("EXPIRED"), true);
});
