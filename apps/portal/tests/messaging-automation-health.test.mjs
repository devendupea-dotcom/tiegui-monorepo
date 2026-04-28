import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMessagingAutomationRecentFailures,
  evaluateMessagingAutomationHealth,
} from "../lib/messaging-automation-health.ts";

function buildInput(overrides = {}) {
  return {
    generatedAt: "2026-04-22T12:00:00.000Z",
    readinessCode: "ACTIVE",
    canSendLive: true,
    automationsEnabled: {
      autoReply: true,
      followUps: true,
      autoBooking: true,
      missedCallTextBack: true,
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
        monitored: true,
        thresholdMinutes: 20,
        lastRunAt: "2026-04-22T11:55:00.000Z",
        lastFinishedAt: "2026-04-22T11:56:00.000Z",
        lastStatus: "OK",
        lastError: null,
        minutesSinceLastRun: 5,
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
    ...overrides,
  };
}

test("healthy messaging automation stays healthy when live send and cron are fresh", () => {
  const summary = evaluateMessagingAutomationHealth(buildInput());

  assert.equal(summary.overallStatus, "HEALTHY");
  assert.deepEqual(summary.issues, []);
});

test("live automations blocked by non-active Twilio become critical", () => {
  const summary = evaluateMessagingAutomationHealth(
    buildInput({
      readinessCode: "PENDING_A2P",
      canSendLive: false,
    }),
  );

  assert.equal(summary.overallStatus, "CRITICAL");
  assert.ok(summary.issues.includes("LIVE_AUTOMATION_BLOCKED"));
});

test("send-disabled deployments warn without escalating to critical by themselves", () => {
  const summary = evaluateMessagingAutomationHealth(
    buildInput({
      readinessCode: "SEND_DISABLED",
      canSendLive: false,
    }),
  );

  assert.equal(summary.overallStatus, "ATTENTION");
  assert.ok(summary.issues.includes("DEPLOYMENT_SEND_DISABLED"));
});

test("stale intake cron plus overdue queue becomes critical", () => {
  const summary = evaluateMessagingAutomationHealth(
    buildInput({
      queue: {
        dueNowCount: 14,
        scheduledCount: 2,
        failedLast24hCount: 0,
        outboundFailedLast24hCount: 0,
        outboundQueuedLast24hCount: 0,
        oldestDueAt: "2026-04-22T11:20:00.000Z",
        nextScheduledAt: "2026-04-22T12:15:00.000Z",
        oldestDueMinutes: 40,
      },
      cron: {
        intake: {
          route: "/api/cron/intake",
          monitored: true,
          thresholdMinutes: 20,
          lastRunAt: "2026-04-22T10:45:00.000Z",
          lastFinishedAt: "2026-04-22T10:46:00.000Z",
          lastStatus: "OK",
          lastError: null,
          minutesSinceLastRun: 75,
          stale: true,
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
    }),
  );

  assert.equal(summary.overallStatus, "CRITICAL");
  assert.ok(summary.issues.includes("INTAKE_CRON_STALE"));
  assert.ok(summary.issues.includes("QUEUE_BACKLOG"));
});

test("recent failure drill-down keeps the newest failures first and flags spam-review cases", () => {
  const recentFailures = buildMessagingAutomationRecentFailures({
    queueFailures: [
      {
        id: "queue-1",
        leadId: "lead-1",
        updatedAt: new Date("2026-04-22T11:30:00.000Z"),
        lastError: "Blocked as spam from CRM.",
        lead: {
          contactName: "Casey",
          businessName: null,
          phoneE164: "+12065550111",
        },
      },
    ],
    outboundFailures: [
      {
        id: "msg-1",
        leadId: "lead-2",
        createdAt: new Date("2026-04-22T11:50:00.000Z"),
        provider: "TWILIO",
        lead: {
          contactName: null,
          businessName: "North Elm",
          phoneE164: "+12065550112",
        },
      },
    ],
    spamReviewByLead: new Map([
      [
        "lead-2",
        {
          potentialSpam: false,
          potentialSpamSignals: [],
          failedOutboundCount: 1,
        },
      ],
    ]),
  });

  assert.equal(recentFailures[0]?.id, "msg-1");
  assert.equal(recentFailures[0]?.source, "OUTBOUND");
  assert.equal(recentFailures[0]?.spamReview, true);
  assert.match(recentFailures[0]?.reason || "", /delivery failed/i);
  assert.equal(recentFailures[1]?.id, "queue-1");
});
