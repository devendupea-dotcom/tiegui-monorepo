import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  canSendInvoiceReminder,
  deriveInvoiceCollectionsAgingBucket,
  deriveInvoiceCollectionsEscalationStage,
  deriveInvoiceCollectionsQueueState,
  deriveInvoiceCheckoutRecoveryState,
  hasInvoiceReminderHistory,
  readInvoiceCollectionAttemptMetadata,
  summarizeInvoiceCollectionAttempts,
  summarizeInvoiceCollectionHistory,
  summarizeInvoiceCollectionsAging,
  summarizeInvoiceCollectionsEscalation,
  summarizeInvoiceCollectionsOwnerReport,
  summarizeInvoiceCollections,
  summarizeInvoiceCollectionsQueue,
} from "../lib/invoice-collections.ts";

test("invoice reminders only unlock for open sent invoices with a balance due", () => {
  assert.equal(
    canSendInvoiceReminder({
      status: "SENT",
      balanceDue: "125.00",
    }),
    true,
  );

  assert.equal(
    canSendInvoiceReminder({
      status: "PARTIAL",
      balanceDue: "45.00",
    }),
    true,
  );

  assert.equal(
    canSendInvoiceReminder({
      status: "OVERDUE",
      balanceDue: "45.00",
    }),
    true,
  );

  assert.equal(
    canSendInvoiceReminder({
      status: "DRAFT",
      balanceDue: "45.00",
    }),
    false,
  );

  assert.equal(
    canSendInvoiceReminder({
      status: "PAID",
      balanceDue: "0.00",
    }),
    false,
  );
});

test("invoice collection summary tracks overdue, due soon, drafts, and reminder-ready invoices", () => {
  const now = new Date("2026-04-23T12:00:00.000Z");
  const summary = summarizeInvoiceCollections(
    [
      {
        status: "DRAFT",
        balanceDue: "120.00",
        dueDate: new Date("2026-04-28T12:00:00.000Z"),
      },
      {
        status: "SENT",
        balanceDue: "250.00",
        dueDate: new Date("2026-04-25T12:00:00.000Z"),
      },
      {
        status: "PARTIAL",
        balanceDue: new Prisma.Decimal("50.00"),
        dueDate: new Date("2026-04-30T12:00:00.000Z"),
      },
      {
        status: "OVERDUE",
        balanceDue: "75.00",
        dueDate: new Date("2026-04-20T12:00:00.000Z"),
      },
      {
        status: "PAID",
        balanceDue: "0.00",
        dueDate: new Date("2026-04-18T12:00:00.000Z"),
      },
    ],
    now,
  );

  assert.equal(summary.totalOpenCount, 4);
  assert.equal(summary.draftCount, 1);
  assert.equal(summary.reminderReadyCount, 3);
  assert.equal(summary.overdueCount, 1);
  assert.equal(summary.dueSoonCount, 2);
  assert.equal(summary.outstandingTotal.toString(), "495");
});

test("invoice checkout recovery distinguishes active links from failure and expiry states", () => {
  assert.deepEqual(
    deriveInvoiceCheckoutRecoveryState({
      status: "OPEN",
      checkoutUrl: "https://example.com/pay/123",
      expiresAt: new Date("2026-04-25T12:00:00.000Z"),
      now: new Date("2026-04-23T12:00:00.000Z"),
    }),
    {
      issue: null,
      activeCheckoutUrl: "https://example.com/pay/123",
    },
  );

  assert.deepEqual(
    deriveInvoiceCheckoutRecoveryState({
      status: "OPEN",
      checkoutUrl: "https://example.com/pay/123",
      expiresAt: new Date("2026-04-25T12:00:00.000Z"),
      lastError: "card declined",
      now: new Date("2026-04-23T12:00:00.000Z"),
    }),
    {
      issue: "failed",
      activeCheckoutUrl: "https://example.com/pay/123",
    },
  );

  assert.deepEqual(
    deriveInvoiceCheckoutRecoveryState({
      status: "EXPIRED",
      checkoutUrl: "https://example.com/pay/123",
      expiresAt: new Date("2026-04-22T12:00:00.000Z"),
      now: new Date("2026-04-23T12:00:00.000Z"),
    }),
    {
      issue: "expired",
      activeCheckoutUrl: null,
    },
  );

  assert.deepEqual(
    deriveInvoiceCheckoutRecoveryState({
      status: "CANCELED",
      checkoutUrl: "https://example.com/pay/123",
    }),
    {
      issue: "replaced",
      activeCheckoutUrl: null,
    },
  );
});

test("invoice reminder history becomes visible when a reminder was sent", () => {
  assert.equal(
    hasInvoiceReminderHistory({
      reminderCount: 0,
      lastReminderSentAt: null,
    }),
    false,
  );

  assert.equal(
    hasInvoiceReminderHistory({
      reminderCount: 1,
      lastReminderSentAt: null,
    }),
    true,
  );

  assert.equal(
    hasInvoiceReminderHistory({
      reminderCount: 0,
      lastReminderSentAt: new Date("2026-04-23T12:00:00.000Z"),
    }),
    true,
  );
});

test("invoice collections queue uses org cadence rules for due, upcoming, disabled, and maxed states", () => {
  const settings = {
    enabled: true,
    firstReminderLeadDays: 2,
    overdueReminderCadenceDays: 5,
    maxReminders: 2,
  };

  assert.equal(
    deriveInvoiceCollectionsQueueState({
      status: "SENT",
      balanceDue: "250.00",
      dueDate: new Date("2026-04-25T12:00:00.000Z"),
      sentAt: new Date("2026-04-20T12:00:00.000Z"),
      reminderCount: 0,
      settings,
      now: new Date("2026-04-23T12:00:00.000Z"),
    }).stage,
    "due_now",
  );

  assert.equal(
    deriveInvoiceCollectionsQueueState({
      status: "PARTIAL",
      balanceDue: "125.00",
      dueDate: new Date("2026-04-30T12:00:00.000Z"),
      sentAt: new Date("2026-04-20T12:00:00.000Z"),
      reminderCount: 0,
      settings,
      now: new Date("2026-04-23T12:00:00.000Z"),
    }).stage,
    "upcoming",
  );

  assert.equal(
    deriveInvoiceCollectionsQueueState({
      status: "OVERDUE",
      balanceDue: "125.00",
      dueDate: new Date("2026-04-10T12:00:00.000Z"),
      sentAt: new Date("2026-04-01T12:00:00.000Z"),
      lastReminderSentAt: new Date("2026-04-16T12:00:00.000Z"),
      reminderCount: 2,
      settings,
      now: new Date("2026-04-23T12:00:00.000Z"),
    }).stage,
    "maxed",
  );

  assert.equal(
    deriveInvoiceCollectionsQueueState({
      status: "SENT",
      balanceDue: "125.00",
      dueDate: new Date("2026-04-25T12:00:00.000Z"),
      sentAt: new Date("2026-04-20T12:00:00.000Z"),
      reminderCount: 0,
      settings: { ...settings, enabled: false },
      now: new Date("2026-04-23T12:00:00.000Z"),
    }).stage,
    "disabled",
  );
});

test("invoice collections queue summary aggregates the derived queue stages", () => {
  const summary = summarizeInvoiceCollectionsQueue(
    [
      {
        status: "SENT",
        balanceDue: "250.00",
        dueDate: new Date("2026-04-25T12:00:00.000Z"),
        sentAt: new Date("2026-04-20T12:00:00.000Z"),
        reminderCount: 0,
      },
      {
        status: "PARTIAL",
        balanceDue: "125.00",
        dueDate: new Date("2026-04-30T12:00:00.000Z"),
        sentAt: new Date("2026-04-20T12:00:00.000Z"),
        reminderCount: 0,
      },
      {
        status: "OVERDUE",
        balanceDue: "125.00",
        dueDate: new Date("2026-04-10T12:00:00.000Z"),
        sentAt: new Date("2026-04-01T12:00:00.000Z"),
        lastReminderSentAt: new Date("2026-04-16T12:00:00.000Z"),
        reminderCount: 2,
      },
    ],
    {
      enabled: true,
      firstReminderLeadDays: 2,
      overdueReminderCadenceDays: 5,
      maxReminders: 2,
    },
    new Date("2026-04-23T12:00:00.000Z"),
  );

  assert.deepEqual(summary, {
    dueNowCount: 1,
    upcomingCount: 1,
    maxedCount: 1,
    disabledCount: 0,
  });
});

test("invoice collections activity summary tracks automated reminder outcomes", () => {
  const summary = summarizeInvoiceCollectionAttempts([
    {
      source: "MANUAL",
      outcome: "SENT",
      createdAt: new Date("2026-04-20T12:00:00.000Z"),
    },
    {
      source: "AUTOMATION",
      outcome: "SKIPPED",
      createdAt: new Date("2026-04-21T12:00:00.000Z"),
    },
    {
      source: "AUTOMATION",
      outcome: "FAILED",
      createdAt: new Date("2026-04-22T12:00:00.000Z"),
    },
    {
      source: "AUTOMATION",
      outcome: "SENT",
      createdAt: new Date("2026-04-23T12:00:00.000Z"),
    },
  ]);

  assert.equal(summary.automatedSentCount, 1);
  assert.equal(summary.automatedSkippedCount, 1);
  assert.equal(summary.automatedFailedCount, 1);
  assert.equal(
    summary.lastAutomatedAttemptAt?.toISOString(),
    "2026-04-23T12:00:00.000Z",
  );
  assert.equal(summary.lastAutomatedAttemptOutcome, "SENT");
});

test("invoice collection history summary tracks manual, automated, skipped, and failed activity", () => {
  const summary = summarizeInvoiceCollectionHistory([
    {
      source: "MANUAL",
      outcome: "SENT",
      createdAt: new Date("2026-04-20T12:00:00.000Z"),
    },
    {
      source: "AUTOMATION",
      outcome: "SENT",
      createdAt: new Date("2026-04-21T12:00:00.000Z"),
    },
    {
      source: "AUTOMATION",
      outcome: "SKIPPED",
      createdAt: new Date("2026-04-22T12:00:00.000Z"),
    },
    {
      source: "MANUAL",
      outcome: "FAILED",
      createdAt: new Date("2026-04-23T12:00:00.000Z"),
    },
  ]);

  assert.equal(summary.manualSentCount, 1);
  assert.equal(summary.automatedSentCount, 1);
  assert.equal(summary.skippedCount, 1);
  assert.equal(summary.failedCount, 1);
  assert.equal(summary.lastAttemptOutcome, "FAILED");
  assert.equal(summary.lastAttemptSource, "MANUAL");
});

test("invoice collections owner report tracks balances, recovered payments, and source performance", () => {
  const summary = summarizeInvoiceCollectionsOwnerReport(
    [
      {
        status: "SENT",
        balanceDue: "300.00",
        amountPaid: "0.00",
        dueDate: new Date("2026-04-25T12:00:00.000Z"),
        collectionAttempts: [
          {
            source: "MANUAL",
            outcome: "SENT",
            createdAt: new Date("2026-04-20T12:00:00.000Z"),
          },
        ],
      },
      {
        status: "OVERDUE",
        balanceDue: "175.00",
        amountPaid: "50.00",
        dueDate: new Date("2026-04-12T12:00:00.000Z"),
        payments: [
          {
            amount: "25.00",
            date: new Date("2026-04-10T12:00:00.000Z"),
          },
          {
            amount: "50.00",
            date: new Date("2026-04-22T12:00:00.000Z"),
          },
        ],
        collectionAttempts: [
          {
            source: "AUTOMATION",
            outcome: "FAILED",
            createdAt: new Date("2026-04-21T12:00:00.000Z"),
          },
        ],
      },
      {
        status: "OVERDUE",
        balanceDue: "600.00",
        amountPaid: "100.00",
        dueDate: new Date("2026-03-20T12:00:00.000Z"),
        collectionAttempts: [
          {
            source: "MANUAL",
            outcome: "SKIPPED",
            createdAt: new Date("2026-04-01T12:00:00.000Z"),
          },
          {
            source: "AUTOMATION",
            outcome: "SENT",
            createdAt: new Date("2026-04-02T12:00:00.000Z"),
          },
        ],
      },
      {
        status: "PAID",
        balanceDue: "0.00",
        amountPaid: "400.00",
        dueDate: new Date("2026-04-01T12:00:00.000Z"),
        collectionAttempts: [
          {
            source: "MANUAL",
            outcome: "SENT",
            createdAt: new Date("2026-04-03T12:00:00.000Z"),
          },
        ],
      },
    ],
    {
      urgentAfterDays: 7,
      finalAfterDays: 21,
    },
    new Date("2026-04-23T12:00:00.000Z"),
  );

  assert.equal(summary.escalation.current.count, 1);
  assert.equal(summary.escalation.current.balanceDue.toString(), "300");
  assert.equal(summary.escalation.urgent.count, 1);
  assert.equal(summary.escalation.urgent.balanceDue.toString(), "175");
  assert.equal(summary.escalation.final.count, 1);
  assert.equal(summary.escalation.final.balanceDue.toString(), "600");
  assert.equal(summary.stillAtRiskTotal.toString(), "775");
  assert.equal(summary.highRiskTotal.toString(), "775");
  assert.equal(summary.recoveredAfterCollectionTotal.toString(), "550");
  assert.equal(summary.performance.manual.sentCount, 2);
  assert.equal(summary.performance.manual.skippedCount, 1);
  assert.equal(summary.performance.automation.sentCount, 1);
  assert.equal(summary.performance.automation.failedCount, 1);
  assert.equal(summary.performance.totalCount, 5);
});

test("invoice collection attempt metadata extracts supported detail fields", () => {
  assert.deepEqual(
    readInvoiceCollectionAttemptMetadata({
      route: "/api/cron/invoice-collections",
      queueStage: "due_now",
      payLinkIncluded: true,
      refreshPayLink: false,
      reminderCount: 3,
      ignored: "value",
    }),
    {
      route: "/api/cron/invoice-collections",
      queueStage: "due_now",
      payLinkIncluded: true,
      refreshPayLink: false,
      reminderCount: 3,
    },
  );

  assert.deepEqual(readInvoiceCollectionAttemptMetadata(null), {
    route: null,
    queueStage: null,
    payLinkIncluded: null,
    refreshPayLink: null,
    reminderCount: null,
  });
});

test("invoice aging buckets group current, 1-30, 31-60, and 61+ day balances", () => {
  const now = new Date("2026-04-23T12:00:00.000Z");

  assert.equal(
    deriveInvoiceCollectionsAgingBucket({
      balanceDue: "125.00",
      dueDate: new Date("2026-04-25T12:00:00.000Z"),
      now,
    }),
    "current",
  );
  assert.equal(
    deriveInvoiceCollectionsAgingBucket({
      balanceDue: "125.00",
      dueDate: new Date("2026-04-10T12:00:00.000Z"),
      now,
    }),
    "days_1_30",
  );
  assert.equal(
    deriveInvoiceCollectionsAgingBucket({
      balanceDue: "125.00",
      dueDate: new Date("2026-03-10T12:00:00.000Z"),
      now,
    }),
    "days_31_60",
  );
  assert.equal(
    deriveInvoiceCollectionsAgingBucket({
      balanceDue: "125.00",
      dueDate: new Date("2026-01-15T12:00:00.000Z"),
      now,
    }),
    "days_61_plus",
  );
});

test("invoice aging summary counts each aging bucket", () => {
  const summary = summarizeInvoiceCollectionsAging(
    [
      {
        balanceDue: "200.00",
        dueDate: new Date("2026-04-25T12:00:00.000Z"),
      },
      {
        balanceDue: "200.00",
        dueDate: new Date("2026-04-10T12:00:00.000Z"),
      },
      {
        balanceDue: "200.00",
        dueDate: new Date("2026-03-10T12:00:00.000Z"),
      },
      {
        balanceDue: "200.00",
        dueDate: new Date("2026-01-15T12:00:00.000Z"),
      },
    ],
    new Date("2026-04-23T12:00:00.000Z"),
  );

  assert.deepEqual(summary, {
    currentCount: 1,
    days1to30Count: 1,
    days31to60Count: 1,
    days61PlusCount: 1,
  });
});

test("invoice escalation stages follow the urgent and final thresholds", () => {
  const settings = {
    urgentAfterDays: 7,
    finalAfterDays: 21,
  };
  const now = new Date("2026-04-23T12:00:00.000Z");

  assert.equal(
    deriveInvoiceCollectionsEscalationStage({
      status: "SENT",
      balanceDue: "125.00",
      dueDate: new Date("2026-04-25T12:00:00.000Z"),
      settings,
      now,
    }),
    "current",
  );
  assert.equal(
    deriveInvoiceCollectionsEscalationStage({
      status: "OVERDUE",
      balanceDue: "125.00",
      dueDate: new Date("2026-04-20T12:00:00.000Z"),
      settings,
      now,
    }),
    "overdue",
  );
  assert.equal(
    deriveInvoiceCollectionsEscalationStage({
      status: "OVERDUE",
      balanceDue: "125.00",
      dueDate: new Date("2026-04-10T12:00:00.000Z"),
      settings,
      now,
    }),
    "urgent",
  );
  assert.equal(
    deriveInvoiceCollectionsEscalationStage({
      status: "OVERDUE",
      balanceDue: "125.00",
      dueDate: new Date("2026-03-20T12:00:00.000Z"),
      settings,
      now,
    }),
    "final",
  );
});

test("invoice escalation summary counts current, overdue, urgent, and final stages", () => {
  const summary = summarizeInvoiceCollectionsEscalation(
    [
      {
        status: "SENT",
        balanceDue: "125.00",
        dueDate: new Date("2026-04-25T12:00:00.000Z"),
      },
      {
        status: "OVERDUE",
        balanceDue: "125.00",
        dueDate: new Date("2026-04-20T12:00:00.000Z"),
      },
      {
        status: "OVERDUE",
        balanceDue: "125.00",
        dueDate: new Date("2026-04-10T12:00:00.000Z"),
      },
      {
        status: "OVERDUE",
        balanceDue: "125.00",
        dueDate: new Date("2026-03-20T12:00:00.000Z"),
      },
    ],
    {
      urgentAfterDays: 7,
      finalAfterDays: 21,
    },
    new Date("2026-04-23T12:00:00.000Z"),
  );

  assert.deepEqual(summary, {
    currentCount: 1,
    overdueCount: 1,
    urgentCount: 1,
    finalCount: 1,
  });
});
