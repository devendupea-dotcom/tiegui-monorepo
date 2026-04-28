import { prisma } from "@/lib/prisma";
import {
  getTwilioMessagingEnvironmentSnapshot,
  resolveTwilioMessagingReadiness,
  type TwilioMessagingReadinessCode,
} from "@/lib/twilio-readiness";
import { resolveTwilioWebhookValidationMode } from "@/lib/twilio";
import {
  getMessagingAutomationHealthSummary,
  type MessagingAutomationHealthIssueCode,
  type MessagingAutomationHealthStatus,
  type MessagingAutomationHealthSummary,
} from "@/lib/messaging-automation-health";

export type SmsTrustMode = "OFF" | "DRAFT_ONLY" | "ASSISTED" | "AUTOPILOT";
export type SmsTrustVerdict = "READY" | "ATTENTION" | "BLOCKED";

export type SmsTrustBlockerCode =
  | "TWILIO_NOT_LIVE"
  | "SIGNATURE_VALIDATION_OFF"
  | "OWNER_REVIEW_QUEUE"
  | "QUEUE_BACKLOG"
  | "RECENT_FAILURES"
  | "UNMATCHED_CALLBACKS"
  | "CRON_STALE";

export type SmsTrustBlocker = {
  code: SmsTrustBlockerCode;
  label: string;
  severity: "warning" | "critical";
};

export type SmsTrustChecklistItem = {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
};

export type SmsTrustOrgEvaluationInput = {
  readinessCode: TwilioMessagingReadinessCode;
  canSendLive: boolean;
  hasTwilioConfig: boolean;
  sendEnabled: boolean;
  tokenEncryptionKeyPresent: boolean;
  webhookValidationMode: "validate" | "bypass" | "reject";
  automationHealthStatus: MessagingAutomationHealthStatus;
  automationIssues: MessagingAutomationHealthIssueCode[];
  automationsEnabled: MessagingAutomationHealthSummary["automationsEnabled"];
  reviewQueueCount: number;
  dueQueueCount: number;
  failedLast24hCount: number;
  unmatchedCallbacks30dCount: number;
};

export type SmsTrustOrgEvaluation = {
  mode: SmsTrustMode;
  verdict: SmsTrustVerdict;
  safeToAutomate: boolean;
  activeAutomationCount: number;
  blockers: SmsTrustBlocker[];
  checklist: SmsTrustChecklistItem[];
};

export type SmsTrustOrgSnapshot = SmsTrustOrgEvaluation & {
  orgId: string;
  orgName: string;
  portalVertical: string;
  readinessCode: TwilioMessagingReadinessCode;
  canSendLive: boolean;
  twilioPhoneNumber: string | null;
  health: MessagingAutomationHealthSummary | null;
  reviewQueueCount: number;
  unmatchedCallbacks30dCount: number;
  generatedAt: string;
  error: string | null;
};

export type SmsTrustCenterSnapshot = {
  generatedAt: string;
  totals: {
    organizations: number;
    ready: number;
    attention: number;
    blocked: number;
    reviewQueue: number;
    failedLast24h: number;
    unmatchedCallbacks30d: number;
  };
  environment: {
    sendEnabled: boolean;
    tokenEncryptionKeyPresent: boolean;
    webhookValidationMode: "validate" | "bypass" | "reject";
  };
  orgs: SmsTrustOrgSnapshot[];
};

function activeAutomationCount(
  automations: MessagingAutomationHealthSummary["automationsEnabled"],
): number {
  return Object.values(automations).filter(Boolean).length;
}

function hasIssue(
  issues: readonly MessagingAutomationHealthIssueCode[],
  code: MessagingAutomationHealthIssueCode,
): boolean {
  return issues.includes(code);
}

export function evaluateSmsTrustOrg(
  input: SmsTrustOrgEvaluationInput,
): SmsTrustOrgEvaluation {
  const activeCount = activeAutomationCount(input.automationsEnabled);
  const hasAutomations = activeCount > 0;
  const blockers: SmsTrustBlocker[] = [];

  if (hasAutomations && !input.canSendLive) {
    blockers.push({
      code: "TWILIO_NOT_LIVE",
      label: `Automation is enabled but Twilio is ${input.readinessCode}.`,
      severity: input.readinessCode === "SEND_DISABLED" ? "warning" : "critical",
    });
  }

  if (input.webhookValidationMode !== "validate") {
    blockers.push({
      code: "SIGNATURE_VALIDATION_OFF",
      label: "Twilio webhook signature validation is not in validate mode.",
      severity: "critical",
    });
  }

  if (input.reviewQueueCount > 0) {
    blockers.push({
      code: "OWNER_REVIEW_QUEUE",
      label: `${input.reviewQueueCount} conversation${input.reviewQueueCount === 1 ? "" : "s"} need owner review.`,
      severity: "warning",
    });
  }

  if (
    input.dueQueueCount >= 10 ||
    hasIssue(input.automationIssues, "QUEUE_BACKLOG")
  ) {
    blockers.push({
      code: "QUEUE_BACKLOG",
      label: `${input.dueQueueCount} SMS queue item${input.dueQueueCount === 1 ? "" : "s"} due now.`,
      severity: "critical",
    });
  }

  if (
    input.failedLast24hCount > 0 ||
    hasIssue(input.automationIssues, "RECENT_FAILURES")
  ) {
    blockers.push({
      code: "RECENT_FAILURES",
      label: `${input.failedLast24hCount} failed SMS event${input.failedLast24hCount === 1 ? "" : "s"} in the last 24h.`,
      severity: input.failedLast24hCount >= 5 ? "critical" : "warning",
    });
  }

  if (input.unmatchedCallbacks30dCount > 0) {
    blockers.push({
      code: "UNMATCHED_CALLBACKS",
      label: `${input.unmatchedCallbacks30dCount} unmatched Twilio callback${input.unmatchedCallbacks30dCount === 1 ? "" : "s"} in 30d.`,
      severity: "warning",
    });
  }

  if (
    hasIssue(input.automationIssues, "INTAKE_CRON_STALE") ||
    hasIssue(input.automationIssues, "GHOST_BUSTER_CRON_STALE")
  ) {
    blockers.push({
      code: "CRON_STALE",
      label: "One or more messaging automation cron jobs are stale.",
      severity: input.automationHealthStatus === "CRITICAL" ? "critical" : "warning",
    });
  }

  let mode: SmsTrustMode = "OFF";
  if (hasAutomations && input.canSendLive) {
    mode = blockers.length === 0 ? "AUTOPILOT" : "ASSISTED";
  } else if (input.hasTwilioConfig || hasAutomations) {
    mode = input.canSendLive ? "ASSISTED" : "DRAFT_ONLY";
  }

  const critical = blockers.some((blocker) => blocker.severity === "critical");
  const verdict: SmsTrustVerdict = critical
    ? "BLOCKED"
    : blockers.length > 0 || !input.canSendLive
      ? "ATTENTION"
      : "READY";

  return {
    mode,
    verdict,
    safeToAutomate: verdict === "READY" && input.canSendLive,
    activeAutomationCount: activeCount,
    blockers,
    checklist: [
      {
        key: "a2p",
        label: "A2P / sender status",
        passed: input.readinessCode === "ACTIVE",
        detail:
          input.readinessCode === "ACTIVE"
            ? "Twilio sender is active."
            : `Twilio readiness is ${input.readinessCode}.`,
      },
      {
        key: "send-env",
        label: "Live send environment",
        passed: input.sendEnabled,
        detail: input.sendEnabled
          ? "This deployment can send live SMS."
          : "This deployment is queue-only for SMS.",
      },
      {
        key: "token-key",
        label: "Credential encryption",
        passed: input.tokenEncryptionKeyPresent,
        detail: input.tokenEncryptionKeyPresent
          ? "Twilio token encryption key is present."
          : "Twilio token encryption key is missing.",
      },
      {
        key: "signature-validation",
        label: "Webhook signature validation",
        passed: input.webhookValidationMode === "validate",
        detail: `Webhook validation mode is ${input.webhookValidationMode}.`,
      },
      {
        key: "opt-out",
        label: "Automated opt-out language",
        passed: true,
        detail: "Automated and system SMS are forced through the opt-out footer guard.",
      },
      {
        key: "keywords",
        label: "STOP / START / HELP handling",
        passed: true,
        detail: "Compliance keywords are handled before conversational automation.",
      },
      {
        key: "owner-review",
        label: "Owner review handoff",
        passed: input.reviewQueueCount === 0,
        detail:
          input.reviewQueueCount === 0
            ? "No paused conversations are waiting for owner review."
            : `${input.reviewQueueCount} conversation${input.reviewQueueCount === 1 ? "" : "s"} need review.`,
      },
    ],
  };
}

function combineFailureCount(health: MessagingAutomationHealthSummary): number {
  return (
    health.queue.failedLast24hCount +
    health.queue.outboundFailedLast24hCount
  );
}

function fallbackHealth(input: {
  readinessCode: TwilioMessagingReadinessCode;
  canSendLive: boolean;
  generatedAt: string;
}): MessagingAutomationHealthSummary {
  return {
    generatedAt: input.generatedAt,
    readinessCode: input.readinessCode,
    canSendLive: input.canSendLive,
    automationsEnabled: {
      autoReply: false,
      followUps: false,
      autoBooking: false,
      missedCallTextBack: false,
      ghostBuster: false,
      dispatchUpdates: false,
    },
    queue: {
      dueNowCount: 0,
      scheduledCount: 0,
      failedLast24hCount: 0,
      outboundFailedLast24hCount: 0,
      outboundQueuedLast24hCount: 0,
      oldestDueAt: null,
      nextScheduledAt: null,
      oldestDueMinutes: null,
    },
    signals: {
      latestInboundSmsAt: null,
      latestInboundCallAt: null,
    },
    cron: {
      intake: {
        route: "/api/cron/intake",
        monitored: false,
        thresholdMinutes: 20,
        lastRunAt: null,
        lastFinishedAt: null,
        lastStatus: null,
        lastError: null,
        minutesSinceLastRun: null,
        stale: false,
      },
      ghostBuster: {
        route: "/api/cron/ghost-buster",
        monitored: false,
        thresholdMinutes: 1560,
        lastRunAt: null,
        lastFinishedAt: null,
        lastStatus: null,
        lastError: null,
        minutesSinceLastRun: null,
        stale: false,
      },
    },
    recentFailures: [],
    overallStatus: input.canSendLive ? "HEALTHY" : "ATTENTION",
    issues: [],
  };
}

export async function getSmsTrustCenterSnapshot(): Promise<SmsTrustCenterSnapshot> {
  const generatedAt = new Date();
  const day30Ago = new Date(generatedAt.getTime() - 30 * 24 * 60 * 60 * 1000);
  const env = getTwilioMessagingEnvironmentSnapshot();
  const webhookValidationMode = resolveTwilioWebhookValidationMode();

  const organizations = await prisma.organization.findMany({
    orderBy: [{ name: "asc" }],
    take: 100,
    select: {
      id: true,
      name: true,
      portalVertical: true,
      twilioConfig: {
        select: {
          phoneNumber: true,
          status: true,
        },
      },
    },
  });

  const orgs = await Promise.all(
    organizations.map(async (organization): Promise<SmsTrustOrgSnapshot> => {
      const readiness = resolveTwilioMessagingReadiness({
        twilioConfig: organization.twilioConfig,
        env,
      });

      const [reviewQueueCount, unmatchedCallbacks30dCount, healthResult] =
        await Promise.all([
          prisma.leadConversationState.count({
            where: {
              orgId: organization.id,
              stage: "HUMAN_TAKEOVER",
              stoppedAt: null,
            },
          }),
          prisma.communicationEvent.count({
            where: {
              orgId: organization.id,
              summary: "Unmatched outbound SMS status callback",
              occurredAt: { gte: day30Ago },
            },
          }),
          getMessagingAutomationHealthSummary(organization.id)
            .then((health) => ({ ok: true as const, health }))
            .catch((error: unknown) => ({
              ok: false as const,
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to load messaging automation health.",
            })),
        ]);

      const health = healthResult.ok
        ? healthResult.health
        : fallbackHealth({
            readinessCode: readiness.code,
            canSendLive: readiness.canSend,
            generatedAt: generatedAt.toISOString(),
          });
      const evaluation = evaluateSmsTrustOrg({
        readinessCode: readiness.code,
        canSendLive: readiness.canSend,
        hasTwilioConfig: readiness.hasConfig,
        sendEnabled: readiness.sendEnabled,
        tokenEncryptionKeyPresent: readiness.tokenEncryptionKeyPresent,
        webhookValidationMode,
        automationHealthStatus: health.overallStatus,
        automationIssues: health.issues,
        automationsEnabled: health.automationsEnabled,
        reviewQueueCount,
        dueQueueCount: health.queue.dueNowCount,
        failedLast24hCount: combineFailureCount(health),
        unmatchedCallbacks30dCount,
      });

      return {
        ...evaluation,
        orgId: organization.id,
        orgName: organization.name,
        portalVertical: organization.portalVertical,
        readinessCode: readiness.code,
        canSendLive: readiness.canSend,
        twilioPhoneNumber: organization.twilioConfig?.phoneNumber || null,
        health: healthResult.ok ? health : null,
        reviewQueueCount,
        unmatchedCallbacks30dCount,
        generatedAt: generatedAt.toISOString(),
        error: healthResult.ok ? null : healthResult.error,
      };
    }),
  );

  const totals = orgs.reduce(
    (current, org) => {
      current.organizations += 1;
      current.ready += org.verdict === "READY" ? 1 : 0;
      current.attention += org.verdict === "ATTENTION" ? 1 : 0;
      current.blocked += org.verdict === "BLOCKED" ? 1 : 0;
      current.reviewQueue += org.reviewQueueCount;
      current.failedLast24h += org.health ? combineFailureCount(org.health) : 0;
      current.unmatchedCallbacks30d += org.unmatchedCallbacks30dCount;
      return current;
    },
    {
      organizations: 0,
      ready: 0,
      attention: 0,
      blocked: 0,
      reviewQueue: 0,
      failedLast24h: 0,
      unmatchedCallbacks30d: 0,
    },
  );

  const orderedOrgs = [...orgs].sort((left, right) => {
    const verdictRank: Record<SmsTrustVerdict, number> = {
      BLOCKED: 0,
      ATTENTION: 1,
      READY: 2,
    };
    const verdictDelta =
      verdictRank[left.verdict] - verdictRank[right.verdict];
    if (verdictDelta !== 0) return verdictDelta;
    return left.orgName.localeCompare(right.orgName);
  });

  return {
    generatedAt: generatedAt.toISOString(),
    totals,
    environment: {
      sendEnabled: env.sendEnabled,
      tokenEncryptionKeyPresent: env.tokenEncryptionKeyPresent,
      webhookValidationMode,
    },
    orgs: orderedOrgs,
  };
}

export async function pauseOrgSmsAutomation(orgId: string): Promise<void> {
  const data = {
    autoReplyEnabled: false,
    followUpsEnabled: false,
    autoBookingEnabled: false,
  };

  await prisma.$transaction([
    prisma.organization.update({
      where: { id: orgId },
      data: {
        autoReplyEnabled: false,
        followUpsEnabled: false,
        autoBookingEnabled: false,
        missedCallAutoReplyOn: false,
        ghostBustingEnabled: false,
        intakeAutomationEnabled: false,
      },
    }),
    prisma.organizationMessagingSettings.upsert({
      where: { orgId },
      create: {
        orgId,
        ...data,
        dispatchSmsEnabled: false,
      },
      update: {
        ...data,
        dispatchSmsEnabled: false,
      },
    }),
  ]);
}
