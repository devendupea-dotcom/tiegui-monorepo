import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeAvailabilityForWorker, getOrgCalendarSettings } from "@/lib/calendar/availability";
import {
  CalendarApiError,
  assertOrgReadAccess,
  requireCalendarActor,
} from "@/lib/calendar/permissions";

export const dynamic = "force-dynamic";

function parsePositiveInt(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export async function GET(req: Request) {
  try {
    const actor = await requireCalendarActor();
    const url = new URL(req.url);
    const workerUserId = url.searchParams.get("userId")?.trim() || url.searchParams.get("workerId")?.trim();
    const date = url.searchParams.get("date")?.trim();
    const orgIdFromQuery = url.searchParams.get("orgId")?.trim();
    const durationMinutes = parsePositiveInt(url.searchParams.get("duration"), 30);
    const stepMinutes = parsePositiveInt(url.searchParams.get("step"), 30);

    if (!workerUserId || !date) {
      throw new CalendarApiError("userId (or workerId) and date are required.", 400);
    }

    const orgId = orgIdFromQuery || actor.orgId;
    if (!orgId) {
      throw new CalendarApiError("orgId is required for internal users.", 400);
    }

    assertOrgReadAccess(actor, orgId);

    const worker = await prisma.user.findUnique({
      where: { id: workerUserId },
      select: {
        id: true,
        orgId: true,
        role: true,
      },
    });

    if (!worker) {
      throw new CalendarApiError("Worker not found.", 404);
    }

    if (worker.orgId && worker.orgId !== orgId) {
      throw new CalendarApiError("Worker is not part of this organization.", 400);
    }

    const settings = await getOrgCalendarSettings(orgId);
    const availability = await computeAvailabilityForWorker({
      orgId,
      workerUserId,
      date,
      durationMinutes,
      stepMinutes,
      settings,
    });

    return NextResponse.json({
      ok: true,
      orgId,
      workerId: workerUserId,
      userId: workerUserId,
      date,
      duration: durationMinutes,
      step: stepMinutes,
      timeZone: availability.timeZone,
      slots: availability.slotsUtc,
    });
  } catch (error) {
    if (error instanceof CalendarApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to compute availability.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
