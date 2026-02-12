import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeAvailabilityForWorker } from "@/lib/calendar/availability";
import {
  CalendarApiError,
  assertOrgWriteAccess,
  canEditAnyEventInOrg,
  requireCalendarActor,
} from "@/lib/calendar/permissions";

export const dynamic = "force-dynamic";

type NextOpenRequest = {
  orgId?: string;
  date?: string;
  durationMinutes?: number;
  lookaheadDays?: number;
  preferredWorkerId?: string;
  fallbackStrategy?: "OWNER" | "ROUND_ROBIN";
  candidateWorkerIds?: string[];
};

type WorkerCandidate = {
  id: string;
  calendarAccessRole: "OWNER" | "ADMIN" | "WORKER" | "READ_ONLY";
  name: string | null;
  email: string;
};

function parsePositiveInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseDateKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

function addDaysToDateKey(dateKey: string, offset: number): string {
  const [yearRaw, monthRaw, dayRaw] = dateKey.split("-");
  const year = Number.parseInt(yearRaw || "", 10);
  const month = Number.parseInt(monthRaw || "", 10);
  const day = Number.parseInt(dayRaw || "", 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return dateKey;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function uniqueWorkerIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    ids.push(trimmed);
  }
  return ids;
}

function rotateFromIndex<T>(items: T[], startIndex: number): T[] {
  if (items.length === 0) return [];
  const normalized = ((startIndex % items.length) + items.length) % items.length;
  return [...items.slice(normalized), ...items.slice(0, normalized)];
}

async function findFirstOpenSlotForWorker(input: {
  orgId: string;
  workerUserId: string;
  dateKeys: string[];
  durationMinutes: number;
}) {
  const nowMs = Date.now();

  for (const dateKey of input.dateKeys) {
    const availability = await computeAvailabilityForWorker({
      orgId: input.orgId,
      workerUserId: input.workerUserId,
      date: dateKey,
      durationMinutes: input.durationMinutes,
      stepMinutes: 30,
    });

    const nextSlot =
      availability.slotsUtc.find((slot) => {
        const ms = new Date(slot).getTime();
        return Number.isFinite(ms) && ms >= nowMs;
      }) || null;

    if (nextSlot) {
      return nextSlot;
    }
  }

  return null;
}

export async function POST(req: Request) {
  try {
    const actor = await requireCalendarActor();
    const body = (await req.json().catch(() => null)) as NextOpenRequest | null;
    if (!body) {
      throw new CalendarApiError("Invalid JSON payload.", 400);
    }

    const orgId = (body.orgId || actor.orgId || "").trim();
    if (!orgId) {
      throw new CalendarApiError("orgId is required for internal users.", 400);
    }
    assertOrgWriteAccess(actor, orgId);

    const startDateKey = parseDateKey(body.date);
    if (!startDateKey) {
      throw new CalendarApiError("date is required in YYYY-MM-DD format.", 400);
    }

    const durationMinutes = parsePositiveInt(body.durationMinutes, 30, 15, 12 * 60);
    const lookaheadDays = parsePositiveInt(body.lookaheadDays, 7, 1, 21);
    const fallbackStrategy = body.fallbackStrategy === "OWNER" ? "OWNER" : "ROUND_ROBIN";
    const candidateWorkerIdsInput = uniqueWorkerIds(body.candidateWorkerIds);
    const requestedPreferredWorkerId = typeof body.preferredWorkerId === "string" ? body.preferredWorkerId.trim() : "";

    const whereOrgScope = actor.internalUser ? [{ orgId }, { role: "INTERNAL" as const }] : [{ orgId }];
    const workers = await prisma.user.findMany({
      where: {
        OR: whereOrgScope,
        ...(candidateWorkerIdsInput.length > 0 ? { id: { in: candidateWorkerIdsInput } } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        calendarAccessRole: true,
      },
      orderBy: [{ role: "asc" }, { name: "asc" }, { email: "asc" }, { id: "asc" }],
      take: 200,
    });

    let orderedWorkers: WorkerCandidate[] = workers.filter((worker) => worker.calendarAccessRole !== "READ_ONLY");
    if (candidateWorkerIdsInput.length > 0) {
      const indexById = new Map(candidateWorkerIdsInput.map((id, index) => [id, index]));
      orderedWorkers = [...orderedWorkers].sort((a, b) => {
        const aIndex = indexById.get(a.id) ?? Number.MAX_SAFE_INTEGER;
        const bIndex = indexById.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        if (aIndex !== bIndex) return aIndex - bIndex;
        return a.id.localeCompare(b.id);
      });
    }

    if (orderedWorkers.length === 0) {
      throw new CalendarApiError("No eligible workers available for this organization.", 400);
    }

    if (!actor.internalUser && !canEditAnyEventInOrg(actor)) {
      orderedWorkers = orderedWorkers.filter((worker) => worker.id === actor.id);
    }

    if (orderedWorkers.length === 0) {
      throw new CalendarApiError("You can only schedule for your own worker calendar.", 403);
    }

    const preferredWorkerId =
      orderedWorkers.find((worker) => worker.id === requestedPreferredWorkerId)?.id || orderedWorkers[0]?.id;

    if (!preferredWorkerId) {
      throw new CalendarApiError("No preferred worker available.", 400);
    }

    const dateKeys = Array.from({ length: lookaheadDays }, (_, index) => addDaysToDateKey(startDateKey, index));

    const preferredSlot = await findFirstOpenSlotForWorker({
      orgId,
      workerUserId: preferredWorkerId,
      dateKeys,
      durationMinutes,
    });

    if (preferredSlot) {
      return NextResponse.json({
        ok: true,
        strategyUsed: "PREFERRED",
        workerId: preferredWorkerId,
        slot: preferredSlot,
        durationMinutes,
      });
    }

    if (fallbackStrategy === "OWNER") {
      const ownerCandidates = orderedWorkers
        .filter((worker) => worker.id !== preferredWorkerId && worker.calendarAccessRole === "OWNER")
        .map((worker) => worker.id);

      for (const workerId of ownerCandidates) {
        const slot = await findFirstOpenSlotForWorker({
          orgId,
          workerUserId: workerId,
          dateKeys,
          durationMinutes,
        });
        if (!slot) continue;
        return NextResponse.json({
          ok: true,
          strategyUsed: "OWNER",
          workerId,
          slot,
          durationMinutes,
        });
      }

      return NextResponse.json(
        {
          ok: false,
          error: `No open slots found in the next ${lookaheadDays} day${lookaheadDays === 1 ? "" : "s"}.`,
        },
        { status: 404 },
      );
    }

    const rrCandidates = orderedWorkers.filter((worker) => worker.id !== preferredWorkerId).map((worker) => worker.id);
    if (rrCandidates.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "No round-robin fallback workers are available.",
        },
        { status: 404 },
      );
    }

    const state = await prisma.orgDashboardConfig.findUnique({
      where: { orgId },
      select: { roundRobinLastWorkerId: true },
    });
    const lastAssignedWorkerId = state?.roundRobinLastWorkerId || null;
    const startIndex = lastAssignedWorkerId ? rrCandidates.indexOf(lastAssignedWorkerId) + 1 : 0;
    const orderedRoundRobinCandidates = rotateFromIndex(rrCandidates, startIndex);

    for (const workerId of orderedRoundRobinCandidates) {
      const slot = await findFirstOpenSlotForWorker({
        orgId,
        workerUserId: workerId,
        dateKeys,
        durationMinutes,
      });
      if (!slot) continue;

      await prisma.orgDashboardConfig.upsert({
        where: { orgId },
        create: {
          orgId,
          roundRobinLastWorkerId: workerId,
        },
        update: {
          roundRobinLastWorkerId: workerId,
        },
      });

      return NextResponse.json({
        ok: true,
        strategyUsed: "ROUND_ROBIN",
        workerId,
        slot,
        durationMinutes,
      });
    }

    return NextResponse.json(
      {
        ok: false,
        error: `No open slots found in the next ${lookaheadDays} day${lookaheadDays === 1 ? "" : "s"}.`,
      },
      { status: 404 },
    );
  } catch (error) {
    if (error instanceof CalendarApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to resolve next open slot.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
