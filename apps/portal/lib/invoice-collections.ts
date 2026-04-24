import type {
  BillingInvoiceStatus,
  InvoiceCheckoutSessionStatus,
} from "@prisma/client";
import { Prisma } from "@prisma/client";
import { toMoneyDecimal } from "@/lib/invoices";

const REMINDER_READY_STATUSES: BillingInvoiceStatus[] = [
  "SENT",
  "PARTIAL",
  "OVERDUE",
];

const DAY_MS = 24 * 60 * 60 * 1000;

export type InvoiceCollectionsCadenceSettings = {
  enabled: boolean;
  autoSendEnabled?: boolean;
  firstReminderLeadDays: number;
  overdueReminderCadenceDays: number;
  maxReminders: number;
  urgentAfterDays?: number;
  finalAfterDays?: number;
};

export type InvoiceCollectionsQueueStage =
  | "not_applicable"
  | "disabled"
  | "due_now"
  | "upcoming"
  | "maxed";

export type InvoiceCollectionsEscalationStage =
  | "not_applicable"
  | "current"
  | "overdue"
  | "urgent"
  | "final";

export type InvoiceCollectionsAgingBucket =
  | "not_applicable"
  | "current"
  | "days_1_30"
  | "days_31_60"
  | "days_61_plus";

export type InvoiceCollectionsQueueFilter =
  | ""
  | "due"
  | "upcoming"
  | "maxed";

export type InvoiceCollectionsAgingFilter =
  | ""
  | "current"
  | "1_30"
  | "31_60"
  | "61_plus";

export function isInvoiceCollectionsQueueFilter(
  value: string,
): value is Exclude<InvoiceCollectionsQueueFilter, ""> {
  return value === "due" || value === "upcoming" || value === "maxed";
}

export function isInvoiceCollectionsAgingFilter(
  value: string,
): value is Exclude<InvoiceCollectionsAgingFilter, ""> {
  return (
    value === "current" ||
    value === "1_30" ||
    value === "31_60" ||
    value === "61_plus"
  );
}

function getInvoiceOverdueDays(dueDate: Date, now = new Date()) {
  const delta = now.getTime() - dueDate.getTime();
  if (delta <= 0) {
    return 0;
  }

  return Math.floor(delta / DAY_MS);
}

export function summarizeInvoiceCollectionAttempts(
  rows: Array<{
    source: "MANUAL" | "AUTOMATION";
    outcome: "SENT" | "SKIPPED" | "FAILED";
    createdAt: Date;
  }>,
) {
  const summary = {
    automatedSentCount: 0,
    automatedSkippedCount: 0,
    automatedFailedCount: 0,
    lastAutomatedAttemptAt: null as Date | null,
    lastAutomatedAttemptOutcome: null as "SENT" | "SKIPPED" | "FAILED" | null,
  };

  for (const row of rows) {
    if (row.source !== "AUTOMATION") {
      continue;
    }

    if (row.outcome === "SENT") {
      summary.automatedSentCount += 1;
    } else if (row.outcome === "SKIPPED") {
      summary.automatedSkippedCount += 1;
    } else if (row.outcome === "FAILED") {
      summary.automatedFailedCount += 1;
    }

    if (
      !summary.lastAutomatedAttemptAt ||
      row.createdAt.getTime() > summary.lastAutomatedAttemptAt.getTime()
    ) {
      summary.lastAutomatedAttemptAt = row.createdAt;
      summary.lastAutomatedAttemptOutcome = row.outcome;
    }
  }

  return summary;
}

function isJsonObject(
  value: Prisma.JsonValue | null | undefined,
): value is Record<string, Prisma.JsonValue> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readBooleanMetadataValue(value: Prisma.JsonValue | undefined) {
  return typeof value === "boolean" ? value : null;
}

function readStringMetadataValue(value: Prisma.JsonValue | undefined) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumberMetadataValue(value: Prisma.JsonValue | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function readInvoiceCollectionAttemptMetadata(
  metadataJson: Prisma.JsonValue | null | undefined,
) {
  if (!isJsonObject(metadataJson)) {
    return {
      route: null,
      queueStage: null,
      payLinkIncluded: null,
      refreshPayLink: null,
      reminderCount: null,
    };
  }

  return {
    route: readStringMetadataValue(metadataJson.route),
    queueStage: readStringMetadataValue(metadataJson.queueStage),
    payLinkIncluded: readBooleanMetadataValue(metadataJson.payLinkIncluded),
    refreshPayLink: readBooleanMetadataValue(metadataJson.refreshPayLink),
    reminderCount: readNumberMetadataValue(metadataJson.reminderCount),
  };
}

export function summarizeInvoiceCollectionHistory(
  rows: Array<{
    source: "MANUAL" | "AUTOMATION";
    outcome: "SENT" | "SKIPPED" | "FAILED";
    createdAt: Date;
  }>,
) {
  const summary = {
    manualSentCount: 0,
    automatedSentCount: 0,
    skippedCount: 0,
    failedCount: 0,
    lastAttemptAt: null as Date | null,
    lastAttemptOutcome: null as "SENT" | "SKIPPED" | "FAILED" | null,
    lastAttemptSource: null as "MANUAL" | "AUTOMATION" | null,
  };

  for (const row of rows) {
    if (row.outcome === "SENT") {
      if (row.source === "AUTOMATION") {
        summary.automatedSentCount += 1;
      } else {
        summary.manualSentCount += 1;
      }
    } else if (row.outcome === "SKIPPED") {
      summary.skippedCount += 1;
    } else if (row.outcome === "FAILED") {
      summary.failedCount += 1;
    }

    if (
      !summary.lastAttemptAt ||
      row.createdAt.getTime() > summary.lastAttemptAt.getTime()
    ) {
      summary.lastAttemptAt = row.createdAt;
      summary.lastAttemptOutcome = row.outcome;
      summary.lastAttemptSource = row.source;
    }
  }

  return summary;
}

function emptyCollectionsValueStage() {
  return {
    count: 0,
    balanceDue: new Prisma.Decimal(0),
  };
}

function emptyCollectionsSourcePerformance() {
  return {
    sentCount: 0,
    skippedCount: 0,
    failedCount: 0,
    totalCount: 0,
  };
}

export function summarizeInvoiceCollectionsOwnerReport(
  rows: Array<{
    status: BillingInvoiceStatus;
    balanceDue: Prisma.Decimal | number | string;
    dueDate: Date;
    amountPaid?: Prisma.Decimal | number | string | null;
    payments?: Array<{
      amount: Prisma.Decimal | number | string;
      date: Date;
    }>;
    collectionAttempts?: Array<{
      source: "MANUAL" | "AUTOMATION";
      outcome: "SENT" | "SKIPPED" | "FAILED";
      createdAt: Date;
    }>;
  }>,
  settings: Pick<
    InvoiceCollectionsCadenceSettings,
    "urgentAfterDays" | "finalAfterDays"
  >,
  now = new Date(),
) {
  const summary = {
    recoveredAfterCollectionTotal: new Prisma.Decimal(0),
    stillAtRiskTotal: new Prisma.Decimal(0),
    highRiskTotal: new Prisma.Decimal(0),
    escalation: {
      current: emptyCollectionsValueStage(),
      overdue: emptyCollectionsValueStage(),
      urgent: emptyCollectionsValueStage(),
      final: emptyCollectionsValueStage(),
    },
    performance: {
      manual: emptyCollectionsSourcePerformance(),
      automation: emptyCollectionsSourcePerformance(),
      sentCount: 0,
      skippedCount: 0,
      failedCount: 0,
      totalCount: 0,
    },
  };

  for (const row of rows) {
    const balanceDue = toMoneyDecimal(row.balanceDue);
    const escalationStage = deriveInvoiceCollectionsEscalationStage({
      status: row.status,
      balanceDue,
      dueDate: row.dueDate,
      settings,
      now,
    });

    if (escalationStage !== "not_applicable") {
      const stageSummary = summary.escalation[escalationStage];
      stageSummary.count += 1;
      stageSummary.balanceDue = stageSummary.balanceDue.plus(balanceDue);

      if (escalationStage !== "current") {
        summary.stillAtRiskTotal = summary.stillAtRiskTotal.plus(balanceDue);
      }

      if (escalationStage === "urgent" || escalationStage === "final") {
        summary.highRiskTotal = summary.highRiskTotal.plus(balanceDue);
      }
    }

    const attempts = row.collectionAttempts || [];
    let earliestCollectionAttemptAt: Date | null = null;

    for (const attempt of attempts) {
      const sourceSummary =
        attempt.source === "AUTOMATION"
          ? summary.performance.automation
          : summary.performance.manual;

      sourceSummary.totalCount += 1;
      summary.performance.totalCount += 1;

      if (attempt.outcome === "SENT") {
        sourceSummary.sentCount += 1;
        summary.performance.sentCount += 1;
      } else if (attempt.outcome === "SKIPPED") {
        sourceSummary.skippedCount += 1;
        summary.performance.skippedCount += 1;
      } else if (attempt.outcome === "FAILED") {
        sourceSummary.failedCount += 1;
        summary.performance.failedCount += 1;
      }

      if (
        !earliestCollectionAttemptAt ||
        attempt.createdAt.getTime() < earliestCollectionAttemptAt.getTime()
      ) {
        earliestCollectionAttemptAt = attempt.createdAt;
      }
    }

    if (!earliestCollectionAttemptAt) {
      continue;
    }

    if (row.payments?.length) {
      for (const payment of row.payments) {
        if (payment.date.getTime() >= earliestCollectionAttemptAt.getTime()) {
          summary.recoveredAfterCollectionTotal =
            summary.recoveredAfterCollectionTotal.plus(
              toMoneyDecimal(payment.amount),
            );
        }
      }
      continue;
    }

    const amountPaid = toMoneyDecimal(row.amountPaid ?? 0);
    if (amountPaid.gt(0)) {
      summary.recoveredAfterCollectionTotal =
        summary.recoveredAfterCollectionTotal.plus(amountPaid);
    }
  }

  return summary;
}

export function deriveInvoiceCollectionsAgingBucket(input: {
  status?: BillingInvoiceStatus;
  balanceDue: Prisma.Decimal | number | string;
  dueDate: Date;
  now?: Date;
}) {
  if (input.status === "DRAFT") {
    return "not_applicable" as InvoiceCollectionsAgingBucket;
  }

  if (toMoneyDecimal(input.balanceDue).lte(0)) {
    return "not_applicable" as InvoiceCollectionsAgingBucket;
  }

  const overdueDays = getInvoiceOverdueDays(input.dueDate, input.now);
  if (overdueDays <= 0) {
    return "current" as InvoiceCollectionsAgingBucket;
  }
  if (overdueDays <= 30) {
    return "days_1_30" as InvoiceCollectionsAgingBucket;
  }
  if (overdueDays <= 60) {
    return "days_31_60" as InvoiceCollectionsAgingBucket;
  }
  return "days_61_plus" as InvoiceCollectionsAgingBucket;
}

export function summarizeInvoiceCollectionsAging(
  rows: Array<{
    status?: BillingInvoiceStatus;
    balanceDue: Prisma.Decimal | number | string;
    dueDate: Date;
  }>,
  now = new Date(),
) {
  const summary = {
    currentCount: 0,
    days1to30Count: 0,
    days31to60Count: 0,
    days61PlusCount: 0,
  };

  for (const row of rows) {
    const bucket = deriveInvoiceCollectionsAgingBucket({
      status: row.status,
      balanceDue: row.balanceDue,
      dueDate: row.dueDate,
      now,
    });

    if (bucket === "current") {
      summary.currentCount += 1;
    } else if (bucket === "days_1_30") {
      summary.days1to30Count += 1;
    } else if (bucket === "days_31_60") {
      summary.days31to60Count += 1;
    } else if (bucket === "days_61_plus") {
      summary.days61PlusCount += 1;
    }
  }

  return summary;
}

export function deriveInvoiceCollectionsEscalationStage(input: {
  status: BillingInvoiceStatus;
  balanceDue: Prisma.Decimal | number | string;
  dueDate: Date;
  settings: Pick<
    InvoiceCollectionsCadenceSettings,
    "urgentAfterDays" | "finalAfterDays"
  >;
  now?: Date;
}) {
  if (
    !canSendInvoiceReminder({
      status: input.status,
      balanceDue: input.balanceDue,
    })
  ) {
    return "not_applicable" as InvoiceCollectionsEscalationStage;
  }

  const overdueDays = getInvoiceOverdueDays(input.dueDate, input.now);
  const urgentAfterDays = Math.max(1, input.settings.urgentAfterDays ?? 7);
  const finalAfterDays = Math.max(
    urgentAfterDays + 1,
    input.settings.finalAfterDays ?? 21,
  );

  if (overdueDays <= 0) {
    return "current" as InvoiceCollectionsEscalationStage;
  }
  if (overdueDays >= finalAfterDays) {
    return "final" as InvoiceCollectionsEscalationStage;
  }
  if (overdueDays >= urgentAfterDays) {
    return "urgent" as InvoiceCollectionsEscalationStage;
  }
  return "overdue" as InvoiceCollectionsEscalationStage;
}

export function summarizeInvoiceCollectionsEscalation(
  rows: Array<{
    status: BillingInvoiceStatus;
    balanceDue: Prisma.Decimal | number | string;
    dueDate: Date;
  }>,
  settings: Pick<
    InvoiceCollectionsCadenceSettings,
    "urgentAfterDays" | "finalAfterDays"
  >,
  now = new Date(),
) {
  const summary = {
    currentCount: 0,
    overdueCount: 0,
    urgentCount: 0,
    finalCount: 0,
  };

  for (const row of rows) {
    const stage = deriveInvoiceCollectionsEscalationStage({
      status: row.status,
      balanceDue: row.balanceDue,
      dueDate: row.dueDate,
      settings,
      now,
    });

    if (stage === "current") {
      summary.currentCount += 1;
    } else if (stage === "overdue") {
      summary.overdueCount += 1;
    } else if (stage === "urgent") {
      summary.urgentCount += 1;
    } else if (stage === "final") {
      summary.finalCount += 1;
    }
  }

  return summary;
}

export function canSendInvoiceReminder(input: {
  status: BillingInvoiceStatus;
  balanceDue: Prisma.Decimal | number | string;
}): boolean {
  return (
    REMINDER_READY_STATUSES.includes(input.status) &&
    toMoneyDecimal(input.balanceDue).gt(0)
  );
}

export function summarizeInvoiceCollections(
  rows: Array<{
    status: BillingInvoiceStatus;
    balanceDue: Prisma.Decimal | number | string;
    dueDate: Date;
  }>,
  now = new Date(),
) {
  const dueSoonThreshold = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const summary = {
    totalOpenCount: 0,
    draftCount: 0,
    reminderReadyCount: 0,
    overdueCount: 0,
    dueSoonCount: 0,
    outstandingTotal: new Prisma.Decimal(0),
  };

  for (const row of rows) {
    const balanceDue = toMoneyDecimal(row.balanceDue);
    if (balanceDue.lte(0)) {
      continue;
    }

    summary.totalOpenCount += 1;
    summary.outstandingTotal = summary.outstandingTotal.plus(balanceDue);

    if (row.status === "DRAFT") {
      summary.draftCount += 1;
      continue;
    }

    if (canSendInvoiceReminder({ status: row.status, balanceDue })) {
      summary.reminderReadyCount += 1;
    }

    const dueAt = row.dueDate.getTime();
    if (dueAt < now.getTime()) {
      summary.overdueCount += 1;
    } else if (dueAt <= dueSoonThreshold.getTime()) {
      summary.dueSoonCount += 1;
    }
  }

  return summary;
}

export function deriveInvoiceCheckoutRecoveryState(input: {
  status?: InvoiceCheckoutSessionStatus | null;
  lastError?: string | null;
  checkoutUrl?: string | null;
  expiresAt?: Date | null;
  now?: Date;
}) {
  const now = input.now || new Date();
  const activeCheckoutUrl =
    input.status === "OPEN" &&
    input.checkoutUrl &&
    (!input.expiresAt || input.expiresAt.getTime() > now.getTime())
      ? input.checkoutUrl
      : null;

  if (input.lastError?.trim()) {
    return {
      issue: "failed" as const,
      activeCheckoutUrl,
    };
  }

  if (input.status === "EXPIRED") {
    return {
      issue: "expired" as const,
      activeCheckoutUrl,
    };
  }

  if (input.status === "CANCELED") {
    return {
      issue: "replaced" as const,
      activeCheckoutUrl,
    };
  }

  return {
    issue: null,
    activeCheckoutUrl,
  };
}

export function hasInvoiceReminderHistory(input: {
  reminderCount?: number | null;
  lastReminderSentAt?: Date | null;
}) {
  return Boolean(
    (input.reminderCount || 0) > 0 || input.lastReminderSentAt,
  );
}

export function deriveInvoiceCollectionsQueueState(input: {
  status: BillingInvoiceStatus;
  balanceDue: Prisma.Decimal | number | string;
  dueDate: Date;
  sentAt?: Date | null;
  lastReminderSentAt?: Date | null;
  reminderCount?: number | null;
  settings: InvoiceCollectionsCadenceSettings;
  now?: Date;
}) {
  const now = input.now || new Date();
  const reminderCount = Math.max(0, input.reminderCount || 0);
  const maxReminders = Math.max(1, input.settings.maxReminders);

  if (
    !canSendInvoiceReminder({
      status: input.status,
      balanceDue: input.balanceDue,
    })
  ) {
    return {
      stage: "not_applicable" as InvoiceCollectionsQueueStage,
      nextReminderAt: null,
      overdue: input.dueDate.getTime() < now.getTime(),
      remindersRemaining: 0,
    };
  }

  if (!input.settings.enabled) {
    return {
      stage: "disabled" as InvoiceCollectionsQueueStage,
      nextReminderAt: null,
      overdue: input.dueDate.getTime() < now.getTime(),
      remindersRemaining: Math.max(0, maxReminders - reminderCount),
    };
  }

  if (reminderCount >= maxReminders) {
    return {
      stage: "maxed" as InvoiceCollectionsQueueStage,
      nextReminderAt: null,
      overdue: input.dueDate.getTime() < now.getTime(),
      remindersRemaining: 0,
    };
  }

  const firstReminderAt = new Date(
    Math.max(
      input.dueDate.getTime() - input.settings.firstReminderLeadDays * DAY_MS,
      input.sentAt?.getTime() ?? Number.NEGATIVE_INFINITY,
    ),
  );
  const overdueEarliestAt = new Date(
    input.dueDate.getTime() +
      input.settings.overdueReminderCadenceDays * DAY_MS,
  );
  const nextReminderAt =
    reminderCount === 0
      ? firstReminderAt
      : new Date(
          Math.max(
            overdueEarliestAt.getTime(),
            (input.lastReminderSentAt?.getTime() ??
              input.sentAt?.getTime() ??
              input.dueDate.getTime()) +
              input.settings.overdueReminderCadenceDays * DAY_MS,
          ),
        );

  return {
    stage:
      nextReminderAt.getTime() <= now.getTime()
        ? ("due_now" as InvoiceCollectionsQueueStage)
        : ("upcoming" as InvoiceCollectionsQueueStage),
    nextReminderAt,
    overdue: input.dueDate.getTime() < now.getTime(),
    remindersRemaining: Math.max(0, maxReminders - reminderCount),
  };
}

export function summarizeInvoiceCollectionsQueue(
  rows: Array<{
    status: BillingInvoiceStatus;
    balanceDue: Prisma.Decimal | number | string;
    dueDate: Date;
    sentAt?: Date | null;
    lastReminderSentAt?: Date | null;
    reminderCount?: number | null;
  }>,
  settings: InvoiceCollectionsCadenceSettings,
  now = new Date(),
) {
  const summary = {
    dueNowCount: 0,
    upcomingCount: 0,
    maxedCount: 0,
    disabledCount: 0,
  };

  for (const row of rows) {
    const state = deriveInvoiceCollectionsQueueState({
      status: row.status,
      balanceDue: row.balanceDue,
      dueDate: row.dueDate,
      sentAt: row.sentAt || null,
      lastReminderSentAt: row.lastReminderSentAt || null,
      reminderCount: row.reminderCount || 0,
      settings,
      now,
    });

    if (state.stage === "due_now") {
      summary.dueNowCount += 1;
    } else if (state.stage === "upcoming") {
      summary.upcomingCount += 1;
    } else if (state.stage === "maxed") {
      summary.maxedCount += 1;
    } else if (state.stage === "disabled") {
      summary.disabledCount += 1;
    }
  }

  return summary;
}
