import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeLeadBusinessTypeLabel } from "../lib/lead-display.ts";

test("sanitizeLeadBusinessTypeLabel keeps plausible project types", () => {
  assert.equal(sanitizeLeadBusinessTypeLabel("Retaining wall"), "Retaining wall");
  assert.equal(sanitizeLeadBusinessTypeLabel("Front yard drainage and grading"), "Front yard drainage and grading");
});

test("sanitizeLeadBusinessTypeLabel removes polluted or implausible work type values", () => {
  assert.equal(
    sanitizeLeadBusinessTypeLabel(
      "[CUSTOMER FIRST NAME] this is [SALESPERSON FIRST NAME] @ Sunset Auto Wholsale. I have some custom videos to send you",
    ),
    null,
  );
  assert.equal(
    sanitizeLeadBusinessTypeLabel(
      "regards to the vehicle you're interested in. Please reply YES so I can get these to you ASAP. Reply STOP to cancel. Message and data rates may apply.",
    ),
    null,
  );
  assert.equal(sanitizeLeadBusinessTypeLabel("What's up. Looking for"), null);
});
