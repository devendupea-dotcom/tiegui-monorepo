import assert from "node:assert/strict";
import test from "node:test";
import { buildLegacyLeadCleanupPatch, computeLegacyLeadCleanupSnapshot } from "../lib/legacy-lead-cleanup.ts";

test("legacy lead cleanup promotes the clean work type when its sibling field is polluted", () => {
  assert.deepEqual(
    buildLegacyLeadCleanupPatch({
      businessType:
        "regards to the vehicle you're interested in. Please reply YES so I can get these to you ASAP. Reply STOP to cancel. Message and data rates may apply.",
      intakeWorkTypeText: "Drainage and grading",
    }),
    {
      businessType: "Drainage and grading",
    },
  );
});

test("legacy lead cleanup normalizes polluted location fields toward a clean city fallback", () => {
  assert.deepEqual(
    computeLegacyLeadCleanupSnapshot({
      city: "Tacoma was",
      intakeLocationText:
        "regards to the vehicle you're interested in. Please reply YES so I can get these to you ASAP. Reply STOP to cancel. Message and data rates may apply.",
      businessType: null,
      intakeWorkTypeText: null,
    }),
    {
      city: "Tacoma",
      businessType: null,
      intakeLocationText: "Tacoma",
      intakeWorkTypeText: null,
    },
  );
});

test("legacy lead cleanup preserves full addresses while clearing polluted city values", () => {
  assert.deepEqual(
    buildLegacyLeadCleanupPatch({
      city:
        "[CUSTOMER FIRST NAME] this is [SALESPERSON FIRST NAME] @ Sunset Auto Wholsale. I have some custom videos to send you",
      intakeLocationText: "123 Main St, Tacoma, WA",
      businessType: null,
      intakeWorkTypeText: null,
    }),
    {
      city: null,
    },
  );
});
