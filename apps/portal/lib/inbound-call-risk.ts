import { prisma } from "@/lib/prisma";
import { normalizeE164 } from "@/lib/phone";
import { findBlockedCallerByPhone } from "@/lib/blocked-callers";

export type InboundCallRiskDisposition = "ALLOW" | "CAUTION" | "VOICEMAIL_ONLY";

export type InboundCallRiskAssessment = {
  score: number;
  disposition: InboundCallRiskDisposition;
  reasons: string[];
  stirVerstat: string | null;
  fromNumberE164: string | null;
  distinctRecentOrgCount: number;
  recentCallCount: number;
  recentMissedCount: number;
  trustedKnownCaller: boolean;
};

type RiskSignalInput = {
  fromNumberE164: string | null;
  stirVerstat: string | null;
  distinctRecentOrgCount: number;
  recentCallCount: number;
  recentMissedCount: number;
  trustedKnownCaller: boolean;
  crmSpamBlocked?: boolean;
};

function normalizeStirVerstat(value: string | null | undefined): string | null {
  const trimmed = `${value || ""}`.trim();
  return trimmed ? trimmed.toUpperCase() : null;
}

function stirTrustSignal(value: string | null): "PASSED" | "FAILED" | "UNKNOWN" {
  if (!value) return "UNKNOWN";
  if (value.includes("PASSED")) return "PASSED";
  if (value.includes("FAILED")) return "FAILED";
  if (value.includes("NO-TN-VALIDATION")) return "UNKNOWN";
  return "UNKNOWN";
}

export function scoreInboundCallRisk(input: RiskSignalInput): InboundCallRiskAssessment {
  const stirVerstat = normalizeStirVerstat(input.stirVerstat);
  const reasons: string[] = [];
  let score = 0;

  if (!input.fromNumberE164) {
    score += 95;
    reasons.push("missing_caller_id");
  }

  if (input.crmSpamBlocked) {
    score += 100;
    reasons.push("crm_spam_blocked");
  }

  const stirSignal = stirTrustSignal(stirVerstat);
  if (stirSignal === "FAILED") {
    score += 35;
    reasons.push("stir_failed");
  } else if (stirSignal === "UNKNOWN") {
    score += 10;
    reasons.push("stir_unknown");
  }

  if (input.distinctRecentOrgCount >= 3) {
    score += 55;
    reasons.push("cross_org_burst");
  } else if (input.distinctRecentOrgCount >= 2) {
    score += 30;
    reasons.push("cross_org_repeat");
  }

  if (input.recentCallCount >= 5) {
    score += 25;
    reasons.push("repeat_call_volume");
  } else if (input.recentCallCount >= 3) {
    score += 12;
    reasons.push("repeat_call_volume");
  }

  if (input.recentMissedCount >= 3) {
    score += 20;
    reasons.push("repeat_missed_calls");
  } else if (input.recentMissedCount >= 2) {
    score += 10;
    reasons.push("repeat_missed_calls");
  }

  if (input.trustedKnownCaller && !input.crmSpamBlocked) {
    score -= 35;
    reasons.push("trusted_known_caller");
  }

  score = Math.max(0, Math.min(100, score));

  const disposition: InboundCallRiskDisposition =
    score >= 70 ? "VOICEMAIL_ONLY" : score >= 40 ? "CAUTION" : "ALLOW";

  return {
    score,
    disposition,
    reasons,
    stirVerstat,
    fromNumberE164: input.fromNumberE164,
    distinctRecentOrgCount: input.distinctRecentOrgCount,
    recentCallCount: input.recentCallCount,
    recentMissedCount: input.recentMissedCount,
    trustedKnownCaller: input.trustedKnownCaller,
  };
}

export async function assessInboundCallRisk(input: {
  orgId: string;
  fromNumber: string | null | undefined;
  stirVerstat?: string | null;
  excludeCallSid?: string | null;
}) {
  const fromNumberE164 = normalizeE164(input.fromNumber || null);
  const stirVerstat = normalizeStirVerstat(input.stirVerstat);

  if (!fromNumberE164) {
    return scoreInboundCallRisk({
      fromNumberE164: null,
      stirVerstat,
      distinctRecentOrgCount: 0,
      recentCallCount: 0,
      recentMissedCount: 0,
      trustedKnownCaller: false,
    });
  }

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [recentCalls, existingLead, blockedCaller] = await Promise.all([
    prisma.call.findMany({
      where: {
        fromNumberE164,
        startedAt: { gte: since24h },
        ...(input.excludeCallSid ? { NOT: { twilioCallSid: input.excludeCallSid } } : {}),
      },
      select: {
        orgId: true,
        status: true,
      },
      take: 50,
      orderBy: { startedAt: "desc" },
    }),
    prisma.lead.findFirst({
      where: {
        orgId: input.orgId,
        phoneE164: fromNumberE164,
      },
      select: {
        id: true,
        customerId: true,
        lastInboundAt: true,
        lastOutboundAt: true,
        notes: true,
      },
    }),
    findBlockedCallerByPhone({
      orgId: input.orgId,
      phone: fromNumberE164,
    }),
  ]);

  const distinctRecentOrgCount = new Set(recentCalls.map((call) => call.orgId)).size;
  const recentCallCount = recentCalls.length;
  const recentMissedCount = recentCalls.filter((call) => call.status === "MISSED").length;
  const crmSpamBlocked =
    Boolean(blockedCaller) || (existingLead?.notes || "").includes("[CRM_SPAM_BLOCKED]");
  const trustedKnownCaller = Boolean(
    existingLead?.customerId || existingLead?.lastInboundAt || existingLead?.lastOutboundAt,
  );

  return scoreInboundCallRisk({
    fromNumberE164,
    stirVerstat,
    distinctRecentOrgCount,
    recentCallCount,
    recentMissedCount,
    trustedKnownCaller,
    crmSpamBlocked,
  });
}
