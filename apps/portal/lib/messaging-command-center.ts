import type { TwilioConfigStatus } from "@prisma/client";
import {
  resolveTwilioMessagingReadiness,
  type TwilioMessagingEnvironmentSnapshot,
  type TwilioMessagingReadinessCode,
} from "@/lib/twilio-readiness";

export type MessagingCommandCenterIssueSeverity = "critical" | "warning";

export type MessagingCommandCenterIssue = {
  code: string;
  severity: MessagingCommandCenterIssueSeverity;
  title: string;
  detail: string;
  action: string;
};

export type MessagingCommandCenterTraffic = {
  inbound30d: number;
  outbound30d: number;
  sent30d: number;
  delivered30d: number;
  queued30d: number;
  failed30d: number;
  unmatchedStatusCallbacks30d: number;
  dncLeadCount: number;
  overdueQueueCount: number;
};

export type MessagingCommandCenterLatestSignals = {
  inboundAt: Date | null;
  outboundAt: Date | null;
  statusCallbackAt: Date | null;
  voiceAt: Date | null;
};

export type MessagingCommandCenterOrgInput = {
  orgId: string;
  orgName: string;
  twilioConfig:
    | {
        phoneNumber: string | null;
        status: TwilioConfigStatus | null;
        updatedAt?: Date | null;
      }
    | null;
  env: TwilioMessagingEnvironmentSnapshot & {
    validateSignature: boolean;
  };
  traffic: MessagingCommandCenterTraffic;
  latest: MessagingCommandCenterLatestSignals;
  now?: Date;
  staleStatusCallbackHours?: number;
};

export type MessagingCommandCenterOrgReport = {
  orgId: string;
  orgName: string;
  readinessCode: TwilioMessagingReadinessCode;
  canSend: boolean;
  hasTwilioConfig: boolean;
  traffic: MessagingCommandCenterTraffic;
  latest: MessagingCommandCenterLatestSignals;
  issues: MessagingCommandCenterIssue[];
  criticalIssueCount: number;
  warningIssueCount: number;
  state: "ready" | "blocked" | "warning" | "not_configured";
};

export type MessagingCommandCenterSummary = {
  totalOrgs: number;
  liveReady: number;
  blocked: number;
  warning: number;
  notConfigured: number;
  failed30d: number;
  unmatchedStatusCallbacks30d: number;
  overdueQueueCount: number;
  dncLeadCount: number;
};

export type MessagingCommandCenterReport = {
  generatedAt: Date;
  summary: MessagingCommandCenterSummary;
  orgs: MessagingCommandCenterOrgReport[];
};

function issue(
  severity: MessagingCommandCenterIssueSeverity,
  code: string,
  title: string,
  detail: string,
  action: string,
): MessagingCommandCenterIssue {
  return { severity, code, title, detail, action };
}

function readinessIssue(
  code: TwilioMessagingReadinessCode,
): MessagingCommandCenterIssue | null {
  switch (code) {
    case "NOT_CONFIGURED":
      return issue(
        "warning",
        "TWILIO_NOT_CONFIGURED",
        "Twilio is not configured",
        "This organization has no saved Twilio sender config.",
        "Create the org Twilio config, validate the Messaging Service, and send a test SMS.",
      );
    case "TOKEN_KEY_MISSING":
      return issue(
        "critical",
        "TWILIO_TOKEN_KEY_MISSING",
        "Token encryption key is missing",
        "The runtime cannot decrypt org Twilio auth tokens, so live sends are blocked.",
        "Set TWILIO_TOKEN_ENCRYPTION_KEY in this deployment and redeploy.",
      );
    case "PAUSED":
      return issue(
        "critical",
        "TWILIO_PAUSED",
        "Messaging is paused",
        "This org's Twilio config is explicitly paused.",
        "Resolve the account or compliance issue, then reactivate the org Twilio config.",
      );
    case "PENDING_A2P":
      return issue(
        "warning",
        "TWILIO_PENDING_A2P",
        "A2P approval is pending",
        "This org is configured but should not be treated as live until registration is active.",
        "Confirm campaign approval in Twilio, then mark the org Twilio status ACTIVE.",
      );
    case "SEND_DISABLED":
      return issue(
        "critical",
        "TWILIO_SEND_DISABLED",
        "Live SMS sending is disabled",
        "The org has Twilio config, but this runtime has TWILIO_SEND_ENABLED disabled.",
        "Enable TWILIO_SEND_ENABLED only after staging validation passes.",
      );
    case "ACTIVE":
      return null;
    default:
      return issue(
        "critical",
        "TWILIO_UNKNOWN_READINESS",
        "Unknown Twilio readiness state",
        "The runtime returned an unrecognized messaging readiness code.",
        "Review the readiness resolver before treating this org as live.",
      );
  }
}

export function buildMessagingCommandCenterOrgReport(
  input: MessagingCommandCenterOrgInput,
): MessagingCommandCenterOrgReport {
  const now = input.now || new Date();
  const staleStatusCallbackMs =
    (input.staleStatusCallbackHours ?? 72) * 60 * 60 * 1000;
  const readiness = resolveTwilioMessagingReadiness({
    twilioConfig: input.twilioConfig
      ? {
          phoneNumber: input.twilioConfig.phoneNumber,
          status: input.twilioConfig.status,
        }
      : null,
    env: input.env,
  });

  const issues: MessagingCommandCenterIssue[] = [];
  const primaryReadinessIssue = readinessIssue(readiness.code);
  if (primaryReadinessIssue) {
    issues.push(primaryReadinessIssue);
  }

  if (!input.env.validateSignature) {
    issues.push(
      issue(
        "critical",
        "TWILIO_SIGNATURE_VALIDATION_DISABLED",
        "Webhook signature validation is disabled",
        "Twilio webhook traffic must fail closed in production. This runtime is not reporting signature validation as enabled.",
        "Set TWILIO_VALIDATE_SIGNATURE=true and verify Twilio webhook signatures in staging.",
      ),
    );
  }

  if (
    input.traffic.outbound30d > 0 &&
    !input.latest.statusCallbackAt &&
    readiness.hasConfig
  ) {
    issues.push(
      issue(
        "warning",
        "NO_STATUS_CALLBACKS",
        "No status callbacks recorded",
        "Outbound SMS exists in the last 30 days, but no Twilio delivery status callbacks were recorded.",
        "Confirm the Messaging Service status callback URL points to /api/webhooks/twilio/sms/status.",
      ),
    );
  }

  if (
    input.latest.statusCallbackAt &&
    input.traffic.outbound30d > 0 &&
    now.getTime() - input.latest.statusCallbackAt.getTime() >
      staleStatusCallbackMs
  ) {
    issues.push(
      issue(
        "warning",
        "STALE_STATUS_CALLBACKS",
        "Status callbacks look stale",
        "The org has recent outbound traffic, but the latest Twilio status callback is older than the expected window.",
        "Send a controlled test SMS and confirm a fresh callback is recorded.",
      ),
    );
  }

  if (input.traffic.unmatchedStatusCallbacks30d > 0) {
    issues.push(
      issue(
        input.traffic.unmatchedStatusCallbacks30d >= 5 ? "critical" : "warning",
        "UNMATCHED_STATUS_CALLBACKS",
        "Unmatched status callbacks exist",
        "Twilio reported delivery updates that could not be matched to local message records.",
        "Investigate Message SID routing, webhook org resolution, and callback timing.",
      ),
    );
  }

  if (input.traffic.failed30d > 0) {
    issues.push(
      issue(
        input.traffic.failed30d >= 5 ? "critical" : "warning",
        "RECENT_SMS_FAILURES",
        "Recent outbound SMS failures",
        "This org has failed outbound SMS in the last 30 days.",
        "Open the org Twilio page and review failure classification before retrying.",
      ),
    );
  }

  if (input.traffic.overdueQueueCount > 0) {
    issues.push(
      issue(
        input.traffic.overdueQueueCount >= 10 ? "critical" : "warning",
        "OVERDUE_SMS_QUEUE",
        "SMS queue has overdue work",
        "Queued automation SMS are past their scheduled send time.",
        "Check dispatch automation, rate limits, and Twilio readiness before draining the queue.",
      ),
    );
  }

  const criticalIssueCount = issues.filter(
    (item) => item.severity === "critical",
  ).length;
  const warningIssueCount = issues.filter(
    (item) => item.severity === "warning",
  ).length;
  const state =
    readiness.code === "NOT_CONFIGURED"
      ? "not_configured"
      : criticalIssueCount > 0
        ? "blocked"
        : warningIssueCount > 0
          ? "warning"
          : "ready";

  return {
    orgId: input.orgId,
    orgName: input.orgName,
    readinessCode: readiness.code,
    canSend: readiness.canSend && criticalIssueCount === 0,
    hasTwilioConfig: readiness.hasConfig,
    traffic: input.traffic,
    latest: input.latest,
    issues,
    criticalIssueCount,
    warningIssueCount,
    state,
  };
}

export function buildMessagingCommandCenterReport(input: {
  orgs: MessagingCommandCenterOrgInput[];
  now?: Date;
}): MessagingCommandCenterReport {
  const generatedAt = input.now || new Date();
  const orgs = input.orgs
    .map((org) =>
      buildMessagingCommandCenterOrgReport({
        ...org,
        now: org.now || generatedAt,
      }),
    )
    .sort((a, b) => {
      const stateRank = { blocked: 0, warning: 1, not_configured: 2, ready: 3 };
      const stateDelta = stateRank[a.state] - stateRank[b.state];
      if (stateDelta !== 0) return stateDelta;
      const criticalDelta = b.criticalIssueCount - a.criticalIssueCount;
      if (criticalDelta !== 0) return criticalDelta;
      const failedDelta = b.traffic.failed30d - a.traffic.failed30d;
      if (failedDelta !== 0) return failedDelta;
      return a.orgName.localeCompare(b.orgName);
    });

  return {
    generatedAt,
    orgs,
    summary: {
      totalOrgs: orgs.length,
      liveReady: orgs.filter((org) => org.state === "ready").length,
      blocked: orgs.filter((org) => org.state === "blocked").length,
      warning: orgs.filter((org) => org.state === "warning").length,
      notConfigured: orgs.filter((org) => org.state === "not_configured")
        .length,
      failed30d: orgs.reduce((sum, org) => sum + org.traffic.failed30d, 0),
      unmatchedStatusCallbacks30d: orgs.reduce(
        (sum, org) => sum + org.traffic.unmatchedStatusCallbacks30d,
        0,
      ),
      overdueQueueCount: orgs.reduce(
        (sum, org) => sum + org.traffic.overdueQueueCount,
        0,
      ),
      dncLeadCount: orgs.reduce(
        (sum, org) => sum + org.traffic.dncLeadCount,
        0,
      ),
    },
  };
}
