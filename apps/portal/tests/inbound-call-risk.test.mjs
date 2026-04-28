import assert from "node:assert/strict";
import test from "node:test";
import { scoreInboundCallRisk } from "../lib/inbound-call-risk.ts";

test("scoreInboundCallRisk sends high-risk anonymous bursts straight to voicemail", () => {
  const assessment = scoreInboundCallRisk({
    fromNumberE164: null,
    stirVerstat: "TN-Validation-Failed",
    distinctRecentOrgCount: 3,
    recentCallCount: 6,
    recentMissedCount: 4,
    trustedKnownCaller: false,
  });

  assert.equal(assessment.disposition, "VOICEMAIL_ONLY");
  assert.match(assessment.reasons.join(" "), /missing_caller_id/i);
  assert.match(assessment.reasons.join(" "), /cross_org_burst/i);
});

test("scoreInboundCallRisk keeps trusted returning callers out of spam routing", () => {
  const assessment = scoreInboundCallRisk({
    fromNumberE164: "+12065550199",
    stirVerstat: "No-TN-Validation",
    distinctRecentOrgCount: 1,
    recentCallCount: 1,
    recentMissedCount: 0,
    trustedKnownCaller: true,
  });

  assert.equal(assessment.disposition, "ALLOW");
  assert.match(assessment.reasons.join(" "), /trusted_known_caller/i);
});

test("scoreInboundCallRisk honors manual CRM spam blocks immediately", () => {
  const assessment = scoreInboundCallRisk({
    fromNumberE164: "+12065550199",
    stirVerstat: "TN-Validation-Passed-A",
    distinctRecentOrgCount: 1,
    recentCallCount: 1,
    recentMissedCount: 0,
    trustedKnownCaller: true,
    crmSpamBlocked: true,
  });

  assert.equal(assessment.disposition, "VOICEMAIL_ONLY");
  assert.match(assessment.reasons.join(" "), /crm_spam_blocked/i);
});
