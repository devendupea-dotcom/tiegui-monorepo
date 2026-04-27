import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMessagingCommandCenterOrgReport,
  buildMessagingCommandCenterReport,
} from "../lib/messaging-command-center.ts";

const NOW = new Date("2026-04-27T12:00:00.000Z");

function baseOrg(overrides = {}) {
  return {
    orgId: "org_1",
    orgName: "Velocity Landscapes",
    twilioConfig: {
      phoneNumber: "+15555550123",
      status: "ACTIVE",
      updatedAt: new Date("2026-04-20T12:00:00.000Z"),
    },
    env: {
      tokenEncryptionKeyPresent: true,
      sendEnabled: true,
      validateSignature: true,
    },
    traffic: {
      inbound30d: 3,
      outbound30d: 4,
      sent30d: 2,
      delivered30d: 2,
      queued30d: 0,
      failed30d: 0,
      unmatchedStatusCallbacks30d: 0,
      dncLeadCount: 0,
      overdueQueueCount: 0,
    },
    latest: {
      inboundAt: new Date("2026-04-27T10:00:00.000Z"),
      outboundAt: new Date("2026-04-27T10:30:00.000Z"),
      statusCallbackAt: new Date("2026-04-27T10:31:00.000Z"),
      voiceAt: null,
    },
    now: NOW,
    ...overrides,
  };
}

test("active config and strict runtime are live ready", () => {
  const report = buildMessagingCommandCenterOrgReport(baseOrg());

  assert.equal(report.state, "ready");
  assert.equal(report.canSend, true);
  assert.equal(report.criticalIssueCount, 0);
  assert.equal(report.warningIssueCount, 0);
});

test("missing token encryption key is a critical live-send blocker", () => {
  const report = buildMessagingCommandCenterOrgReport(
    baseOrg({
      env: {
        tokenEncryptionKeyPresent: false,
        sendEnabled: true,
        validateSignature: true,
      },
    }),
  );

  assert.equal(report.state, "blocked");
  assert.equal(report.canSend, false);
  assert.equal(report.readinessCode, "TOKEN_KEY_MISSING");
  assert.ok(
    report.issues.some((issue) => issue.code === "TWILIO_TOKEN_KEY_MISSING"),
  );
});

test("signature validation disabled is a critical webhook blocker", () => {
  const report = buildMessagingCommandCenterOrgReport(
    baseOrg({
      env: {
        tokenEncryptionKeyPresent: true,
        sendEnabled: true,
        validateSignature: false,
      },
    }),
  );

  assert.equal(report.state, "blocked");
  assert.equal(report.canSend, false);
  assert.ok(
    report.issues.some(
      (issue) => issue.code === "TWILIO_SIGNATURE_VALIDATION_DISABLED",
    ),
  );
});

test("outbound traffic with no status callback is surfaced as a warning", () => {
  const report = buildMessagingCommandCenterOrgReport(
    baseOrg({
      latest: {
        inboundAt: null,
        outboundAt: new Date("2026-04-27T10:30:00.000Z"),
        statusCallbackAt: null,
        voiceAt: null,
      },
    }),
  );

  assert.equal(report.state, "warning");
  assert.equal(report.criticalIssueCount, 0);
  assert.ok(report.issues.some((issue) => issue.code === "NO_STATUS_CALLBACKS"));
});

test("failed sends and unmatched callbacks are counted in summary", () => {
  const report = buildMessagingCommandCenterReport({
    now: NOW,
    orgs: [
      baseOrg({ orgId: "org_ready", orgName: "Ready Org" }),
      baseOrg({
        orgId: "org_bad",
        orgName: "Bad Org",
        traffic: {
          inbound30d: 0,
          outbound30d: 9,
          sent30d: 2,
          delivered30d: 2,
          queued30d: 1,
          failed30d: 5,
          unmatchedStatusCallbacks30d: 6,
          dncLeadCount: 3,
          overdueQueueCount: 11,
        },
      }),
    ],
  });

  assert.equal(report.summary.totalOrgs, 2);
  assert.equal(report.summary.liveReady, 1);
  assert.equal(report.summary.blocked, 1);
  assert.equal(report.summary.failed30d, 5);
  assert.equal(report.summary.unmatchedStatusCallbacks30d, 6);
  assert.equal(report.summary.overdueQueueCount, 11);
  assert.equal(report.summary.dncLeadCount, 3);
  assert.equal(report.orgs[0].orgId, "org_bad");
});

test("missing org Twilio config is not treated as live ready", () => {
  const report = buildMessagingCommandCenterOrgReport(
    baseOrg({
      twilioConfig: null,
      traffic: {
        inbound30d: 0,
        outbound30d: 0,
        sent30d: 0,
        delivered30d: 0,
        queued30d: 0,
        failed30d: 0,
        unmatchedStatusCallbacks30d: 0,
        dncLeadCount: 0,
        overdueQueueCount: 0,
      },
      latest: {
        inboundAt: null,
        outboundAt: null,
        statusCallbackAt: null,
        voiceAt: null,
      },
    }),
  );

  assert.equal(report.state, "not_configured");
  assert.equal(report.canSend, false);
  assert.ok(
    report.issues.some((issue) => issue.code === "TWILIO_NOT_CONFIGURED"),
  );
});
