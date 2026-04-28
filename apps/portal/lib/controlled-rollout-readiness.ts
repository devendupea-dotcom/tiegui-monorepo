import type {
  CalendarAccessRole,
  MembershipStatus,
  OrganizationPackage,
  SmsConsentStatus,
  TwilioConfigStatus,
} from "@prisma/client";
import { normalizeEnvValue } from "@/lib/env";
import {
  getPackageEntitlements,
  getPackageMessagingMismatch,
} from "@/lib/package-entitlements";
import { countUnacceptedMessagingOpsIssues } from "@/lib/messaging-ops-triage";
import { prisma } from "@/lib/prisma";
import { parseSmsComplianceKeyword } from "@/lib/sms-compliance";
import {
  resolveTwilioMessagingReadiness,
  type TwilioMessagingEnvironmentSnapshot,
} from "@/lib/twilio-readiness";

export type ControlledRolloutItemStatus = "ready" | "manual" | "blocked";
export type ControlledMessagingLaunchMode = "LIVE_SMS" | "NO_SMS";

export type ControlledRolloutReadinessItem = {
  key: string;
  label: string;
  status: ControlledRolloutItemStatus;
  blocking: boolean;
  detail: string;
  action: string;
};

export type ControlledRolloutReadinessInput = {
  org: {
    id: string;
    name: string;
    portalVertical?: string | null;
    package?: OrganizationPackage | null;
    messagingLaunchMode?: ControlledMessagingLaunchMode | null;
    createdAt: Date;
  };
  env: TwilioMessagingEnvironmentSnapshot & {
    validateSignature: boolean;
  };
  memberships: Array<{
    role: CalendarAccessRole;
    status: MembershipStatus;
    userEmail: string;
  }>;
  legacyUsersWithoutMembership?: number;
  twilioConfig: {
    status: TwilioConfigStatus;
    phoneNumber: string | null;
    messagingServiceSid: string | null;
    twilioSubaccountSid: string | null;
    updatedAt: Date;
  } | null;
  websiteLeadSources: {
    active: number;
    total: number;
    allowedOrigins: string[];
  };
  smsConsent: {
    total: number;
    optedIn: number;
    optedOut: number;
    unknown: number;
  };
  smsSignals: {
    latestManualOutboundAt: Date | null;
    latestInboundAt: Date | null;
    latestStatusCallbackAt: Date | null;
    latestStopAt: Date | null;
    latestStartAt: Date | null;
    failedSms30d: number;
    unmatchedCallbacks30d: number;
    recoveredCallbacks30d: number;
    overdueQueueCount: number;
    leadDebugCandidateId: string | null;
  };
  stripe: {
    status: string | null;
    chargesEnabled: boolean;
    detailsSubmitted: boolean;
  } | null;
  now?: Date;
  smokeWindowDays?: number;
};

export type ControlledRolloutReadinessReport = {
  generatedAt: Date;
  orgId: string;
  orgName: string;
  launchState: "ready" | "blocked";
  readyForControlledCustomer: boolean;
  blockingCount: number;
  manualCount: number;
  items: ControlledRolloutReadinessItem[];
  links: {
    hqMessaging: string;
    twilio: string;
    websiteLeadSources: string;
    smsDebug: string | null;
  };
  summary: {
    activeOwnerOrAdminCount: number;
    activeWorkerCount: number;
    activeReadOnlyCount: number;
    package: OrganizationPackage;
    packageLabel: string;
    packageCanUseLiveSms: boolean;
    packageManagedSetupIncluded: boolean;
    messagingLaunchMode: ControlledMessagingLaunchMode;
    twilioStatus: TwilioConfigStatus | "NOT_CONFIGURED";
    websiteLeadSourceActiveCount: number;
    smsConsentOptedInCount: number;
    smsConsentOptedOutCount: number;
    failedSms30d: number;
    unmatchedCallbacks30d: number;
    recoveredCallbacks30d: number;
    billingMode: "manual_limited" | "stripe_connected";
  };
};

const SMOKE_WINDOW_DAYS = 14;

function item(input: ControlledRolloutReadinessItem): ControlledRolloutReadinessItem {
  return input;
}

function hasRecent(value: Date | null, now: Date, windowDays: number): boolean {
  if (!value) return false;
  return now.getTime() - value.getTime() <= windowDays * 24 * 60 * 60 * 1000;
}

function maskPhone(value: string | null | undefined): string {
  const normalized = (value || "").trim();
  const digits = normalized.replace(/\D/g, "");
  if (digits.length < 4) return normalized ? "***" : "(missing)";
  return `${normalized.startsWith("+") ? "+" : ""}***${digits.slice(-4)}`;
}

function maskSid(value: string | null | undefined): string {
  const normalized = (value || "").trim();
  if (!normalized) return "(missing)";
  if (normalized.length <= 8) return "****";
  return `${normalized.slice(0, 4)}...${normalized.slice(-4)}`;
}

function maxDate(values: Array<Date | null | undefined>): Date | null {
  let current: Date | null = null;
  for (const value of values) {
    if (!value) continue;
    if (!current || value > current) current = value;
  }
  return current;
}

function consentCount(
  rows: Array<{ status: SmsConsentStatus; _count: { id: number } }>,
  status: SmsConsentStatus,
): number {
  return rows.find((row) => row.status === status)?._count.id || 0;
}

function activeRoleCount(
  memberships: ControlledRolloutReadinessInput["memberships"],
  roles: CalendarAccessRole[],
): number {
  return memberships.filter(
    (membership) =>
      membership.status === "ACTIVE" && roles.includes(membership.role),
  ).length;
}

function latestComplianceKeywordAt(input: {
  events: Array<{ metadataJson: unknown; occurredAt: Date; createdAt: Date }>;
  keyword: "STOP" | "START";
}): Date | null {
  const matches: Date[] = [];
  for (const event of input.events) {
    const metadata =
      event.metadataJson &&
      typeof event.metadataJson === "object" &&
      !Array.isArray(event.metadataJson)
        ? (event.metadataJson as Record<string, unknown>)
        : null;
    const body =
      typeof metadata?.body === "string"
        ? metadata.body
        : typeof metadata?.Body === "string"
          ? metadata.Body
          : "";
    if (parseSmsComplianceKeyword(body) === input.keyword) {
      matches.push(event.occurredAt || event.createdAt);
    }
  }
  return maxDate(matches);
}

export function buildControlledRolloutReadinessReport(
  input: ControlledRolloutReadinessInput,
): ControlledRolloutReadinessReport {
  const now = input.now || new Date();
  const smokeWindowDays = input.smokeWindowDays || SMOKE_WINDOW_DAYS;
  const activeOwnerOrAdminCount = activeRoleCount(input.memberships, [
    "OWNER",
    "ADMIN",
  ]);
  const activeWorkerCount = activeRoleCount(input.memberships, ["WORKER"]);
  const activeReadOnlyCount = activeRoleCount(input.memberships, ["READ_ONLY"]);
  const organizationPackage = input.org.package || "MESSAGING_ENABLED";
  const packageEntitlements = getPackageEntitlements(organizationPackage);
  const messagingLaunchMode: ControlledMessagingLaunchMode =
    input.org.messagingLaunchMode || "LIVE_SMS";
  const noSmsMode = messagingLaunchMode === "NO_SMS";
  const packageMismatch = getPackageMessagingMismatch({
    package: organizationPackage,
    messagingLaunchMode,
  });
  const twilio = resolveTwilioMessagingReadiness({
    twilioConfig: input.twilioConfig
      ? {
          phoneNumber: input.twilioConfig.phoneNumber,
          status: input.twilioConfig.status,
        }
      : null,
    env: input.env,
  });
  const twilioReady =
    noSmsMode ||
    (twilio.canSend &&
      input.env.validateSignature &&
      Boolean(input.twilioConfig?.messagingServiceSid) &&
      Boolean(input.twilioConfig?.twilioSubaccountSid));
  const recentManualOutbound = hasRecent(
    input.smsSignals.latestManualOutboundAt,
    now,
    smokeWindowDays,
  );
  const recentInbound = hasRecent(
    input.smsSignals.latestInboundAt,
    now,
    smokeWindowDays,
  );
  const recentStatusCallback = hasRecent(
    input.smsSignals.latestStatusCallbackAt,
    now,
    smokeWindowDays,
  );
  const recentStop = hasRecent(
    input.smsSignals.latestStopAt,
    now,
    smokeWindowDays,
  );
  const recentStart = hasRecent(
    input.smsSignals.latestStartAt,
    now,
    smokeWindowDays,
  );

  const items: ControlledRolloutReadinessItem[] = [
    item({
      key: "org-created",
      label: "Organization record",
      status: "ready",
      blocking: false,
      detail: `${input.org.name} exists as ${input.org.portalVertical || "CONTRACTOR"} and was created ${input.org.createdAt.toISOString()}.`,
      action: "Confirm business name, vertical, timezone, phone, and email during onboarding.",
    }),
    item({
      key: "owner-admin",
      label: "Owner/admin access",
      status: activeOwnerOrAdminCount > 0 ? "ready" : "blocked",
      blocking: activeOwnerOrAdminCount === 0,
      detail:
        activeOwnerOrAdminCount > 0
          ? `${activeOwnerOrAdminCount} active owner/admin membership(s) found.`
          : "No active OWNER or ADMIN organization membership exists.",
      action: "Create or activate the customer owner/admin before launch.",
    }),
    item({
      key: "role-scope",
      label: "Worker/read-only role scope",
      status:
        (input.legacyUsersWithoutMembership || 0) === 0 ? "ready" : "manual",
      blocking: false,
      detail:
        (input.legacyUsersWithoutMembership || 0) === 0
          ? `${activeWorkerCount} worker and ${activeReadOnlyCount} read-only active membership(s) are organization-scoped.`
          : `${input.legacyUsersWithoutMembership} legacy user(s) still rely on orgId without an active membership.`,
      action:
        "Keep workers as WORKER, observers as READ_ONLY, and avoid broad agency/internal access for customer staff.",
    }),
    item({
      key: "package-entitlements",
      label: "Launch package",
      status: packageMismatch ? "blocked" : "ready",
      blocking: Boolean(packageMismatch),
      detail:
        packageMismatch ||
        `${packageEntitlements.label}: ${packageEntitlements.description}`,
      action: packageMismatch
        ? "Set this org to No SMS or move it to Messaging Enabled/Managed before launch."
        : packageEntitlements.requiresNoSmsMode
          ? "Keep this org in No SMS mode unless the customer moves into the messaging module."
          : packageEntitlements.managedSetupIncluded
            ? "Run the managed setup checklist and launch monitoring before marking the customer ready."
            : "Live SMS can be enabled only after the Twilio readiness smoke passes.",
    }),
    item({
      key: "twilio-ready",
      label: "Twilio / A2P readiness",
      status: twilioReady ? "ready" : "blocked",
      blocking: !twilioReady,
      detail: noSmsMode
        ? "No-SMS mode is selected. Twilio, A2P, live SMS sends, inbound SMS, and SMS callbacks are not required for this customer launch."
        : input.twilioConfig
          ? `Status ${input.twilioConfig.status}; sender ${maskPhone(input.twilioConfig.phoneNumber)}; service ${maskSid(input.twilioConfig.messagingServiceSid)}; account ${maskSid(input.twilioConfig.twilioSubaccountSid)}.`
          : "No org Twilio config is saved.",
      action: noSmsMode
        ? "Launch the customer with leads, jobs, scheduling, estimates, invoices, files, and reporting. Keep SMS automation disabled unless they opt into Twilio later."
        : "Confirm A2P approval, Messaging Service SID, sender number, token encryption key, send enabled, and signature validation.",
    }),
    item({
      key: "website-lead-source",
      label: "Website lead source",
      status:
        input.websiteLeadSources.active > 0
          ? "ready"
          : input.websiteLeadSources.total > 0
            ? "manual"
            : "manual",
      blocking: false,
      detail:
        input.websiteLeadSources.active > 0
          ? `${input.websiteLeadSources.active} active source(s); origins: ${input.websiteLeadSources.allowedOrigins.join(", ") || "not restricted"}.`
          : "No active website lead source is present. This is acceptable only if the customer website form is not connected.",
      action:
        "If website intake is in scope, create one active source, set the website server secret, and smoke a signed submission.",
    }),
    item({
      key: "sms-consent",
      label: "SMS consent model",
      status: noSmsMode ? "manual" : "ready",
      blocking: false,
      detail: noSmsMode
        ? "No-SMS mode skips live consent smoke. Existing consent rows remain preserved for a future Twilio activation."
        : `${input.smsConsent.total} consent row(s): ${input.smsConsent.optedIn} opted in, ${input.smsConsent.optedOut} opted out, ${input.smsConsent.unknown} unknown.`,
      action: noSmsMode
        ? "Do not promise SMS follow-up, text intake, missed-call recovery, or delivery receipts for this customer."
        : "Before launch, run STOP/START smoke and confirm explicit OPTED_IN can override legacy DNC fallback only as intended.",
    }),
    item({
      key: "manual-outbound-smoke",
      label: "Manual outbound SMS smoke",
      status: noSmsMode ? "manual" : recentManualOutbound ? "ready" : "blocked",
      blocking: !noSmsMode && !recentManualOutbound,
      detail: noSmsMode
        ? "Skipped because this customer is launching without Twilio/SMS."
        : recentManualOutbound
        ? `Latest manual outbound smoke within ${smokeWindowDays} days.`
        : `No manual outbound SMS smoke found within ${smokeWindowDays} days.`,
      action: noSmsMode
        ? "Use internal notes, lead activity, estimates, invoices, and scheduling instead of SMS."
        : "Send one consent-safe manual SMS from inbox or lead composer and verify one Message/CommunicationEvent row.",
    }),
    item({
      key: "inbound-smoke",
      label: "Inbound reply smoke",
      status: noSmsMode ? "manual" : recentInbound ? "ready" : "blocked",
      blocking: !noSmsMode && !recentInbound,
      detail: noSmsMode
        ? "Skipped because this customer is launching without inbound SMS."
        : recentInbound
        ? `Latest inbound SMS is within ${smokeWindowDays} days.`
        : `No inbound SMS found within ${smokeWindowDays} days.`,
      action: noSmsMode
        ? "Route customer communication outside TieGui SMS until Twilio is intentionally enabled."
        : "Reply from the safe test phone or simulate a signed inbound webhook and verify org/thread routing.",
    }),
    item({
      key: "status-callback-smoke",
      label: "Delivery callback smoke",
      status: noSmsMode ? "manual" : recentStatusCallback ? "ready" : "blocked",
      blocking: !noSmsMode && !recentStatusCallback,
      detail: noSmsMode
        ? "Skipped because no Twilio delivery callbacks are expected in No-SMS mode."
        : recentStatusCallback
        ? `Latest delivery status callback is within ${smokeWindowDays} days.`
        : `No delivery status callback found within ${smokeWindowDays} days.`,
      action: noSmsMode
        ? "If the customer later buys SMS, switch to Live SMS mode and run the full callback smoke before sending."
        : "Confirm Twilio status callback URL reaches /api/webhooks/twilio/sms/status and reconciles a known SID.",
    }),
    item({
      key: "stop-start-smoke",
      label: "STOP/START smoke",
      status: noSmsMode ? "manual" : recentStop && recentStart ? "ready" : "blocked",
      blocking: !noSmsMode && !(recentStop && recentStart),
      detail: noSmsMode
        ? "Skipped because the customer is not receiving or sending SMS through TieGui."
        : recentStop && recentStart
        ? `STOP and START/UNSTOP signals were both seen within ${smokeWindowDays} days.`
        : "STOP and START/UNSTOP have not both been verified recently.",
      action: noSmsMode
        ? "Do not enable text automation until Twilio is configured and consent smoke passes."
        : "Run signed STOP then START/UNSTOP smoke, confirm SmsConsent transitions, and verify outbound block/override behavior.",
    }),
    item({
      key: "messaging-blockers",
      label: "/hq/messaging blockers",
      status:
        input.smsSignals.failedSms30d === 0 &&
        input.smsSignals.unmatchedCallbacks30d === 0 &&
        input.smsSignals.overdueQueueCount === 0
          ? "ready"
          : "blocked",
      blocking:
        input.smsSignals.failedSms30d > 0 ||
        input.smsSignals.unmatchedCallbacks30d > 0 ||
        input.smsSignals.overdueQueueCount > 0,
      detail: `${input.smsSignals.failedSms30d} failed SMS, ${input.smsSignals.unmatchedCallbacks30d} unmatched callbacks, ${input.smsSignals.overdueQueueCount} overdue queued SMS in the monitored window.`,
      action:
        "Clear or explicitly accept each failed SMS, unmatched callback, and overdue queue item before launch.",
    }),
    item({
      key: "sms-debug",
      label: "Lead SMS debug page",
      status: input.smsSignals.leadDebugCandidateId ? "ready" : "manual",
      blocking: false,
      detail: input.smsSignals.leadDebugCandidateId
        ? "A lead with SMS activity is available for /hq/leads/[leadId]/sms-debug."
        : "No lead with SMS activity exists yet for debug-page verification.",
      action:
        "Open the debug page after the SMS smoke and confirm consent, message, event, SID masking, and copy summary safety.",
    }),
    item({
      key: "failure-monitoring",
      label: "Failed SMS and callback monitoring",
      status:
        input.smsSignals.failedSms30d === 0 &&
        input.smsSignals.unmatchedCallbacks30d === 0
          ? "ready"
          : "manual",
      blocking: false,
      detail: `${input.smsSignals.recoveredCallbacks30d} recovered callback(s) in the last 30 days.`,
      action:
        "Review /hq/messaging daily for the first 3 business days and log any Twilio 30006/30007 failures.",
    }),
    item({
      key: "billing-mode",
      label: "Stripe / billing mode",
      status:
        input.stripe?.chargesEnabled && input.stripe.detailsSubmitted
          ? "ready"
          : "manual",
      blocking: false,
      detail: input.stripe
        ? `Stripe status ${input.stripe.status || "unknown"}; charges ${input.stripe.chargesEnabled ? "enabled" : "disabled"}; details ${input.stripe.detailsSubmitted ? "submitted" : "incomplete"}.`
        : "No Stripe connection is present. Controlled rollout should treat billing as manual/limited.",
      action:
        "Document billing scope with the customer; do not promise self-serve billing until Stripe is fully enabled.",
    }),
  ];

  const blockingCount = items.filter((entry) => entry.blocking).length;
  const manualCount = items.filter((entry) => entry.status === "manual").length;
  return {
    generatedAt: now,
    orgId: input.org.id,
    orgName: input.org.name,
    launchState: blockingCount === 0 ? "ready" : "blocked",
    readyForControlledCustomer: blockingCount === 0,
    blockingCount,
    manualCount,
    items,
    links: {
      hqMessaging: "/hq/messaging",
      twilio: `/hq/orgs/${input.org.id}/twilio`,
      websiteLeadSources: `/hq/orgs/${input.org.id}/website-leads`,
      smsDebug: input.smsSignals.leadDebugCandidateId
        ? `/hq/leads/${input.smsSignals.leadDebugCandidateId}/sms-debug`
        : null,
    },
    summary: {
      activeOwnerOrAdminCount,
      activeWorkerCount,
      activeReadOnlyCount,
      package: organizationPackage,
      packageLabel: packageEntitlements.shortLabel,
      packageCanUseLiveSms: packageEntitlements.canUseLiveSms,
      packageManagedSetupIncluded: packageEntitlements.managedSetupIncluded,
      messagingLaunchMode,
      twilioStatus: input.twilioConfig?.status || "NOT_CONFIGURED",
      websiteLeadSourceActiveCount: input.websiteLeadSources.active,
      smsConsentOptedInCount: input.smsConsent.optedIn,
      smsConsentOptedOutCount: input.smsConsent.optedOut,
      failedSms30d: input.smsSignals.failedSms30d,
      unmatchedCallbacks30d: input.smsSignals.unmatchedCallbacks30d,
      recoveredCallbacks30d: input.smsSignals.recoveredCallbacks30d,
      billingMode:
        input.stripe?.chargesEnabled && input.stripe.detailsSubmitted
          ? "stripe_connected"
          : "manual_limited",
    },
  };
}

export async function loadControlledRolloutReadinessReport(input: {
  orgId: string;
  now?: Date;
  smokeWindowDays?: number;
}): Promise<ControlledRolloutReadinessReport | null> {
  const now = input.now || new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const overdueQueueBefore = new Date(now.getTime() - 10 * 60 * 1000);

  const [
    org,
    memberships,
    legacyUsers,
    consentCounts,
    messages,
    smsEvents,
    triageRows,
    overdueQueueCount,
  ] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: input.orgId },
      select: {
        id: true,
        name: true,
        portalVertical: true,
        package: true,
        messagingLaunchMode: true,
        createdAt: true,
        twilioConfig: {
          select: {
            status: true,
            phoneNumber: true,
            messagingServiceSid: true,
            twilioSubaccountSid: true,
            updatedAt: true,
          },
        },
        websiteLeadSources: {
          select: {
            active: true,
            allowedOrigin: true,
          },
        },
        stripeConnection: {
          select: {
            status: true,
            chargesEnabled: true,
            detailsSubmitted: true,
          },
        },
      },
    }),
    prisma.organizationMembership.findMany({
      where: { organizationId: input.orgId },
      select: {
        role: true,
        status: true,
        user: { select: { email: true } },
      },
    }),
    prisma.user.findMany({
      where: { orgId: input.orgId },
      select: {
        id: true,
        organizationMemberships: {
          where: { organizationId: input.orgId, status: "ACTIVE" },
          select: { id: true },
        },
      },
    }),
    prisma.smsConsent.groupBy({
      by: ["status"],
      where: { orgId: input.orgId },
      _count: { id: true },
    }),
    prisma.message.findMany({
      where: {
        orgId: input.orgId,
        createdAt: { gte: thirtyDaysAgo },
      },
      select: {
        id: true,
        leadId: true,
        direction: true,
        type: true,
        status: true,
        providerMessageSid: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    prisma.communicationEvent.findMany({
      where: {
        orgId: input.orgId,
        channel: "SMS",
        OR: [
          { createdAt: { gte: thirtyDaysAgo } },
          { occurredAt: { gte: thirtyDaysAgo } },
        ],
      },
      select: {
        id: true,
        leadId: true,
        type: true,
        summary: true,
        providerStatus: true,
        providerMessageSid: true,
        metadataJson: true,
        occurredAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
    prisma.messagingOpsTriage.findMany({
      where: {
        orgId: input.orgId,
        targetType: {
          in: ["FAILED_SMS_MESSAGE", "UNMATCHED_STATUS_CALLBACK"],
        },
      },
      select: {
        targetType: true,
        targetId: true,
      },
    }),
    prisma.smsDispatchQueue.count({
      where: {
        orgId: input.orgId,
        status: "QUEUED",
        sendAfterAt: { lt: overdueQueueBefore },
      },
    }),
  ]);

  if (!org) return null;

  const latestManualOutboundAt = maxDate(
    messages
      .filter(
        (message) =>
          message.direction === "OUTBOUND" &&
          message.type === "MANUAL" &&
          (message.status === "SENT" || message.status === "DELIVERED"),
      )
      .map((message) => message.createdAt),
  );
  const latestInboundAt = maxDate(
    messages
      .filter((message) => message.direction === "INBOUND")
      .map((message) => message.createdAt),
  );
  const latestStatusCallbackAt = maxDate(
    smsEvents
      .filter(
        (event) =>
          event.type === "OUTBOUND_SMS_SENT" &&
          Boolean(event.providerMessageSid) &&
          Boolean(event.providerStatus),
      )
      .map((event) => event.createdAt || event.occurredAt),
  );
  const failedMessages = messages.filter(
    (message) => message.direction === "OUTBOUND" && message.status === "FAILED",
  );
  const unmatchedCallbacks = smsEvents.filter(
    (event) => event.summary === "Unmatched outbound SMS status callback",
  );
  const activeMessagingIssues = countUnacceptedMessagingOpsIssues({
    failedMessages,
    unmatchedCallbacks,
    triageRows,
  });
  const failedSms30d = activeMessagingIssues.activeFailedMessages.length;
  const unmatchedCallbacks30d =
    activeMessagingIssues.activeUnmatchedCallbacks.length;
  const recoveredCallbacks30d = smsEvents.filter(
    (event) => event.summary === "Recovered outbound SMS status callback",
  ).length;
  const leadDebugCandidateId =
    messages.find((message) => Boolean(message.leadId))?.leadId ||
    smsEvents.find((event) => Boolean(event.leadId))?.leadId ||
    null;
  const activeSources = org.websiteLeadSources.filter((source) => source.active);
  const legacyUsersWithoutMembership = legacyUsers.filter(
    (user) => user.organizationMemberships.length === 0,
  ).length;

  return buildControlledRolloutReadinessReport({
    org: {
      id: org.id,
      name: org.name,
      portalVertical: org.portalVertical,
      package: org.package,
      messagingLaunchMode: org.messagingLaunchMode,
      createdAt: org.createdAt,
    },
    env: {
      sendEnabled: normalizeEnvValue(process.env.TWILIO_SEND_ENABLED) === "true",
      tokenEncryptionKeyPresent: Boolean(
        normalizeEnvValue(process.env.TWILIO_TOKEN_ENCRYPTION_KEY),
      ),
      validateSignature:
        normalizeEnvValue(process.env.TWILIO_VALIDATE_SIGNATURE) === "true",
    },
    memberships: memberships.map((membership) => ({
      role: membership.role,
      status: membership.status,
      userEmail: membership.user.email,
    })),
    legacyUsersWithoutMembership,
    twilioConfig: org.twilioConfig,
    websiteLeadSources: {
      active: activeSources.length,
      total: org.websiteLeadSources.length,
      allowedOrigins: activeSources
        .map((source) => source.allowedOrigin)
        .filter((value): value is string => Boolean(value)),
    },
    smsConsent: {
      total: consentCounts.reduce((sum, row) => sum + row._count.id, 0),
      optedIn: consentCount(consentCounts, "OPTED_IN"),
      optedOut: consentCount(consentCounts, "OPTED_OUT"),
      unknown: consentCount(consentCounts, "UNKNOWN"),
    },
    smsSignals: {
      latestManualOutboundAt,
      latestInboundAt,
      latestStatusCallbackAt,
      latestStopAt: latestComplianceKeywordAt({
        events: smsEvents,
        keyword: "STOP",
      }),
      latestStartAt: latestComplianceKeywordAt({
        events: smsEvents,
        keyword: "START",
      }),
      failedSms30d,
      unmatchedCallbacks30d,
      recoveredCallbacks30d,
      overdueQueueCount,
      leadDebugCandidateId,
    },
    stripe: org.stripeConnection,
    now,
    smokeWindowDays: input.smokeWindowDays,
  });
}
