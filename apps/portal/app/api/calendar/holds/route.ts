import { addMinutes } from "date-fns";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { detectWorkerConflicts, getOrgCalendarSettings } from "@/lib/calendar/availability";
import { CalendarApiError, assertOrgReadAccess, assertOrgWriteAccess, requireCalendarActor } from "@/lib/calendar/permissions";
import { getUtcRangeForDate, localDateFromUtc, parseUtcDateTime } from "@/lib/calendar/dates";

export const dynamic = "force-dynamic";

type HoldPayload = {
  orgId?: string;
  workerUserId?: string;
  leadId?: string | null;
  customerName?: string | null;
  title?: string | null;
  addressLine?: string | null;
  source?: string;
  startAt?: string;
  endAt?: string;
  expiresAt?: string | null;
  expiresInMinutes?: number | null;
};

function parseDate(value: string | null | undefined): Date | null {
  return parseUtcDateTime(value);
}

function parseHoldSource(value: unknown): "MANUAL" | "SMS_AGENT" | "GOOGLE_SYNC" {
  if (typeof value !== "string") return "MANUAL";
  const normalized = value.trim().toUpperCase();
  if (normalized === "SMS_AGENT" || normalized === "GOOGLE_SYNC") {
    return normalized;
  }
  return "MANUAL";
}

function serializeHold(hold: {
  id: string;
  orgId: string;
  workerUserId: string;
  leadId: string | null;
  customerName: string | null;
  title: string | null;
  addressLine: string | null;
  source: string;
  startAt: Date;
  endAt: Date;
  status: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: hold.id,
    orgId: hold.orgId,
    workerUserId: hold.workerUserId,
    leadId: hold.leadId,
    customerName: hold.customerName,
    title: hold.title,
    addressLine: hold.addressLine,
    source: hold.source,
    startAt: hold.startAt.toISOString(),
    endAt: hold.endAt.toISOString(),
    status: hold.status,
    expiresAt: hold.expiresAt.toISOString(),
    createdAt: hold.createdAt.toISOString(),
    updatedAt: hold.updatedAt.toISOString(),
  };
}

export async function GET(req: Request) {
  try {
    const actor = await requireCalendarActor();
    const url = new URL(req.url);
    const orgId = url.searchParams.get("orgId")?.trim() || actor.orgId;
    if (!orgId) {
      throw new CalendarApiError("orgId is required for internal users.", 400);
    }

    assertOrgReadAccess(actor, orgId);

    const workerUserId = url.searchParams.get("workerId")?.trim() || undefined;
    const date = url.searchParams.get("date")?.trim() || undefined;
    const status = url.searchParams.get("status")?.trim() || "ACTIVE";
    const settings = await getOrgCalendarSettings(orgId);

    const where: Record<string, unknown> = {
      orgId,
      status,
    };

    if (workerUserId) {
      where.workerUserId = workerUserId;
    }

    if (date) {
      const range = getUtcRangeForDate({
        date,
        timeZone: settings.calendarTimezone,
      });
      where.startAt = { lt: range.endUtc };
      where.endAt = { gt: range.startUtc };
    }

    const holds = await prisma.calendarHold.findMany({
      where,
      orderBy: [{ startAt: "asc" }, { createdAt: "asc" }],
    });

    return NextResponse.json({
      ok: true,
      holds: holds.map(serializeHold),
    });
  } catch (error) {
    if (error instanceof CalendarApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to fetch holds.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const actor = await requireCalendarActor();
    const body = (await req.json().catch(() => null)) as HoldPayload | null;
    if (!body) {
      throw new CalendarApiError("Invalid JSON payload.", 400);
    }

    const orgId = (body.orgId || "").trim() || actor.orgId;
    if (!orgId) {
      throw new CalendarApiError("orgId is required for internal users.", 400);
    }

    assertOrgWriteAccess(actor, orgId);

    const workerUserId = (body.workerUserId || "").trim();
    if (!workerUserId) {
      throw new CalendarApiError("workerUserId is required.", 400);
    }

    const worker = await prisma.user.findUnique({
      where: { id: workerUserId },
      select: { id: true, orgId: true, role: true },
    });
    if (!worker) {
      throw new CalendarApiError("Worker not found.", 404);
    }
    if (worker.orgId && worker.orgId !== orgId) {
      throw new CalendarApiError("Worker is not part of this organization.", 400);
    }

    if (!actor.internalUser && actor.calendarAccessRole === "WORKER" && actor.id !== workerUserId) {
      throw new CalendarApiError("Workers can only create holds for themselves.", 403);
    }

    const startAt = parseDate(body.startAt || null);
    const endAt = parseDate(body.endAt || null);
    if (!startAt || !endAt || endAt <= startAt) {
      throw new CalendarApiError("Valid startAt and endAt are required.", 400);
    }

    const settings = await getOrgCalendarSettings(orgId);
    const conflicts = await detectWorkerConflicts({
      orgId,
      workerUserIds: [workerUserId],
      startAtUtc: startAt,
      endAtUtc: endAt,
      includeEvents: true,
    });

    if (conflicts.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "Hold conflicts with existing schedule.",
          conflicts,
        },
        { status: 409 },
      );
    }

    const expiresAt =
      parseDate(body.expiresAt || null) ||
      addMinutes(new Date(), Math.max(1, Math.min(120, Number(body.expiresInMinutes) || 10)));

    const created = await prisma.calendarHold.create({
      data: {
        orgId,
        workerUserId,
        leadId: body.leadId || null,
        customerName: body.customerName?.trim() || null,
        title: body.title?.trim() || null,
        addressLine: body.addressLine?.trim() || null,
        source: parseHoldSource(body.source),
        startAt,
        endAt,
        expiresAt,
        createdByUserId: actor.id,
      },
    });

    return NextResponse.json({
      ok: true,
      hold: serializeHold(created),
      date: localDateFromUtc(startAt, settings.calendarTimezone),
      timeZone: settings.calendarTimezone,
    });
  } catch (error) {
    if (error instanceof CalendarApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to create hold.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
