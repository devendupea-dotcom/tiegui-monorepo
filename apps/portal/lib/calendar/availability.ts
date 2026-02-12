import { addMinutes } from "date-fns";
import { prisma } from "@/lib/prisma";
import {
  clampSlotMinutes,
  DEFAULT_CALENDAR_TIMEZONE,
  DEFAULT_SLOT_MINUTES,
  ensureTimeZone,
  getLocalMinutesInDay,
  getUtcRangeForDate,
  localDateFromUtc,
  minutesToHHmm,
  toUtcFromLocalDateTime,
} from "./dates";

export type OrgCalendarSettings = {
  allowOverlaps: boolean;
  defaultSlotMinutes: number;
  defaultUntimedStartHour: number;
  calendarTimezone: string;
  weekStartsOn: 0 | 1;
};

type WorkerBlockedInterval = {
  workerUserId: string;
  startMinute: number;
  endMinute: number;
  source: "EVENT" | "HOLD" | "TIME_OFF";
  sourceId: string;
};

function minutesForDateRange(input: {
  startAt: Date;
  endAt: Date;
  dayStartUtc: Date;
  dayEndUtc: Date;
  timeZone: string;
}): { startMinute: number; endMinute: number } | null {
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

  return { startMinute, endMinute };
}

function mergeIntervals(intervals: Array<{ startMinute: number; endMinute: number }>) {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.startMinute - b.startMinute);
  const merged: Array<{ startMinute: number; endMinute: number }> = [];

  for (const current of sorted) {
    if (merged.length === 0) {
      merged.push({ ...current });
      continue;
    }

    const last = merged[merged.length - 1]!;
    if (current.startMinute <= last.endMinute) {
      last.endMinute = Math.max(last.endMinute, current.endMinute);
      continue;
    }

    merged.push({ ...current });
  }

  return merged;
}

function hasOverlap(input: {
  startMinute: number;
  endMinute: number;
  blocked: Array<{ startMinute: number; endMinute: number }>;
}) {
  return input.blocked.some(
    (interval) => interval.startMinute < input.endMinute && input.startMinute < interval.endMinute,
  );
}

function getDayOfWeekForDate(date: string): number {
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getDay();
}

export async function getOrgCalendarSettings(orgId: string): Promise<OrgCalendarSettings> {
  const config = await prisma.orgDashboardConfig.findUnique({
    where: { orgId },
    select: {
      allowOverlaps: true,
      defaultSlotMinutes: true,
      defaultUntimedStartHour: true,
      calendarTimezone: true,
      weekStartsOn: true,
    },
  });

  if (!config) {
    return {
      allowOverlaps: false,
      defaultSlotMinutes: DEFAULT_SLOT_MINUTES,
      defaultUntimedStartHour: 9,
      calendarTimezone: DEFAULT_CALENDAR_TIMEZONE,
      weekStartsOn: 0,
    };
  }

  return {
    allowOverlaps: config.allowOverlaps,
    defaultSlotMinutes: clampSlotMinutes(config.defaultSlotMinutes),
    defaultUntimedStartHour: Math.max(0, Math.min(23, config.defaultUntimedStartHour)),
    calendarTimezone: ensureTimeZone(config.calendarTimezone),
    weekStartsOn: config.weekStartsOn === 1 ? 1 : 0,
  };
}

export async function getWorkerCalendarTimeZone(input: {
  workerUserId: string;
  fallbackTimeZone: string;
}): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: input.workerUserId },
    select: { timezone: true },
  });

  return ensureTimeZone(user?.timezone || input.fallbackTimeZone);
}

async function getWorkingWindow(input: {
  orgId: string;
  workerUserId: string;
  date: string;
  settings: OrgCalendarSettings;
}) {
  const dayOfWeek = getDayOfWeekForDate(input.date);
  const row = await prisma.workingHours.findUnique({
    where: {
      orgId_workerUserId_dayOfWeek: {
        orgId: input.orgId,
        workerUserId: input.workerUserId,
        dayOfWeek,
      },
    },
    select: {
      startMinute: true,
      endMinute: true,
      isWorking: true,
    },
  });

  if (!row) {
    const start = input.settings.defaultUntimedStartHour * 60;
    const end = Math.min(24 * 60, start + 8 * 60);
    return {
      startMinute: start,
      endMinute: end,
      isWorking: true,
    };
  }

  return {
    startMinute: Math.max(0, Math.min(24 * 60, row.startMinute)),
    endMinute: Math.max(0, Math.min(24 * 60, row.endMinute)),
    isWorking: row.isWorking,
  };
}

export async function findWorkerBlockedIntervals(input: {
  orgId: string;
  workerUserId: string;
  date: string;
  timeZone: string;
  includeEvents: boolean;
  includeHolds: boolean;
  includeTimeOff: boolean;
  excludeEventId?: string | null;
  excludeHoldId?: string | null;
}): Promise<WorkerBlockedInterval[]> {
  const { startUtc: dayStartUtc, endUtc: dayEndUtc } = getUtcRangeForDate({
    date: input.date,
    timeZone: input.timeZone,
  });

  const [events, holds, timeOff] = await Promise.all([
    input.includeEvents
      ? prisma.event.findMany({
          where: {
            orgId: input.orgId,
            busy: true,
            status: { not: "CANCELLED" },
            AND: [
              { startAt: { lt: dayEndUtc } },
              { OR: [{ endAt: null }, { endAt: { gt: dayStartUtc } }] },
              {
                OR: [
                  { assignedToUserId: input.workerUserId },
                  { workerAssignments: { some: { workerUserId: input.workerUserId } } },
                ],
              },
              input.excludeEventId ? { NOT: { id: input.excludeEventId } } : {},
            ],
          },
          select: {
            id: true,
            startAt: true,
            endAt: true,
          },
        })
      : Promise.resolve([]),
    input.includeHolds
      ? prisma.calendarHold.findMany({
          where: {
            orgId: input.orgId,
            workerUserId: input.workerUserId,
            status: "ACTIVE",
            expiresAt: { gt: new Date() },
            startAt: { lt: dayEndUtc },
            endAt: { gt: dayStartUtc },
            ...(input.excludeHoldId ? { NOT: { id: input.excludeHoldId } } : {}),
          },
          select: {
            id: true,
            startAt: true,
            endAt: true,
          },
        })
      : Promise.resolve([]),
    input.includeTimeOff
      ? prisma.timeOff.findMany({
          where: {
            orgId: input.orgId,
            workerUserId: input.workerUserId,
            startAt: { lt: dayEndUtc },
            endAt: { gt: dayStartUtc },
          },
          select: {
            id: true,
            startAt: true,
            endAt: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const blocked: WorkerBlockedInterval[] = [];

  for (const event of events) {
    const endAt = event.endAt || addMinutes(event.startAt, DEFAULT_SLOT_MINUTES);
    const minutes = minutesForDateRange({
      startAt: event.startAt,
      endAt,
      dayStartUtc,
      dayEndUtc,
      timeZone: input.timeZone,
    });
    if (!minutes) continue;
    blocked.push({
      workerUserId: input.workerUserId,
      startMinute: minutes.startMinute,
      endMinute: minutes.endMinute,
      source: "EVENT",
      sourceId: event.id,
    });
  }

  for (const hold of holds) {
    const minutes = minutesForDateRange({
      startAt: hold.startAt,
      endAt: hold.endAt,
      dayStartUtc,
      dayEndUtc,
      timeZone: input.timeZone,
    });
    if (!minutes) continue;
    blocked.push({
      workerUserId: input.workerUserId,
      startMinute: minutes.startMinute,
      endMinute: minutes.endMinute,
      source: "HOLD",
      sourceId: hold.id,
    });
  }

  for (const entry of timeOff) {
    const minutes = minutesForDateRange({
      startAt: entry.startAt,
      endAt: entry.endAt,
      dayStartUtc,
      dayEndUtc,
      timeZone: input.timeZone,
    });
    if (!minutes) continue;
    blocked.push({
      workerUserId: input.workerUserId,
      startMinute: minutes.startMinute,
      endMinute: minutes.endMinute,
      source: "TIME_OFF",
      sourceId: entry.id,
    });
  }

  return blocked;
}

export async function computeAvailabilityForWorker(input: {
  orgId: string;
  workerUserId: string;
  date: string;
  durationMinutes: number;
  stepMinutes?: number;
  settings?: OrgCalendarSettings;
  ignoreEventConflicts?: boolean;
}): Promise<{ slotsUtc: string[]; timeZone: string }> {
  const settings = input.settings || (await getOrgCalendarSettings(input.orgId));
  const timeZone = await getWorkerCalendarTimeZone({
    workerUserId: input.workerUserId,
    fallbackTimeZone: settings.calendarTimezone,
  });
  const durationMinutes = Math.max(15, Math.min(12 * 60, input.durationMinutes || DEFAULT_SLOT_MINUTES));
  const stepMinutes = clampSlotMinutes(input.stepMinutes || settings.defaultSlotMinutes);

  const window = await getWorkingWindow({
    orgId: input.orgId,
    workerUserId: input.workerUserId,
    date: input.date,
    settings,
  });

  if (!window.isWorking || window.endMinute <= window.startMinute) {
    return {
      slotsUtc: [],
      timeZone,
    };
  }

  const blockedRaw = await findWorkerBlockedIntervals({
    orgId: input.orgId,
    workerUserId: input.workerUserId,
    date: input.date,
    timeZone,
    includeEvents: !settings.allowOverlaps && !input.ignoreEventConflicts,
    includeHolds: true,
    includeTimeOff: true,
  });

  const mergedBlocked = mergeIntervals(
    blockedRaw.map((item) => ({
      startMinute: item.startMinute,
      endMinute: item.endMinute,
    })),
  );

  const slotsUtc: string[] = [];
  for (
    let startMinute = window.startMinute;
    startMinute + durationMinutes <= window.endMinute;
    startMinute += stepMinutes
  ) {
    const endMinute = startMinute + durationMinutes;
    if (hasOverlap({ startMinute, endMinute, blocked: mergedBlocked })) {
      continue;
    }

    const candidateUtc = toUtcFromLocalDateTime({
      date: input.date,
      time: minutesToHHmm(startMinute),
      timeZone,
    });
    slotsUtc.push(candidateUtc.toISOString());
  }

  return {
    slotsUtc,
    timeZone,
  };
}

export async function detectWorkerConflicts(input: {
  orgId: string;
  workerUserIds: string[];
  startAtUtc: Date;
  endAtUtc: Date;
  excludeEventId?: string | null;
  excludeHoldId?: string | null;
  includeEvents: boolean;
}): Promise<Array<{ workerUserId: string; source: "EVENT" | "HOLD" | "TIME_OFF"; sourceId: string }>> {
  const settings = await getOrgCalendarSettings(input.orgId);
  const startDate = new Date(input.startAtUtc);
  const endDate = new Date(input.endAtUtc);
  const seen = new Set<string>();
  const results: Array<{ workerUserId: string; source: "EVENT" | "HOLD" | "TIME_OFF"; sourceId: string }> = [];

  for (const workerUserId of input.workerUserIds) {
    const workerTimeZone = await getWorkerCalendarTimeZone({
      workerUserId,
      fallbackTimeZone: settings.calendarTimezone,
    });
    const startDateKey = localDateFromUtc(startDate, workerTimeZone);
    const endDateKey = localDateFromUtc(endDate, workerTimeZone);
    const dateKeys = startDateKey === endDateKey ? [startDateKey] : [startDateKey, endDateKey];

    for (const dateKey of dateKeys) {
      const blocked = await findWorkerBlockedIntervals({
        orgId: input.orgId,
        workerUserId,
        date: dateKey,
        timeZone: workerTimeZone,
        includeEvents: input.includeEvents && !settings.allowOverlaps,
        includeHolds: true,
        includeTimeOff: true,
        excludeEventId: input.excludeEventId || null,
        excludeHoldId: input.excludeHoldId || null,
      });

      const range = getUtcRangeForDate({ date: dateKey, timeZone: workerTimeZone });
      const boundedStart = startDate < range.startUtc ? range.startUtc : startDate;
      const boundedEnd = endDate > range.endUtc ? range.endUtc : endDate;
      if (boundedEnd <= boundedStart) {
        continue;
      }

      const startMinute = getLocalMinutesInDay(boundedStart, workerTimeZone);
      const endMinute =
        boundedEnd >= range.endUtc
          ? 24 * 60
          : Math.max(startMinute + 1, getLocalMinutesInDay(boundedEnd, workerTimeZone));
      for (const item of blocked) {
        const isOverlap = item.startMinute < endMinute && startMinute < item.endMinute;
        if (!isOverlap) continue;
        const key = `${workerUserId}:${item.source}:${item.sourceId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({
          workerUserId,
          source: item.source,
          sourceId: item.sourceId,
        });
      }
    }
  }

  return results;
}
