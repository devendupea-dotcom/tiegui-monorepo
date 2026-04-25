import type { CronLogStatus } from "@prisma/client";
import { shouldRouteLeadToSpamReview } from "@/lib/lead-spam-lane";
import { getLeadSpamReviewByLead } from "@/lib/lead-spam-review";
import { prisma } from "@/lib/prisma";
import {
  resolveTwilioMessagingReadiness,
  type TwilioMessagingReadinessCode,
} from "@/lib/twilio-readiness";

export type MessagingAutomationHealthIssueCode =
  | "LIVE_AUTOMATION_BLOCKED"
  | "DEPLOYMENT_SEND_DISABLED"
  | "INTAKE_CRON_STALE"
  | "GHOST_BUSTER_CRON_STALE"
  | "QUEUE_BACKLOG"
  | "RECENT_FAILURES";

export type MessagingAutomationHealthStatus =
  | "HEALTHY"
  | "ATTENTION"
  | "CRITICAL";

export type MessagingAutomationCronSnapshot = {
  route: string;
  monitored: boolean;
  thresholdMinutes: number;
  lastRunAt: string | null;
  lastFinishedAt: string | null;
  lastStatus: CronLogStatus | null;
  lastError: string | null;
  minutesSinceLastRun: number | null;
  stale: boolean;
};

export type MessagingAutomationFailureItem = {
  id: string;
  source: "QUEUE" | "OUTBOUND";
  leadId: string;
  contactName: string | null;
  businessName: string | null;
  phoneE164: string;
  failedAt: string;
  reason: string | null;
  spamReview: boolean;
  potentialSpam: boolean;
  failedOutboundCount: number;
};

export type MessagingAutomationHealthSummary = {
  generatedAt: string;
  readinessCode: TwilioMessagingReadinessCode;
  canSendLive: boolean;
  automationsEnabled: {
    autoReply: boolean;
    followUps: boolean;
    autoBooking: boolean;
    missedCallTextBack: boolean;
    ghostBuster: boolean;
    dispatchUpdates: boolean;
  };
  queue: {
    dueNowCount: number;
    scheduledCount: number;
    failedLast24hCount: number;
    outboundFailedLast24hCount: number;
    outboundQueuedLast24hCount: number;
    oldestDueAt: string | null;
    nextScheduledAt: string | null;
    oldestDueMinutes: number | null;
  };
  signals: {
    latestInboundSmsAt: string | null;
    latestInboundCallAt: string | null;
  };
  cron: {
    intake: MessagingAutomationCronSnapshot;
    ghostBuster: MessagingAutomationCronSnapshot;
  };
  recentFailures: MessagingAutomationFailureItem[];
  overallStatus: MessagingAutomationHealthStatus;
  issues: MessagingAutomationHealthIssueCode[];
};

type MessagingAutomationHealthEvaluationInput = {
  generatedAt: string;
  readinessCode: TwilioMessagingReadinessCode;
  canSendLive: boolean;
  automationsEnabled: MessagingAutomationHealthSummary["automationsEnabled"];
  queue: MessagingAutomationHealthSummary["queue"];
  signals: MessagingAutomationHealthSummary["signals"];
  cron: MessagingAutomationHealthSummary["cron"];
  recentFailures: MessagingAutomationHealthSummary["recentFailures"];
};

const INTAKE_CRON_ROUTE = "/api/cron/intake";
const GHOST_BUSTER_CRON_ROUTE = "/api/cron/ghost-buster";
const INTAKE_CRON_STALE_MINUTES = 20;
const GHOST_BUSTER_CRON_STALE_MINUTES = 26 * 60;

function minutesBetween(now: Date, value: Date | null): number | null {
  if (!value) {
    return null;
  }
  return Math.max(0, Math.round((now.getTime() - value.getTime()) / 60000));
}

function serializeCronSnapshot(input: {
  now: Date;
  route: string;
  monitored: boolean;
  thresholdMinutes: number;
  log: {
    startedAt: Date;
    finishedAt: Date | null;
    status: CronLogStatus;
    errorMessage: string | null;
  } | null;
}): MessagingAutomationCronSnapshot {
  const lastRunAt = input.log?.startedAt || null;
  const lastFinishedAt = input.log?.finishedAt || null;
  const minutesSinceLastRun = minutesBetween(input.now, lastRunAt);

  return {
    route: input.route,
    monitored: input.monitored,
    thresholdMinutes: input.thresholdMinutes,
    lastRunAt: lastRunAt ? lastRunAt.toISOString() : null,
    lastFinishedAt: lastFinishedAt ? lastFinishedAt.toISOString() : null,
    lastStatus: input.log?.status || null,
    lastError: input.log?.errorMessage || null,
    minutesSinceLastRun,
    stale:
      input.monitored &&
      (minutesSinceLastRun === null ||
        minutesSinceLastRun > input.thresholdMinutes),
  };
}

function trimFailureReason(value: string | null | undefined): string | null {
  const trimmed = `${value || ""}`.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length <= 180) {
    return trimmed;
  }
  return `${trimmed.slice(0, 177)}...`;
}

export function buildMessagingAutomationRecentFailures(input: {
  queueFailures: Array<{
    id: string;
    leadId: string;
    updatedAt: Date;
    lastError: string | null;
    lead: {
      contactName: string | null;
      businessName: string | null;
      phoneE164: string;
    };
  }>;
  outboundFailures: Array<{
    id: string;
    leadId: string;
    createdAt: Date;
    provider: string | null;
    lead: {
      contactName: string | null;
      businessName: string | null;
      phoneE164: string;
    };
  }>;
  spamReviewByLead: Map<
    string,
    {
      potentialSpam: boolean;
      potentialSpamSignals: readonly unknown[];
      failedOutboundCount: number;
    }
  >;
  limit?: number;
}): MessagingAutomationFailureItem[] {
  const failures: Array<MessagingAutomationFailureItem & { failedAtMs: number }> =
    [];

  for (const failure of input.queueFailures) {
    const spamReview = input.spamReviewByLead.get(failure.leadId);
    failures.push({
      id: failure.id,
      source: "QUEUE",
      leadId: failure.leadId,
      contactName: failure.lead.contactName,
      businessName: failure.lead.businessName,
      phoneE164: failure.lead.phoneE164,
      failedAt: failure.updatedAt.toISOString(),
      failedAtMs: failure.updatedAt.getTime(),
      reason:
        trimFailureReason(failure.lastError) || "Queue failed before send.",
      spamReview: shouldRouteLeadToSpamReview({
        potentialSpam: spamReview?.potentialSpam,
        potentialSpamSignals: spamReview?.potentialSpamSignals || [],
        failedOutboundCount: spamReview?.failedOutboundCount || 0,
      }),
      potentialSpam: Boolean(spamReview?.potentialSpam),
      failedOutboundCount: spamReview?.failedOutboundCount || 0,
    });
  }

  for (const failure of input.outboundFailures) {
    const spamReview = input.spamReviewByLead.get(failure.leadId);
    const provider = `${failure.provider || ""}`.trim();
    failures.push({
      id: failure.id,
      source: "OUTBOUND",
      leadId: failure.leadId,
      contactName: failure.lead.contactName,
      businessName: failure.lead.businessName,
      phoneE164: failure.lead.phoneE164,
      failedAt: failure.createdAt.toISOString(),
      failedAtMs: failure.createdAt.getTime(),
      reason: provider
        ? `${provider} delivery failed.`
        : "Outbound delivery failed.",
      spamReview: shouldRouteLeadToSpamReview({
        potentialSpam: spamReview?.potentialSpam,
        potentialSpamSignals: spamReview?.potentialSpamSignals || [],
        failedOutboundCount: spamReview?.failedOutboundCount || 0,
      }),
      potentialSpam: Boolean(spamReview?.potentialSpam),
      failedOutboundCount: spamReview?.failedOutboundCount || 0,
    });
  }

  return failures
    .sort((a, b) => b.failedAtMs - a.failedAtMs)
    .slice(0, input.limit || 8)
    .map(({ failedAtMs: _failedAtMs, ...failure }) => failure);
}

export function evaluateMessagingAutomationHealth(
  input: MessagingAutomationHealthEvaluationInput,
): MessagingAutomationHealthSummary {
  const issues = new Set<MessagingAutomationHealthIssueCode>();
  const liveAutomationEnabled =
    input.automationsEnabled.autoReply ||
    input.automationsEnabled.followUps ||
    input.automationsEnabled.autoBooking ||
    input.automationsEnabled.missedCallTextBack ||
    input.automationsEnabled.ghostBuster ||
    input.automationsEnabled.dispatchUpdates;

  if (liveAutomationEnabled) {
    if (input.readinessCode === "SEND_DISABLED") {
      issues.add("DEPLOYMENT_SEND_DISABLED");
    } else if (!input.canSendLive) {
      issues.add("LIVE_AUTOMATION_BLOCKED");
    }
  }

  if (input.cron.intake.stale) {
    issues.add("INTAKE_CRON_STALE");
  }
  if (input.cron.ghostBuster.stale) {
    issues.add("GHOST_BUSTER_CRON_STALE");
  }

  if (
    input.queue.dueNowCount >= 10 ||
    (input.queue.dueNowCount > 0 &&
      (input.queue.oldestDueMinutes === null ||
        input.queue.oldestDueMinutes >= 15))
  ) {
    issues.add("QUEUE_BACKLOG");
  }

  if (
    input.queue.failedLast24hCount >= 5 ||
    input.queue.outboundFailedLast24hCount >= 5
  ) {
    issues.add("RECENT_FAILURES");
  }

  let overallStatus: MessagingAutomationHealthStatus = "HEALTHY";
  if (
    issues.has("LIVE_AUTOMATION_BLOCKED") ||
    (issues.has("QUEUE_BACKLOG") && issues.has("INTAKE_CRON_STALE"))
  ) {
    overallStatus = "CRITICAL";
  } else if (issues.size > 0) {
    overallStatus = "ATTENTION";
  }

  return {
    generatedAt: input.generatedAt,
    readinessCode: input.readinessCode,
    canSendLive: input.canSendLive,
    automationsEnabled: input.automationsEnabled,
    queue: input.queue,
    signals: input.signals,
    cron: input.cron,
    recentFailures: input.recentFailures,
    overallStatus,
    issues: Array.from(issues),
  };
}

export async function getMessagingAutomationHealthSummary(
  orgId: string,
): Promise<MessagingAutomationHealthSummary> {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [
    organization,
    dueNowCount,
    scheduledCount,
    failedLast24hCount,
    oldestDue,
    nextScheduled,
    outboundFailedLast24hCount,
    outboundQueuedLast24hCount,
    latestInboundSms,
    latestInboundCall,
    intakeCronLog,
    ghostBusterCronLog,
    queueFailures,
    outboundFailures,
  ] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: {
        autoReplyEnabled: true,
        followUpsEnabled: true,
        autoBookingEnabled: true,
        missedCallAutoReplyOn: true,
        ghostBustingEnabled: true,
        messagingSettings: {
          select: {
            autoReplyEnabled: true,
            followUpsEnabled: true,
            autoBookingEnabled: true,
            dispatchSmsEnabled: true,
          },
        },
        twilioConfig: {
          select: {
            phoneNumber: true,
            status: true,
          },
        },
      },
    }),
    prisma.smsDispatchQueue.count({
      where: {
        orgId,
        status: "QUEUED",
        sendAfterAt: { lte: now },
      },
    }),
    prisma.smsDispatchQueue.count({
      where: {
        orgId,
        status: "QUEUED",
        sendAfterAt: { gt: now },
      },
    }),
    prisma.smsDispatchQueue.count({
      where: {
        orgId,
        status: "FAILED",
        updatedAt: { gte: dayAgo },
      },
    }),
    prisma.smsDispatchQueue.findFirst({
      where: {
        orgId,
        status: "QUEUED",
        sendAfterAt: { lte: now },
      },
      orderBy: [{ sendAfterAt: "asc" }, { createdAt: "asc" }],
      select: {
        sendAfterAt: true,
      },
    }),
    prisma.smsDispatchQueue.findFirst({
      where: {
        orgId,
        status: "QUEUED",
        sendAfterAt: { gt: now },
      },
      orderBy: [{ sendAfterAt: "asc" }, { createdAt: "asc" }],
      select: {
        sendAfterAt: true,
      },
    }),
    prisma.message.count({
      where: {
        orgId,
        direction: "OUTBOUND",
        status: "FAILED",
        createdAt: { gte: dayAgo },
      },
    }),
    prisma.message.count({
      where: {
        orgId,
        direction: "OUTBOUND",
        status: "QUEUED",
        createdAt: { gte: dayAgo },
      },
    }),
    prisma.message.findFirst({
      where: {
        orgId,
        direction: "INBOUND",
      },
      orderBy: { createdAt: "desc" },
      select: {
        createdAt: true,
      },
    }),
    prisma.call.findFirst({
      where: {
        orgId,
        direction: "INBOUND",
      },
      orderBy: { startedAt: "desc" },
      select: {
        startedAt: true,
      },
    }),
    prisma.internalCronRunLog.findFirst({
      where: {
        route: INTAKE_CRON_ROUTE,
        orgId: null,
      },
      orderBy: { startedAt: "desc" },
      select: {
        startedAt: true,
        finishedAt: true,
        status: true,
        errorMessage: true,
      },
    }),
    prisma.internalCronRunLog.findFirst({
      where: {
        route: GHOST_BUSTER_CRON_ROUTE,
        orgId: null,
      },
      orderBy: { startedAt: "desc" },
      select: {
        startedAt: true,
        finishedAt: true,
        status: true,
        errorMessage: true,
      },
    }),
    prisma.smsDispatchQueue.findMany({
      where: {
        orgId,
        status: "FAILED",
        updatedAt: { gte: dayAgo },
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: 10,
      select: {
        id: true,
        leadId: true,
        updatedAt: true,
        lastError: true,
        lead: {
          select: {
            contactName: true,
            businessName: true,
            phoneE164: true,
          },
        },
      },
    }),
    prisma.message.findMany({
      where: {
        orgId,
        direction: "OUTBOUND",
        status: "FAILED",
        createdAt: { gte: dayAgo },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        leadId: true,
        createdAt: true,
        provider: true,
        lead: {
          select: {
            contactName: true,
            businessName: true,
            phoneE164: true,
          },
        },
      },
    }),
  ]);

  const readiness = resolveTwilioMessagingReadiness({
    twilioConfig: organization.twilioConfig,
  });
  const effectiveAutoReplyEnabled =
    organization.messagingSettings?.autoReplyEnabled ??
    organization.autoReplyEnabled;
  const effectiveFollowUpsEnabled =
    organization.messagingSettings?.followUpsEnabled ??
    organization.followUpsEnabled;
  const effectiveAutoBookingEnabled =
    organization.messagingSettings?.autoBookingEnabled ??
    organization.autoBookingEnabled;
  const dispatchUpdatesEnabled =
    organization.messagingSettings?.dispatchSmsEnabled ?? false;
  const failureLeadIds = [
    ...new Set([
      ...queueFailures.map((failure) => failure.leadId),
      ...outboundFailures.map((failure) => failure.leadId),
    ]),
  ];
  const spamReviewByLead =
    failureLeadIds.length > 0
      ? await getLeadSpamReviewByLead({
          orgId,
          leads: failureLeadIds.map((leadId) => {
            const queueFailure =
              queueFailures.find((failure) => failure.leadId === leadId) || null;
            const outboundFailure =
              outboundFailures.find((failure) => failure.leadId === leadId) ||
              null;
            return {
              leadId,
              phoneE164:
                queueFailure?.lead.phoneE164 ||
                outboundFailure?.lead.phoneE164 ||
                null,
            };
          }),
        })
      : new Map();
  const recentFailures = buildMessagingAutomationRecentFailures({
    queueFailures,
    outboundFailures,
    spamReviewByLead,
  });

  return evaluateMessagingAutomationHealth({
    generatedAt: now.toISOString(),
    readinessCode: readiness.code,
    canSendLive: readiness.canSend,
    automationsEnabled: {
      autoReply: effectiveAutoReplyEnabled,
      followUps: effectiveFollowUpsEnabled,
      autoBooking: effectiveAutoBookingEnabled,
      missedCallTextBack: organization.missedCallAutoReplyOn,
      ghostBuster: organization.ghostBustingEnabled,
      dispatchUpdates: dispatchUpdatesEnabled,
    },
    queue: {
      dueNowCount,
      scheduledCount,
      failedLast24hCount,
      outboundFailedLast24hCount,
      outboundQueuedLast24hCount,
      oldestDueAt: oldestDue?.sendAfterAt
        ? oldestDue.sendAfterAt.toISOString()
        : null,
      nextScheduledAt: nextScheduled?.sendAfterAt
        ? nextScheduled.sendAfterAt.toISOString()
        : null,
      oldestDueMinutes: minutesBetween(now, oldestDue?.sendAfterAt || null),
    },
    signals: {
      latestInboundSmsAt: latestInboundSms?.createdAt
        ? latestInboundSms.createdAt.toISOString()
        : null,
      latestInboundCallAt: latestInboundCall?.startedAt
        ? latestInboundCall.startedAt.toISOString()
        : null,
    },
    cron: {
      intake: serializeCronSnapshot({
        now,
        route: INTAKE_CRON_ROUTE,
        monitored:
          effectiveAutoReplyEnabled ||
          effectiveFollowUpsEnabled ||
          effectiveAutoBookingEnabled ||
          organization.missedCallAutoReplyOn ||
          dueNowCount > 0 ||
          scheduledCount > 0,
        thresholdMinutes: INTAKE_CRON_STALE_MINUTES,
        log: intakeCronLog,
      }),
      ghostBuster: serializeCronSnapshot({
        now,
        route: GHOST_BUSTER_CRON_ROUTE,
        monitored: organization.ghostBustingEnabled,
        thresholdMinutes: GHOST_BUSTER_CRON_STALE_MINUTES,
        log: ghostBusterCronLog,
      }),
    },
    recentFailures,
  });
}
