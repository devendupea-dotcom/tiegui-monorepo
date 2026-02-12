import { NextResponse } from "next/server";
import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "@/lib/prisma";
import { computeAvailabilityForWorker, getOrgCalendarSettings } from "@/lib/calendar/availability";
import { requireCalendarActor, CalendarApiError } from "@/lib/calendar/permissions";

export const dynamic = "force-dynamic";

type RoundRobinTestPayload = {
  orgId?: string;
  workerIds?: string[];
  iterations?: number;
  durationMinutes?: number;
  lookaheadDays?: number;
  date?: string;
};

function parseIntSafe(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeWorkerIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of input) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    ids.push(trimmed);
  }
  return ids;
}

function addDaysKey(dateKey: string, offset: number): string {
  const [yearRaw, monthRaw, dayRaw] = dateKey.split("-");
  const year = Number.parseInt(yearRaw || "", 10);
  const month = Number.parseInt(monthRaw || "", 10);
  const day = Number.parseInt(dayRaw || "", 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return dateKey;
  }
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function rotate<T>(items: T[], startIndex: number): T[] {
  if (items.length === 0) return [];
  const normalized = ((startIndex % items.length) + items.length) % items.length;
  return [...items.slice(normalized), ...items.slice(0, normalized)];
}

export async function POST(req: Request) {
  try {
    const actor = await requireCalendarActor();
    if (!actor.internalUser) {
      throw new CalendarApiError("Internal access required.", 403);
    }

    const body = (await req.json().catch(() => null)) as RoundRobinTestPayload | null;
    if (!body) {
      throw new CalendarApiError("Invalid JSON payload.", 400);
    }

    const orgId = (body.orgId || "").trim();
    if (!orgId) {
      throw new CalendarApiError("orgId is required.", 400);
    }

    const settings = await getOrgCalendarSettings(orgId);
    const iterations = parseIntSafe(body.iterations, 6, 1, 30);
    const durationMinutes = parseIntSafe(body.durationMinutes, settings.defaultSlotMinutes, 15, 180);
    const lookaheadDays = parseIntSafe(body.lookaheadDays, 7, 1, 21);
    const defaultDate = formatInTimeZone(new Date(), settings.calendarTimezone, "yyyy-MM-dd");
    const startDateKey = (typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : defaultDate);
    const explicitWorkerIds = normalizeWorkerIds(body.workerIds);

    const workers = await prisma.user.findMany({
      where: {
        orgId,
        calendarAccessRole: { not: "READ_ONLY" },
        ...(explicitWorkerIds.length > 0 ? { id: { in: explicitWorkerIds } } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        calendarAccessRole: true,
      },
      orderBy: [{ name: "asc" }, { email: "asc" }, { id: "asc" }],
      take: 50,
    });

    let orderedWorkers = workers;
    if (explicitWorkerIds.length > 0) {
      const order = new Map(explicitWorkerIds.map((id, index) => [id, index]));
      orderedWorkers = [...workers].sort((a, b) => {
        const aIndex = order.get(a.id) ?? Number.MAX_SAFE_INTEGER;
        const bIndex = order.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        if (aIndex !== bIndex) return aIndex - bIndex;
        return a.id.localeCompare(b.id);
      });
    }

    if (orderedWorkers.length === 0) {
      throw new CalendarApiError("No eligible workers found for this org.", 400);
    }

    const dateKeys = Array.from({ length: lookaheadDays }, (_, index) => addDaysKey(startDateKey, index));
    const nowMs = Date.now();
    const availabilityByWorker = new Map<string, { available: boolean; firstSlot: string | null }>();

    async function evaluateWorker(workerId: string) {
      const cached = availabilityByWorker.get(workerId);
      if (cached) return cached;

      let firstSlot: string | null = null;
      for (const dateKey of dateKeys) {
        const availability = await computeAvailabilityForWorker({
          orgId,
          workerUserId: workerId,
          date: dateKey,
          durationMinutes,
          stepMinutes: 30,
          settings,
        });
        firstSlot =
          availability.slotsUtc.find((slot) => {
            const ms = new Date(slot).getTime();
            return Number.isFinite(ms) && ms >= nowMs;
          }) || firstSlot;
        if (firstSlot) break;
      }

      const result = { available: Boolean(firstSlot), firstSlot };
      availabilityByWorker.set(workerId, result);
      return result;
    }

    const eligibleWorkers: typeof orderedWorkers = [];
    for (const worker of orderedWorkers) {
      const status = await evaluateWorker(worker.id);
      if (status.available) {
        eligibleWorkers.push(worker);
      }
    }

    const state = await prisma.orgDashboardConfig.findUnique({
      where: { orgId },
      select: { roundRobinLastWorkerId: true },
    });
    let lastAssignedWorkerId = state?.roundRobinLastWorkerId || null;

    const assignments: Array<{ turn: number; workerId: string; workerName: string; slot: string | null }> = [];
    for (let turn = 1; turn <= iterations; turn += 1) {
      if (eligibleWorkers.length === 0) break;
      const startIndex = lastAssignedWorkerId
        ? eligibleWorkers.findIndex((worker) => worker.id === lastAssignedWorkerId) + 1
        : 0;
      const orderedCandidates = rotate(eligibleWorkers, startIndex);
      const selected = orderedCandidates[0];
      if (!selected) break;
      const availability = await evaluateWorker(selected.id);
      assignments.push({
        turn,
        workerId: selected.id,
        workerName: selected.name || selected.email,
        slot: availability.firstSlot,
      });
      lastAssignedWorkerId = selected.id;
    }

    const expected: string[] = [];
    if (eligibleWorkers.length > 0) {
      let cursor = state?.roundRobinLastWorkerId || null;
      for (let i = 0; i < iterations; i += 1) {
        const startIndex = cursor ? eligibleWorkers.findIndex((worker) => worker.id === cursor) + 1 : 0;
        const next = rotate(eligibleWorkers, startIndex)[0];
        if (!next) break;
        expected.push(next.id);
        cursor = next.id;
      }
    }
    const actual = assignments.map((item) => item.workerId);
    const pass = expected.length === actual.length && expected.every((id, index) => id === actual[index]);

    return NextResponse.json({
      ok: true,
      pass,
      orgId,
      startDate: startDateKey,
      iterations,
      durationMinutes,
      lookaheadDays,
      roundRobinLastWorkerId: state?.roundRobinLastWorkerId || null,
      eligibleWorkers: eligibleWorkers.map((worker) => ({
        id: worker.id,
        name: worker.name || worker.email,
        role: worker.calendarAccessRole,
      })),
      skippedUnavailableWorkers: orderedWorkers
        .filter((worker) => !eligibleWorkers.some((eligible) => eligible.id === worker.id))
        .map((worker) => ({
          id: worker.id,
          name: worker.name || worker.email,
        })),
      assignments,
      expectedSequenceWorkerIds: expected,
      actualSequenceWorkerIds: actual,
      summary:
        assignments.length === 0
          ? "No available workers found in lookahead window."
          : assignments.map((item) => item.workerName).join(" -> "),
    });
  } catch (error) {
    if (error instanceof CalendarApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to run round-robin diagnostic.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
