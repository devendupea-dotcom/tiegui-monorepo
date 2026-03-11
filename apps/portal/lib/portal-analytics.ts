import "server-only";

import { addDays, addMonths, startOfDay, startOfMonth, startOfWeek, subMonths } from "date-fns";
import type { CalendarAccessRole, LeadSourceChannel, MarketingChannel, Prisma as PrismaNamespace } from "@prisma/client";
import { Prisma } from "@prisma/client";
import {
  DEFAULT_CALENDAR_TIMEZONE,
  formatDateOnly,
  getLocalMinutesInDay,
  getUtcRangeForDate,
} from "@/lib/calendar/dates";
import { getOrgCalendarSettings } from "@/lib/calendar/availability";
import { getIntegrationProviderConfiguration } from "@/lib/integrations/provider-config";
import { prisma } from "@/lib/prisma";

export type AnalyticsRange = "7d" | "30d" | "month";

export type AnalyticsViewer = {
  id: string;
  internalUser: boolean;
  calendarAccessRole: CalendarAccessRole;
  orgId: string;
};

type AnalyticsChannel = "GOOGLE_ADS" | "META_ADS" | "ORGANIC" | "REFERRAL" | "OTHER";

type ChannelMetrics = {
  key: AnalyticsChannel;
  label: string;
  spendCents: number;
  leads: number;
  cplCents: number | null;
  bookedJobs: number;
  revenueCents: number;
  roas: number | null;
  weekly: Array<{
    weekStart: string;
    label: string;
    leads: number;
    revenueCents: number;
  }>;
  editable: boolean;
};

export type PortalSummaryMetrics = {
  visibility: "full" | "limited";
  range: AnalyticsRange;
  generatedAt: string;
  orgId: string;
  newLeadsCount: number;
  missedCallsRecoveredCount: number | null;
  avgResponseTimeMinutes: number | null;
  bookingRatePct: number | null;
  jobsThisWeekCount: number;
  openSlotsNext7Days: number;
  utilizationPct: number | null;
  systemHealth: {
    messaging: "ACTIVE" | "NEEDS_SETUP";
    calendar: "CONNECTED" | "NEEDS_SETUP";
    integrations: "CONFIGURED" | "NOT_CONFIGURED";
    integrationsHref: string;
  };
  links: {
    revenue: string;
    leads: string;
    workload: string;
    ads: string;
  };
} & Partial<{
  grossRevenueThisMonthCents: number | null;
  collectedRevenueThisMonthCents: number | null;
  revenueLastMonthGrossCents: number | null;
  revenueLastMonthCollectedCents: number | null;
  // Backward-compatible aliases for older summary consumers.
  revenueThisMonthCents: number | null;
  revenueLastMonthCents: number | null;
  avgJobValueCents: number | null;
  outstandingInvoicesCount: number | null;
  outstandingInvoicesTotalCents: number | null;
}>;

export type PortalAdsMetrics = {
  visibility: "full";
  generatedAt: string;
  orgId: string;
  month: string;
  monthLabel: string;
  totals: {
    spendCents: number;
    leads: number;
    cplCents: number | null;
    bookedJobs: number;
    revenueCents: number;
    roas: number | null;
  };
  channels: ChannelMetrics[];
};

export type MarketingSpendRecord = {
  id: string;
  month: string;
  channel: MarketingChannel;
  spendCents: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

type WorkerLikeFilter = {
  OR: Array<
    | { assignedToUserId: string }
    | { createdByUserId: string }
    | { events: { some: { assignedToUserId: string } } }
    | { events: { some: { workerAssignments: { some: { workerUserId: string } } } } }
  >;
};

const OPEN_INVOICE_STATUSES = ["DRAFT", "SENT", "PARTIAL", "OVERDUE"] as const;
const REVENUE_STATUS_FALLBACK = ["PAID", "PARTIAL"] as const;
const DISPLAY_CHANNELS: Array<{ key: AnalyticsChannel; label: string; editable: boolean }> = [
  { key: "GOOGLE_ADS", label: "Google Ads", editable: true },
  { key: "META_ADS", label: "Facebook / Instagram", editable: true },
  { key: "ORGANIC", label: "Organic", editable: false },
  { key: "REFERRAL", label: "Referral", editable: false },
  { key: "OTHER", label: "Other", editable: true },
];

function canViewFinancialAnalytics(viewer: AnalyticsViewer): boolean {
  return viewer.internalUser || viewer.calendarAccessRole === "OWNER" || viewer.calendarAccessRole === "ADMIN";
}

function isWorkerScoped(viewer: AnalyticsViewer): boolean {
  return !viewer.internalUser && viewer.calendarAccessRole === "WORKER";
}

function buildLeadScope(viewer: AnalyticsViewer): WorkerLikeFilter | undefined {
  if (!isWorkerScoped(viewer)) return undefined;
  return {
    OR: [
      { assignedToUserId: viewer.id },
      { createdByUserId: viewer.id },
      { events: { some: { assignedToUserId: viewer.id } } },
      { events: { some: { workerAssignments: { some: { workerUserId: viewer.id } } } } },
    ],
  };
}

function buildEventScope(viewer: AnalyticsViewer):
  | {
      OR: Array<
        | { assignedToUserId: string }
        | { workerAssignments: { some: { workerUserId: string } } }
      >;
    }
  | undefined {
  if (!isWorkerScoped(viewer)) return undefined;
  return {
    OR: [
      { assignedToUserId: viewer.id },
      { workerAssignments: { some: { workerUserId: viewer.id } } },
    ],
  };
}

function buildInvoiceScope(viewer: AnalyticsViewer): PrismaNamespace.InvoiceWhereInput | undefined {
  if (!isWorkerScoped(viewer)) return undefined;
  return {
    job: {
      OR: [
        { assignedToUserId: viewer.id },
        { createdByUserId: viewer.id },
        { events: { some: { assignedToUserId: viewer.id } } },
        { events: { some: { workerAssignments: { some: { workerUserId: viewer.id } } } } },
      ],
    },
  };
}

function coerceNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (value && typeof value === "object" && "toString" in value) {
    const parsed = Number((value as { toString(): string }).toString());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function decimalToCents(value: unknown): number {
  return Math.round(coerceNumber(value) * 100);
}

function pct(value: number, total: number): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return null;
  return Math.round((value / total) * 1000) / 10;
}

function ratio(value: number, total: number): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return null;
  return Math.round((value / total) * 100) / 100;
}

function normalizeRange(range: string | null | undefined): AnalyticsRange {
  if (range === "7d" || range === "30d") return range;
  return "month";
}

function parseMonthStart(month: string | null | undefined): Date {
  const trimmed = typeof month === "string" ? month.trim() : "";
  if (/^\d{4}-\d{2}$/.test(trimmed)) {
    const parsed = new Date(`${trimmed}-01T00:00:00.000Z`);
    if (!Number.isNaN(parsed.getTime())) {
      return startOfMonth(parsed);
    }
  }
  return startOfMonth(new Date());
}

function formatMonthKey(value: Date): string {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}

function getRangeWindow(range: AnalyticsRange) {
  const now = new Date();
  if (range === "7d") {
    return {
      start: startOfDay(addDays(now, -6)),
      endExclusive: startOfDay(addDays(now, 1)),
    };
  }

  if (range === "30d") {
    return {
      start: startOfDay(addDays(now, -29)),
      endExclusive: startOfDay(addDays(now, 1)),
    };
  }

  return {
    start: startOfMonth(now),
    endExclusive: startOfDay(addDays(now, 1)),
  };
}

function buildChannelAccumulator(): Record<AnalyticsChannel, number> {
  return {
    GOOGLE_ADS: 0,
    META_ADS: 0,
    ORGANIC: 0,
    REFERRAL: 0,
    OTHER: 0,
  };
}

function sumChannelAccumulator(values: Record<AnalyticsChannel, number>): number {
  return Object.values(values).reduce((sum, value) => sum + value, 0);
}

function toAnalyticsChannel(value: string | null | undefined): AnalyticsChannel {
  if (value === "GOOGLE_ADS" || value === "META_ADS" || value === "ORGANIC" || value === "REFERRAL") {
    return value;
  }
  return "OTHER";
}

function weekLabel(weekStart: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(weekStart);
}

function addWeeklyValue(
  target: Map<AnalyticsChannel, Map<string, { weekStart: string; label: string; leads: number; revenueCents: number }>>,
  channel: AnalyticsChannel,
  weekStart: Date,
  kind: "leads" | "revenueCents",
  amount: number,
) {
  const weekKey = formatDateOnly(weekStart);
  const channelMap = target.get(channel) || new Map<string, { weekStart: string; label: string; leads: number; revenueCents: number }>();
  const current = channelMap.get(weekKey) || {
    weekStart: weekKey,
    label: weekLabel(weekStart),
    leads: 0,
    revenueCents: 0,
  };
  current[kind] += amount;
  channelMap.set(weekKey, current);
  target.set(channel, channelMap);
}

async function getRevenueByChannelForRange(input: {
  orgId: string;
  start: Date;
  endExclusive: Date;
}): Promise<Record<AnalyticsChannel, number>> {
  const totals = buildChannelAccumulator();

  const paymentRows = await prisma.$queryRaw<Array<{ channel: string | null; cents: bigint | number | null }>>(Prisma.sql`
    SELECT
      COALESCE("Lead"."sourceChannel"::text, 'OTHER') AS "channel",
      COALESCE(
        SUM(CAST(ROUND(CAST("InvoicePayment"."amount" AS numeric) * 100) AS bigint)),
        0
      ) AS "cents"
    FROM "InvoicePayment"
    INNER JOIN "Invoice" ON "Invoice"."id" = "InvoicePayment"."invoiceId"
    LEFT JOIN "Lead" ON "Lead"."id" = "Invoice"."jobId"
    WHERE "Invoice"."orgId" = ${input.orgId}
      AND "InvoicePayment"."date" >= ${input.start}
      AND "InvoicePayment"."date" < ${input.endExclusive}
    GROUP BY COALESCE("Lead"."sourceChannel"::text, 'OTHER')
  `);

  if (paymentRows.length > 0) {
    for (const row of paymentRows) {
      totals[toAnalyticsChannel(row.channel)] += coerceNumber(row.cents);
    }
    return totals;
  }

  const fallbackRows = await prisma.invoice.findMany({
    where: {
      orgId: input.orgId,
      status: { in: [...REVENUE_STATUS_FALLBACK] },
      updatedAt: { gte: input.start, lt: input.endExclusive },
    },
    select: {
      amountPaid: true,
      job: {
        select: {
          sourceChannel: true,
        },
      },
    },
  });

  for (const row of fallbackRows) {
    totals[toAnalyticsChannel(row.job?.sourceChannel)] += decimalToCents(row.amountPaid);
  }

  return totals;
}

async function getCollectedRevenueForRange(input: {
  orgId: string;
  start: Date;
  endExclusive: Date;
}): Promise<number | null> {
  const paymentRows = await prisma.$queryRaw<Array<{ paymentCount: bigint | number | null; cents: bigint | number | null }>>(Prisma.sql`
    SELECT
      COUNT(*) AS "paymentCount",
      COALESCE(
        SUM(CAST(ROUND(CAST("InvoicePayment"."amount" AS numeric) * 100) AS bigint)),
        0
      ) AS "cents"
    FROM "InvoicePayment"
    INNER JOIN "Invoice" ON "Invoice"."id" = "InvoicePayment"."invoiceId"
    WHERE "Invoice"."orgId" = ${input.orgId}
      AND "InvoicePayment"."date" >= ${input.start}
      AND "InvoicePayment"."date" < ${input.endExclusive}
  `);

  const paymentCount = coerceNumber(paymentRows[0]?.paymentCount);
  if (paymentCount > 0) {
    return coerceNumber(paymentRows[0]?.cents);
  }

  const fallback = await prisma.invoice.aggregate({
    where: {
      orgId: input.orgId,
      status: { in: [...REVENUE_STATUS_FALLBACK] },
      updatedAt: { gte: input.start, lt: input.endExclusive },
    },
    _count: {
      _all: true,
    },
    _sum: {
      amountPaid: true,
    },
  });

  if ((fallback._count._all || 0) === 0) {
    return null;
  }

  return fallback._sum.amountPaid ? decimalToCents(fallback._sum.amountPaid) : 0;
}

async function getGrossRevenueForRange(input: {
  orgId: string;
  start: Date;
  endExclusive: Date;
}): Promise<number | null> {
  const rows = await prisma.$queryRaw<Array<{ completedJobsCount: bigint | number | null; cents: bigint | number | null }>>(Prisma.sql`
    WITH completed_jobs AS (
      SELECT DISTINCT ON ("Event"."leadId")
        "Event"."leadId"
      FROM "Event"
      WHERE "Event"."orgId" = ${input.orgId}
        AND "Event"."type" = 'JOB'
        AND "Event"."status" = 'COMPLETED'
        AND "Event"."leadId" IS NOT NULL
        -- We do not persist a completedAt timestamp yet, so updatedAt is the nearest stable completion signal.
        AND "Event"."updatedAt" >= ${input.start}
        AND "Event"."updatedAt" < ${input.endExclusive}
      ORDER BY "Event"."leadId", "Event"."updatedAt" DESC, "Event"."id" DESC
    ),
    invoice_totals AS (
      SELECT
        "Invoice"."jobId",
        SUM(CAST(ROUND(CAST("Invoice"."total" AS numeric) * 100) AS bigint)) AS "cents"
      FROM "Invoice"
      WHERE "Invoice"."orgId" = ${input.orgId}
        AND "Invoice"."jobId" IS NOT NULL
      GROUP BY "Invoice"."jobId"
    )
    SELECT
      COUNT(*) AS "completedJobsCount",
      COALESCE(SUM(COALESCE(invoice_totals."cents", "Lead"."estimatedRevenueCents", 0)), 0) AS "cents"
    FROM completed_jobs
    INNER JOIN "Lead" ON "Lead"."id" = completed_jobs."leadId"
    LEFT JOIN invoice_totals ON invoice_totals."jobId" = completed_jobs."leadId"
  `);

  const completedJobsCount = coerceNumber(rows[0]?.completedJobsCount);
  if (completedJobsCount === 0) {
    return null;
  }

  return coerceNumber(rows[0]?.cents);
}

async function getAverageFirstResponseMinutes(input: {
  orgId: string;
  start: Date;
  endExclusive: Date;
}): Promise<number | null> {
  const rows = await prisma.$queryRaw<Array<{ avgMinutes: number | null }>>(Prisma.sql`
    WITH candidate_leads AS (
      SELECT "id", "createdAt"
      FROM "Lead"
      WHERE "orgId" = ${input.orgId}
        AND "createdAt" >= ${input.start}
        AND "createdAt" < ${input.endExclusive}
    ),
    activities AS (
      SELECT "leadId", "createdAt" AS "at"
      FROM "Message"
      WHERE direction = 'OUTBOUND'
      UNION ALL
      SELECT "leadId", "startedAt" AS "at"
      FROM "Call"
      WHERE direction = 'OUTBOUND'
    ),
    first_responses AS (
      SELECT
        candidate_leads."id",
        MIN(activities."at") AS "firstResponseAt"
      FROM candidate_leads
      INNER JOIN activities
        ON activities."leadId" = candidate_leads."id"
       AND activities."at" >= candidate_leads."createdAt"
      GROUP BY candidate_leads."id"
    )
    SELECT AVG(EXTRACT(EPOCH FROM ("firstResponseAt" - candidate_leads."createdAt")) / 60.0) AS "avgMinutes"
    FROM candidate_leads
    INNER JOIN first_responses ON first_responses."id" = candidate_leads."id"
  `);

  const avg = rows[0]?.avgMinutes;
  return typeof avg === "number" && Number.isFinite(avg) ? Math.round(avg * 10) / 10 : null;
}

async function getRecoveredMissedCallsCount(input: {
  orgId: string;
  start: Date;
  endExclusive: Date;
}): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint | number | null }>>(Prisma.sql`
    WITH missed_calls AS (
      SELECT "id", "leadId", "startedAt"
      FROM "Call"
      WHERE "orgId" = ${input.orgId}
        AND "status" = 'MISSED'
        AND "leadId" IS NOT NULL
        AND "startedAt" >= ${input.start}
        AND "startedAt" < ${input.endExclusive}
    )
    SELECT COUNT(*) AS "count"
    FROM missed_calls
    WHERE EXISTS (
      SELECT 1
      FROM "Message"
      WHERE "Message"."leadId" = missed_calls."leadId"
        AND "Message"."direction" = 'INBOUND'
        AND "Message"."createdAt" > missed_calls."startedAt"
    )
    OR EXISTS (
      SELECT 1
      FROM "Event"
      WHERE "Event"."leadId" = missed_calls."leadId"
        AND "Event"."type" = 'JOB'
        AND "Event"."createdAt" > missed_calls."startedAt"
    )
    OR EXISTS (
      SELECT 1
      FROM "Lead"
      WHERE "Lead"."id" = missed_calls."leadId"
        AND "Lead"."status" = 'BOOKED'
    )
  `);

  return coerceNumber(rows[0]?.count);
}

async function resolveAnalyticsWorkers(viewer: AnalyticsViewer) {
  return prisma.user.findMany({
    where: {
      orgId: viewer.orgId,
      calendarAccessRole: { not: "READ_ONLY" },
      ...(isWorkerScoped(viewer) ? { id: viewer.id } : {}),
    },
    select: {
      id: true,
      timezone: true,
      calendarAccessRole: true,
    },
    orderBy: [{ calendarAccessRole: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
}

function mergeIntervals(intervals: Array<{ startMinute: number; endMinute: number }>) {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.startMinute - b.startMinute);
  const merged: Array<{ startMinute: number; endMinute: number }> = [];

  for (const current of sorted) {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push({ ...current });
      continue;
    }
    if (current.startMinute <= last.endMinute) {
      last.endMinute = Math.max(last.endMinute, current.endMinute);
      continue;
    }
    merged.push({ ...current });
  }

  return merged;
}

function intervalMinutes(intervals: Array<{ startMinute: number; endMinute: number }>): number {
  return intervals.reduce((sum, interval) => sum + Math.max(0, interval.endMinute - interval.startMinute), 0);
}

function minutesForDateRange(input: {
  startAt: Date;
  endAt: Date;
  dayStartUtc: Date;
  dayEndUtc: Date;
  timeZone: string;
}) {
  const boundedStart = input.startAt < input.dayStartUtc ? input.dayStartUtc : input.startAt;
  const boundedEnd = input.endAt > input.dayEndUtc ? input.dayEndUtc : input.endAt;
  if (boundedEnd <= boundedStart) {
    return null;
  }

  const startMinute = Math.max(0, Math.min(24 * 60, getLocalMinutesInDay(boundedStart, input.timeZone)));
  const endMinute =
    boundedEnd >= input.dayEndUtc
      ? 24 * 60
      : Math.max(startMinute + 1, Math.min(24 * 60, getLocalMinutesInDay(boundedEnd, input.timeZone)));

  return {
    startMinute,
    endMinute,
  };
}

async function computeOpenSlotsAndUtilization(viewer: AnalyticsViewer) {
  const settings = await getOrgCalendarSettings(viewer.orgId);
  const workers = await resolveAnalyticsWorkers(viewer);
  if (workers.length === 0) {
    return {
      openSlotsNext7Days: 0,
      utilizationPct: null,
    };
  }

  const slotMinutes = settings.defaultSlotMinutes;
  const windowStart = startOfDay(new Date());
  const windowEndExclusive = startOfDay(addDays(windowStart, 7));
  const dateKeys = Array.from({ length: 7 }, (_, index) =>
    formatDateOnly(addDays(windowStart, index)),
  );
  const workerIds = workers.map((worker) => worker.id);
  const dayOfWeekSet = new Set(dateKeys.map((dateKey) => new Date(`${dateKey}T12:00:00`).getDay()));

  const [workingHours, events, holds, timeOffEntries] = await Promise.all([
    prisma.workingHours.findMany({
      where: {
        orgId: viewer.orgId,
        workerUserId: { in: workerIds },
        dayOfWeek: { in: [...dayOfWeekSet] },
      },
      select: {
        workerUserId: true,
        dayOfWeek: true,
        startMinute: true,
        endMinute: true,
        isWorking: true,
      },
    }),
    prisma.event.findMany({
      where: {
        orgId: viewer.orgId,
        busy: true,
        status: { not: "CANCELLED" },
        AND: [
          { startAt: { lt: windowEndExclusive } },
          { OR: [{ endAt: null }, { endAt: { gt: windowStart } }] },
          {
            OR: [
              { assignedToUserId: { in: workerIds } },
              { workerAssignments: { some: { workerUserId: { in: workerIds } } } },
            ],
          },
        ],
      },
      select: {
        id: true,
        startAt: true,
        endAt: true,
        assignedToUserId: true,
        workerAssignments: {
          select: {
            workerUserId: true,
          },
        },
      },
    }),
    prisma.calendarHold.findMany({
      where: {
        orgId: viewer.orgId,
        workerUserId: { in: workerIds },
        status: "ACTIVE",
        expiresAt: { gt: new Date() },
        startAt: { lt: windowEndExclusive },
        endAt: { gt: windowStart },
      },
      select: {
        workerUserId: true,
        startAt: true,
        endAt: true,
      },
    }),
    prisma.timeOff.findMany({
      where: {
        orgId: viewer.orgId,
        workerUserId: { in: workerIds },
        startAt: { lt: windowEndExclusive },
        endAt: { gt: windowStart },
      },
      select: {
        workerUserId: true,
        startAt: true,
        endAt: true,
      },
    }),
  ]);

  const workingHoursByWorkerDay = new Map<string, { startMinute: number; endMinute: number; isWorking: boolean }>();
  for (const row of workingHours) {
    workingHoursByWorkerDay.set(`${row.workerUserId}:${row.dayOfWeek}`, {
      startMinute: row.startMinute,
      endMinute: row.endMinute,
      isWorking: row.isWorking,
    });
  }

  const eventIntervalsByWorker = new Map<string, Array<{ startAt: Date; endAt: Date }>>();
  for (const event of events) {
    const participantIds = new Set<string>();
    if (event.assignedToUserId) {
      participantIds.add(event.assignedToUserId);
    }
    for (const assignment of event.workerAssignments) {
      participantIds.add(assignment.workerUserId);
    }
    for (const workerUserId of participantIds) {
      if (!workerIds.includes(workerUserId)) continue;
      const list = eventIntervalsByWorker.get(workerUserId) || [];
      list.push({
        startAt: event.startAt,
        endAt: event.endAt || new Date(event.startAt.getTime() + slotMinutes * 60 * 1000),
      });
      eventIntervalsByWorker.set(workerUserId, list);
    }
  }

  const holdIntervalsByWorker = new Map<string, Array<{ startAt: Date; endAt: Date }>>();
  for (const hold of holds) {
    const list = holdIntervalsByWorker.get(hold.workerUserId) || [];
    list.push({
      startAt: hold.startAt,
      endAt: hold.endAt,
    });
    holdIntervalsByWorker.set(hold.workerUserId, list);
  }

  const timeOffIntervalsByWorker = new Map<string, Array<{ startAt: Date; endAt: Date }>>();
  for (const row of timeOffEntries) {
    const list = timeOffIntervalsByWorker.get(row.workerUserId) || [];
    list.push({
      startAt: row.startAt,
      endAt: row.endAt,
    });
    timeOffIntervalsByWorker.set(row.workerUserId, list);
  }

  let openSlotsNext7Days = 0;
  let totalBookedMinutes = 0;
  let totalCapacityMinutes = 0;

  for (const worker of workers) {
    const timeZone = worker.timezone || settings.calendarTimezone || DEFAULT_CALENDAR_TIMEZONE;
    const workerEventIntervals = eventIntervalsByWorker.get(worker.id) || [];
    const workerHoldIntervals = holdIntervalsByWorker.get(worker.id) || [];
    const workerTimeOffIntervals = timeOffIntervalsByWorker.get(worker.id) || [];

    for (const dateKey of dateKeys) {
      const { startUtc, endUtc } = getUtcRangeForDate({
        date: dateKey,
        timeZone,
      });
      const dayOfWeek = new Date(`${dateKey}T12:00:00`).getDay();
      const workingWindow =
        workingHoursByWorkerDay.get(`${worker.id}:${dayOfWeek}`) || {
          startMinute: settings.defaultUntimedStartHour * 60,
          endMinute: Math.min(24 * 60, settings.defaultUntimedStartHour * 60 + 8 * 60),
          isWorking: true,
        };

      if (!workingWindow.isWorking || workingWindow.endMinute <= workingWindow.startMinute) {
        continue;
      }

      const eventMinutes = workerEventIntervals
        .map((interval) =>
          minutesForDateRange({
            ...interval,
            dayStartUtc: startUtc,
            dayEndUtc: endUtc,
            timeZone,
          }),
        )
        .filter(Boolean) as Array<{ startMinute: number; endMinute: number }>;

      const unavailableMinutes = [
        ...workerHoldIntervals
          .map((interval) =>
            minutesForDateRange({
              ...interval,
              dayStartUtc: startUtc,
              dayEndUtc: endUtc,
              timeZone,
            }),
          )
          .filter(Boolean),
        ...workerTimeOffIntervals
          .map((interval) =>
            minutesForDateRange({
              ...interval,
              dayStartUtc: startUtc,
              dayEndUtc: endUtc,
              timeZone,
            }),
          )
          .filter(Boolean),
      ] as Array<{ startMinute: number; endMinute: number }>;

      const mergedEvents = mergeIntervals(eventMinutes);
      const mergedUnavailable = mergeIntervals(unavailableMinutes);
      const workingMinutes = Math.max(0, workingWindow.endMinute - workingWindow.startMinute);
      const capacityMinutes = Math.max(0, workingMinutes - intervalMinutes(mergedUnavailable));
      totalBookedMinutes += intervalMinutes(mergedEvents);
      totalCapacityMinutes += capacityMinutes;

      const blockedForSlots = mergeIntervals([
        ...eventMinutes,
        ...unavailableMinutes,
      ]).map((interval) => ({
        startMinute: Math.max(workingWindow.startMinute, interval.startMinute),
        endMinute: Math.min(workingWindow.endMinute, interval.endMinute),
      }));

      for (
        let minute = workingWindow.startMinute;
        minute + slotMinutes <= workingWindow.endMinute;
        minute += slotMinutes
      ) {
        const slotEnd = minute + slotMinutes;
        const overlaps = blockedForSlots.some(
          (interval) => interval.startMinute < slotEnd && minute < interval.endMinute,
        );
        if (!overlaps) {
          openSlotsNext7Days += 1;
        }
      }
    }
  }

  return {
    openSlotsNext7Days,
    utilizationPct: pct(totalBookedMinutes, totalCapacityMinutes),
  };
}

async function getSummarySystemHealth(orgId: string) {
  const [twilioConfig, googleCount] = await Promise.all([
    prisma.organizationTwilioConfig.findUnique({
      where: { organizationId: orgId },
      select: {
        phoneNumber: true,
        status: true,
      },
    }),
    prisma.googleAccount.count({
      where: {
        orgId,
        isEnabled: true,
      },
    }),
  ]);

  const providers = getIntegrationProviderConfiguration();
  const integrationsConfigured = providers.jobberConfigured || providers.qboConfigured || providers.googleConfigured;

  return {
    messaging:
      twilioConfig?.phoneNumber && twilioConfig.status === "ACTIVE" ? ("ACTIVE" as const) : ("NEEDS_SETUP" as const),
    calendar: googleCount > 0 ? ("CONNECTED" as const) : ("NEEDS_SETUP" as const),
    integrations: integrationsConfigured ? ("CONFIGURED" as const) : ("NOT_CONFIGURED" as const),
    integrationsHref: "/app/settings/integrations#integrations-health",
  };
}

export async function getPortalSummaryMetrics(input: {
  viewer: AnalyticsViewer;
  range?: AnalyticsRange;
}): Promise<PortalSummaryMetrics> {
  const range = normalizeRange(input.range);
  const visibility = canViewFinancialAnalytics(input.viewer) ? "full" : "limited";
  const rangeWindow = getRangeWindow(range);
  const leadScope = buildLeadScope(input.viewer);
  const eventScope = buildEventScope(input.viewer);
  const now = new Date();
  const currentMonthStart = startOfMonth(now);
  const nextMonthStart = addMonths(currentMonthStart, 1);
  const lastMonthStart = startOfMonth(subMonths(now, 1));
  const thisWeekEnd = addDays(startOfDay(now), 7);

  const [
    newLeadsCount,
    bookedLeadCount,
    jobsThisWeekCount,
    workload,
    systemHealth,
  ] = await Promise.all([
    prisma.lead.count({
      where: {
        orgId: input.viewer.orgId,
        createdAt: {
          gte: rangeWindow.start,
          lt: rangeWindow.endExclusive,
        },
        ...(leadScope || {}),
      },
    }),
    visibility === "full"
      ? prisma.lead.count({
          where: {
            orgId: input.viewer.orgId,
            createdAt: {
              gte: rangeWindow.start,
              lt: rangeWindow.endExclusive,
            },
            status: "BOOKED",
            ...(leadScope || {}),
          },
        })
      : Promise.resolve(0),
    prisma.event.count({
      where: {
        orgId: input.viewer.orgId,
        type: "JOB",
        status: { not: "CANCELLED" },
        startAt: {
          gte: startOfDay(now),
          lt: thisWeekEnd,
        },
        ...(eventScope || {}),
      },
    }),
    computeOpenSlotsAndUtilization(input.viewer),
    getSummarySystemHealth(input.viewer.orgId),
  ]);

  if (visibility === "limited") {
    return {
      visibility,
      range,
      generatedAt: new Date().toISOString(),
      orgId: input.viewer.orgId,
      newLeadsCount,
      missedCallsRecoveredCount: null,
      avgResponseTimeMinutes: null,
      bookingRatePct: null,
      jobsThisWeekCount,
      openSlotsNext7Days: workload.openSlotsNext7Days,
      utilizationPct: workload.utilizationPct,
      systemHealth,
      links: {
        revenue: "/app/invoices",
        leads: "/app/inbox",
        workload: "/app/calendar",
        ads: "/app/analytics/ads",
      },
    };
  }

  const invoiceScope = buildInvoiceScope(input.viewer);
  const [
    outstandingInvoicesCount,
    outstandingInvoicesTotal,
    averageInvoiceValue,
    grossRevenueThisMonthCents,
    grossRevenueLastMonthCents,
    collectedRevenueThisMonthCents,
    collectedRevenueLastMonthCents,
    revenueThisMonthByChannel,
    revenueLastMonthByChannel,
    avgResponseTimeMinutes,
    missedCallsRecoveredCount,
  ] = await Promise.all([
    prisma.invoice.count({
      where: {
        orgId: input.viewer.orgId,
        status: { in: [...OPEN_INVOICE_STATUSES] },
        ...(invoiceScope || {}),
      },
    }),
    prisma.invoice.aggregate({
      where: {
        orgId: input.viewer.orgId,
        status: { in: [...OPEN_INVOICE_STATUSES] },
        ...(invoiceScope || {}),
      },
      _sum: {
        balanceDue: true,
      },
    }),
    prisma.invoice.aggregate({
      where: {
        orgId: input.viewer.orgId,
        issueDate: { gte: currentMonthStart, lt: nextMonthStart },
        status: { not: "DRAFT" },
        ...(invoiceScope || {}),
      },
      _avg: {
        total: true,
      },
    }),
    getGrossRevenueForRange({
      orgId: input.viewer.orgId,
      start: currentMonthStart,
      endExclusive: nextMonthStart,
    }),
    getGrossRevenueForRange({
      orgId: input.viewer.orgId,
      start: lastMonthStart,
      endExclusive: currentMonthStart,
    }),
    getCollectedRevenueForRange({
      orgId: input.viewer.orgId,
      start: currentMonthStart,
      endExclusive: nextMonthStart,
    }),
    getCollectedRevenueForRange({
      orgId: input.viewer.orgId,
      start: lastMonthStart,
      endExclusive: currentMonthStart,
    }),
    getRevenueByChannelForRange({
      orgId: input.viewer.orgId,
      start: currentMonthStart,
      endExclusive: nextMonthStart,
    }),
    getRevenueByChannelForRange({
      orgId: input.viewer.orgId,
      start: lastMonthStart,
      endExclusive: currentMonthStart,
    }),
    getAverageFirstResponseMinutes({
      orgId: input.viewer.orgId,
      start: rangeWindow.start,
      endExclusive: rangeWindow.endExclusive,
    }),
    getRecoveredMissedCallsCount({
      orgId: input.viewer.orgId,
      start: rangeWindow.start,
      endExclusive: rangeWindow.endExclusive,
    }),
  ]);

  const revenueThisMonthCents = grossRevenueThisMonthCents;
  const revenueLastMonthCents = grossRevenueLastMonthCents;
  const collectedRevenueThisMonthByChannel = sumChannelAccumulator(revenueThisMonthByChannel);
  const collectedRevenueLastMonthByChannel = sumChannelAccumulator(revenueLastMonthByChannel);

  return {
    visibility,
    range,
    generatedAt: new Date().toISOString(),
    orgId: input.viewer.orgId,
    grossRevenueThisMonthCents,
    collectedRevenueThisMonthCents: collectedRevenueThisMonthCents ?? (collectedRevenueThisMonthByChannel > 0 ? collectedRevenueThisMonthByChannel : null),
    revenueLastMonthGrossCents: grossRevenueLastMonthCents,
    revenueLastMonthCollectedCents:
      collectedRevenueLastMonthCents ?? (collectedRevenueLastMonthByChannel > 0 ? collectedRevenueLastMonthByChannel : null),
    revenueThisMonthCents,
    revenueLastMonthCents,
    avgJobValueCents: averageInvoiceValue._avg.total ? decimalToCents(averageInvoiceValue._avg.total) : null,
    outstandingInvoicesCount,
    outstandingInvoicesTotalCents: outstandingInvoicesTotal._sum.balanceDue
      ? decimalToCents(outstandingInvoicesTotal._sum.balanceDue)
      : 0,
    newLeadsCount,
    missedCallsRecoveredCount,
    avgResponseTimeMinutes,
    bookingRatePct: pct(bookedLeadCount, newLeadsCount),
    jobsThisWeekCount,
    openSlotsNext7Days: workload.openSlotsNext7Days,
    utilizationPct: workload.utilizationPct,
    systemHealth,
    links: {
      revenue: "/app/invoices",
      leads: "/app/inbox",
      workload: "/app/calendar",
      ads: "/app/analytics/ads",
    },
  };
}

export async function getPortalAdsMetrics(input: {
  viewer: AnalyticsViewer;
  month?: string | null;
}): Promise<PortalAdsMetrics> {
  const monthStart = parseMonthStart(input.month);
  const nextMonthStart = addMonths(monthStart, 1);
  const monthKey = formatMonthKey(monthStart);
  const financialAccess = canViewFinancialAnalytics(input.viewer);
  if (!financialAccess) {
    throw new Error("FORBIDDEN_FINANCIAL_ANALYTICS");
  }

  const [spendRows, leadCounts, bookedCounts, revenueByChannel, leadRows, paymentRows] = await Promise.all([
    prisma.marketingSpend.findMany({
      where: {
        orgId: input.viewer.orgId,
        monthStart,
      },
      orderBy: [{ channel: "asc" }],
    }),
    prisma.lead.groupBy({
      by: ["sourceChannel"],
      where: {
        orgId: input.viewer.orgId,
        createdAt: {
          gte: monthStart,
          lt: nextMonthStart,
        },
      },
      _count: {
        _all: true,
      },
    }),
    prisma.lead.groupBy({
      by: ["sourceChannel"],
      where: {
        orgId: input.viewer.orgId,
        status: "BOOKED",
        updatedAt: {
          gte: monthStart,
          lt: nextMonthStart,
        },
      },
      _count: {
        _all: true,
      },
    }),
    getRevenueByChannelForRange({
      orgId: input.viewer.orgId,
      start: monthStart,
      endExclusive: nextMonthStart,
    }),
    prisma.lead.findMany({
      where: {
        orgId: input.viewer.orgId,
        createdAt: {
          gte: monthStart,
          lt: nextMonthStart,
        },
      },
      select: {
        createdAt: true,
        sourceChannel: true,
      },
    }),
    prisma.invoicePayment.findMany({
      where: {
        invoice: {
          orgId: input.viewer.orgId,
        },
        date: {
          gte: monthStart,
          lt: nextMonthStart,
        },
      },
      select: {
        date: true,
        amount: true,
        invoice: {
          select: {
            job: {
              select: {
                sourceChannel: true,
              },
            },
          },
        },
      },
    }),
  ]);

  const spendByChannel: Partial<Record<AnalyticsChannel, number>> = {};
  for (const row of spendRows) {
    spendByChannel[toAnalyticsChannel(row.channel)] = row.spendCents;
  }

  const leadCountByChannel = buildChannelAccumulator();
  for (const row of leadCounts) {
    leadCountByChannel[toAnalyticsChannel(row.sourceChannel)] = row._count._all;
  }

  const bookedCountByChannel = buildChannelAccumulator();
  for (const row of bookedCounts) {
    bookedCountByChannel[toAnalyticsChannel(row.sourceChannel)] = row._count._all;
  }

  const weekly = new Map<AnalyticsChannel, Map<string, { weekStart: string; label: string; leads: number; revenueCents: number }>>();
  for (const row of leadRows) {
    const weekStart = startOfWeek(new Date(row.createdAt), { weekStartsOn: 1 });
    addWeeklyValue(weekly, toAnalyticsChannel(row.sourceChannel), weekStart, "leads", 1);
  }
  for (const row of paymentRows) {
    const weekStart = startOfWeek(new Date(row.date), { weekStartsOn: 1 });
    addWeeklyValue(weekly, toAnalyticsChannel(row.invoice.job?.sourceChannel), weekStart, "revenueCents", decimalToCents(row.amount));
  }

  const channels: ChannelMetrics[] = DISPLAY_CHANNELS.map((channel) => {
    const spendCents = spendByChannel[channel.key] || 0;
    const leads = leadCountByChannel[channel.key] || 0;
    const bookedJobs = bookedCountByChannel[channel.key] || 0;
    const revenueCents = revenueByChannel[channel.key] || 0;
    const cplCents = leads > 0 ? Math.round(spendCents / leads) : null;
    const weeklyRows = [...(weekly.get(channel.key)?.values() || [])].sort((a, b) =>
      a.weekStart.localeCompare(b.weekStart),
    );

    return {
      key: channel.key,
      label: channel.label,
      spendCents,
      leads,
      cplCents,
      bookedJobs,
      revenueCents,
      roas: ratio(revenueCents, spendCents),
      weekly: weeklyRows,
      editable: channel.editable,
    };
  });

  const totals = channels.reduce(
    (acc, channel) => {
      acc.spendCents += channel.spendCents;
      acc.leads += channel.leads;
      acc.bookedJobs += channel.bookedJobs;
      acc.revenueCents += channel.revenueCents;
      return acc;
    },
    {
      spendCents: 0,
      leads: 0,
      bookedJobs: 0,
      revenueCents: 0,
    },
  );

  return {
    visibility: "full",
    generatedAt: new Date().toISOString(),
    orgId: input.viewer.orgId,
    month: monthKey,
    monthLabel: formatMonthLabel(monthStart),
    totals: {
      ...totals,
      cplCents: totals.leads > 0 ? Math.round(totals.spendCents / totals.leads) : null,
      roas: ratio(totals.revenueCents, totals.spendCents),
    },
    channels,
  };
}

export async function listMarketingSpend(input: {
  orgId: string;
  month?: string | null;
}): Promise<MarketingSpendRecord[]> {
  const monthStart = parseMonthStart(input.month);
  const rows = await prisma.marketingSpend.findMany({
    where: {
      orgId: input.orgId,
      monthStart,
    },
    orderBy: [{ channel: "asc" }],
  });

  return rows.map((row) => ({
    id: row.id,
    month: formatMonthKey(row.monthStart),
    channel: row.channel,
    spendCents: row.spendCents,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}
