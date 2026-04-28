import assert from "node:assert/strict";
import test from "node:test";
import { buildControlledRolloutReadinessReport } from "../lib/controlled-rollout-readiness.ts";

const NOW = new Date("2026-04-28T12:00:00.000Z");

function baseInput(overrides = {}) {
  return {
    org: {
      id: "org_1",
      name: "Velocity Landscapes LLC",
      portalVertical: "CONTRACTOR",
      messagingLaunchMode: "LIVE_SMS",
      createdAt: new Date("2026-04-01T12:00:00.000Z"),
    },
    env: {
      tokenEncryptionKeyPresent: true,
      sendEnabled: true,
      validateSignature: true,
    },
    memberships: [
      {
        role: "OWNER",
        status: "ACTIVE",
        userEmail: "owner@example.com",
      },
      {
        role: "WORKER",
        status: "ACTIVE",
        userEmail: "worker@example.com",
      },
      {
        role: "READ_ONLY",
        status: "ACTIVE",
        userEmail: "readonly@example.com",
      },
    ],
    legacyUsersWithoutMembership: 0,
    twilioConfig: {
      status: "ACTIVE",
      phoneNumber: "+12533300001",
      messagingServiceSid: "MGabcdef1234567890abcdef1234567890",
      twilioSubaccountSid: "test-twilio-account-sid",
      updatedAt: new Date("2026-04-27T12:00:00.000Z"),
    },
    websiteLeadSources: {
      active: 1,
      total: 1,
      allowedOrigins: ["https://velocitylandscapes.com"],
    },
    smsConsent: {
      total: 2,
      optedIn: 1,
      optedOut: 1,
      unknown: 0,
    },
    smsSignals: {
      latestManualOutboundAt: new Date("2026-04-28T10:00:00.000Z"),
      latestInboundAt: new Date("2026-04-28T10:05:00.000Z"),
      latestStatusCallbackAt: new Date("2026-04-28T10:06:00.000Z"),
      latestStopAt: new Date("2026-04-28T10:10:00.000Z"),
      latestStartAt: new Date("2026-04-28T10:12:00.000Z"),
      failedSms30d: 0,
      unmatchedCallbacks30d: 0,
      recoveredCallbacks30d: 1,
      overdueQueueCount: 0,
      leadDebugCandidateId: "lead_1",
    },
    stripe: null,
    now: NOW,
    ...overrides,
  };
}

function item(report, key) {
  return report.items.find((entry) => entry.key === key);
}

test("fully smoked org is ready for a controlled customer slot", () => {
  const report = buildControlledRolloutReadinessReport(baseInput());

  assert.equal(report.readyForControlledCustomer, true);
  assert.equal(report.launchState, "ready");
  assert.equal(report.blockingCount, 0);
  assert.equal(report.summary.activeOwnerOrAdminCount, 1);
  assert.equal(report.summary.activeWorkerCount, 1);
  assert.equal(report.summary.activeReadOnlyCount, 1);
  assert.equal(report.summary.billingMode, "manual_limited");
  assert.equal(item(report, "twilio-ready").status, "ready");
  assert.equal(item(report, "stop-start-smoke").status, "ready");
});

test("missing owner or admin blocks launch", () => {
  const report = buildControlledRolloutReadinessReport(
    baseInput({
      memberships: [
        {
          role: "WORKER",
          status: "ACTIVE",
          userEmail: "worker@example.com",
        },
      ],
    }),
  );

  assert.equal(report.readyForControlledCustomer, false);
  assert.equal(item(report, "owner-admin").status, "blocked");
  assert.equal(item(report, "owner-admin").blocking, true);
});

test("pending A2P or disabled runtime blocks Twilio readiness", () => {
  const pending = buildControlledRolloutReadinessReport(
    baseInput({
      twilioConfig: {
        ...baseInput().twilioConfig,
        status: "PENDING_A2P",
      },
    }),
  );
  const disabled = buildControlledRolloutReadinessReport(
    baseInput({
      env: {
        tokenEncryptionKeyPresent: true,
        sendEnabled: false,
        validateSignature: true,
      },
    }),
  );

  assert.equal(pending.readyForControlledCustomer, false);
  assert.equal(item(pending, "twilio-ready").status, "blocked");
  assert.equal(disabled.readyForControlledCustomer, false);
  assert.equal(item(disabled, "twilio-ready").status, "blocked");
});

test("missing recent smoke signals block launch", () => {
  const report = buildControlledRolloutReadinessReport(
    baseInput({
      smsSignals: {
        ...baseInput().smsSignals,
        latestManualOutboundAt: new Date("2026-03-01T10:00:00.000Z"),
        latestStatusCallbackAt: null,
        latestStartAt: null,
      },
    }),
  );

  assert.equal(report.readyForControlledCustomer, false);
  assert.equal(item(report, "manual-outbound-smoke").status, "blocked");
  assert.equal(item(report, "status-callback-smoke").status, "blocked");
  assert.equal(item(report, "stop-start-smoke").status, "blocked");
});

test("messaging blockers fail readiness even when Twilio config is active", () => {
  const report = buildControlledRolloutReadinessReport(
    baseInput({
      smsSignals: {
        ...baseInput().smsSignals,
        failedSms30d: 1,
        unmatchedCallbacks30d: 1,
        overdueQueueCount: 1,
      },
    }),
  );

  assert.equal(report.readyForControlledCustomer, false);
  assert.equal(item(report, "messaging-blockers").status, "blocked");
  assert.equal(report.summary.failedSms30d, 1);
  assert.equal(report.summary.unmatchedCallbacks30d, 1);
});

test("website lead source and Stripe can stay manual without blocking SMS rollout", () => {
  const report = buildControlledRolloutReadinessReport(
    baseInput({
      websiteLeadSources: {
        active: 0,
        total: 0,
        allowedOrigins: [],
      },
      stripe: {
        status: "PENDING",
        chargesEnabled: false,
        detailsSubmitted: false,
      },
    }),
  );

  assert.equal(report.readyForControlledCustomer, true);
  assert.equal(item(report, "website-lead-source").status, "manual");
  assert.equal(item(report, "website-lead-source").blocking, false);
  assert.equal(item(report, "billing-mode").status, "manual");
  assert.equal(item(report, "billing-mode").blocking, false);
});

test("no-SMS mode can launch without Twilio config or SMS smoke", () => {
  const report = buildControlledRolloutReadinessReport(
    baseInput({
      org: {
        ...baseInput().org,
        messagingLaunchMode: "NO_SMS",
      },
      twilioConfig: null,
      smsSignals: {
        latestManualOutboundAt: null,
        latestInboundAt: null,
        latestStatusCallbackAt: null,
        latestStopAt: null,
        latestStartAt: null,
        failedSms30d: 0,
        unmatchedCallbacks30d: 0,
        recoveredCallbacks30d: 0,
        overdueQueueCount: 0,
        leadDebugCandidateId: null,
      },
    }),
  );

  assert.equal(report.readyForControlledCustomer, true);
  assert.equal(report.summary.messagingLaunchMode, "NO_SMS");
  assert.equal(report.summary.twilioStatus, "NOT_CONFIGURED");
  assert.equal(item(report, "twilio-ready").status, "ready");
  assert.equal(item(report, "twilio-ready").blocking, false);
  assert.equal(item(report, "manual-outbound-smoke").status, "manual");
  assert.equal(item(report, "manual-outbound-smoke").blocking, false);
  assert.equal(item(report, "inbound-smoke").status, "manual");
  assert.equal(item(report, "status-callback-smoke").status, "manual");
  assert.equal(item(report, "stop-start-smoke").status, "manual");
});
