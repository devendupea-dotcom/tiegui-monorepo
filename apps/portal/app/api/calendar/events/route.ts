import { addMinutes } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { NextResponse } from "next/server";
import type { CalendarEventStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  computeAvailabilityForWorker,
  detectWorkerConflicts,
  getWorkerCalendarTimeZone,
  getOrgCalendarSettings,
} from "@/lib/calendar/availability";
import { calendarEventSelect, normalizeEventType, serializeCalendarEvent } from "@/lib/calendar/events";
import {
  CalendarApiError,
  assertOrgReadAccess,
  assertOrgWriteAccess,
  assertWorkerEditAllowed,
  requireCalendarActor,
} from "@/lib/calendar/permissions";
import { clampWeekStartsOn, formatDateOnly, getVisibleRange, localDateFromUtc, parseUtcDateTime } from "@/lib/calendar/dates";
import { enqueueGoogleSyncJob } from "@/lib/integrations/google-sync";

export const dynamic = "force-dynamic";

type CreateEventPayload = {
  orgId?: string;
  leadId?: string | null;
  type?: string;
  status?: string;
  busy?: boolean;
  allDay?: boolean;
  title?: string;
  description?: string | null;
  customerName?: string | null;
  addressLine?: string | null;
  startAt?: string;
  endAt?: string | null;
  durationMinutes?: number | null;
  workerIds?: string[];
};

function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function parseDateTimeInput(value: string | null | undefined): Date | null {
  return parseUtcDateTime(value);
}

function parseWorkerIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const workers: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    workers.push(trimmed);
  }
  return workers;
}

function parseEventStatus(value: unknown) {
  const allowed: CalendarEventStatus[] = [
    "SCHEDULED",
    "CONFIRMED",
    "EN_ROUTE",
    "ON_SITE",
    "IN_PROGRESS",
    "COMPLETED",
    "CANCELLED",
    "NO_SHOW",
  ];
  if (typeof value !== "string") return "SCHEDULED";
  const normalized = value.trim().toUpperCase();
  return allowed.includes(normalized as CalendarEventStatus) ? (normalized as CalendarEventStatus) : "SCHEDULED";
}

async function resolveEditableWorkerIds(input: {
  orgId: string;
  requestedWorkerIds: string[];
}) {
  const users = await prisma.user.findMany({
    where: {
      id: { in: input.requestedWorkerIds },
      OR: [{ orgId: input.orgId }, { role: "INTERNAL" }],
    },
    select: { id: true },
  });
  const ids = users.map((item) => item.id);
  if (ids.length !== input.requestedWorkerIds.length) {
    throw new CalendarApiError("One or more workers are invalid for this organization.", 400);
  }
  return ids;
}

async function buildConflictResponse(input: {
  orgId: string;
  workerUserIds: string[];
  startAt: Date;
  endAt: Date;
  includeEvents: boolean;
  message: string;
  status?: number;
}) {
  const settings = await getOrgCalendarSettings(input.orgId);
  const conflicts = await detectWorkerConflicts({
    orgId: input.orgId,
    workerUserIds: input.workerUserIds,
    startAtUtc: input.startAt,
    endAtUtc: input.endAt,
    includeEvents: input.includeEvents,
  });

  if (conflicts.length === 0) {
    return null;
  }

  let suggestionTimeZone = settings.calendarTimezone;
  let suggestions: { slotsUtc: string[]; timeZone: string } | null = null;
  if (input.workerUserIds[0]) {
    suggestionTimeZone = await getWorkerCalendarTimeZone({
      workerUserId: input.workerUserIds[0],
      fallbackTimeZone: settings.calendarTimezone,
    });
    const date = localDateFromUtc(input.startAt, suggestionTimeZone);
    suggestions = await computeAvailabilityForWorker({
      orgId: input.orgId,
      workerUserId: input.workerUserIds[0],
      date,
      durationMinutes: Math.max(15, Math.round((input.endAt.getTime() - input.startAt.getTime()) / 60000)),
      settings,
    });
  }

  return NextResponse.json(
    {
      ok: false,
      error: input.message,
      conflicts,
      suggestedSlots: suggestions?.slotsUtc.slice(0, 6) || [],
      timeZone: suggestionTimeZone,
    },
    { status: input.status || 409 },
  );
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

    const settings = await getOrgCalendarSettings(orgId);
    const dateValue = url.searchParams.get("date")?.trim() || formatDateOnly(new Date());
    const date = parseDateOnly(`${dateValue}T00:00:00`);
    if (!date) {
      throw new CalendarApiError("Invalid date format.", 400);
    }

    const viewValue = (url.searchParams.get("view") || "week").trim().toLowerCase();
    const view = viewValue === "day" || viewValue === "month" ? viewValue : "week";
    const weekStartsOn = clampWeekStartsOn(settings.weekStartsOn);
    const { rangeStart, rangeEnd } = getVisibleRange({ view, date, weekStartsOn });

    const rangeStartUtc = fromZonedTime(`${formatDateOnly(rangeStart)}T00:00:00`, settings.calendarTimezone);
    const rangeEndUtc = fromZonedTime(`${formatDateOnly(rangeEnd)}T00:00:00`, settings.calendarTimezone);

    const workerIds = (url.searchParams.get("workerIds") || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    const where: Prisma.EventWhereInput = {
      orgId,
      startAt: { lt: rangeEndUtc },
      OR: [{ endAt: null }, { endAt: { gt: rangeStartUtc } }],
      ...(workerIds.length > 0
        ? {
            AND: [
              {
                OR: [
                  { assignedToUserId: { in: workerIds } },
                  { workerAssignments: { some: { workerUserId: { in: workerIds } } } },
                ],
              },
            ],
          }
        : {}),
    };

    const events = await prisma.event.findMany({
      where,
      select: calendarEventSelect,
      orderBy: [{ startAt: "asc" }, { createdAt: "asc" }],
    });

    return NextResponse.json({
      ok: true,
      orgId,
      view,
      date: dateValue,
      settings: {
        allowOverlaps: settings.allowOverlaps,
        weekStartsOn,
        defaultSlotMinutes: settings.defaultSlotMinutes,
        defaultUntimedStartHour: settings.defaultUntimedStartHour,
        calendarTimezone: settings.calendarTimezone,
      },
      events: events.map(serializeCalendarEvent),
    });
  } catch (error) {
    if (error instanceof CalendarApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to load events.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const actor = await requireCalendarActor();
    const body = (await req.json().catch(() => null)) as CreateEventPayload | null;
    if (!body) {
      throw new CalendarApiError("Invalid JSON payload.", 400);
    }

    const orgId = (body.orgId || "").trim() || actor.orgId;
    if (!orgId) {
      throw new CalendarApiError("orgId is required for internal users.", 400);
    }

    assertOrgWriteAccess(actor, orgId);

    const title = (body.title || "").trim();
    if (!title) {
      throw new CalendarApiError("Title is required.", 400);
    }

    const startAt = parseDateTimeInput(body.startAt || null);
    if (!startAt) {
      throw new CalendarApiError("startAt is required and must be an ISO datetime with timezone.", 400);
    }

    let endAt = parseDateTimeInput(body.endAt || null);
    if (!endAt) {
      const durationMinutes = Math.max(15, Math.min(12 * 60, Number(body.durationMinutes) || 30));
      endAt = addMinutes(startAt, durationMinutes);
    }

    if (endAt <= startAt) {
      throw new CalendarApiError("endAt must be after startAt.", 400);
    }

    const requestedWorkers = parseWorkerIds(body.workerIds);
    const fallbackWorkers = requestedWorkers.length > 0 ? requestedWorkers : [actor.id];
    const workerIds = await resolveEditableWorkerIds({
      orgId,
      requestedWorkerIds: fallbackWorkers,
    });

    assertWorkerEditAllowed({
      actor,
      workerUserIds: workerIds,
    });

    const settings = await getOrgCalendarSettings(orgId);
    const eventType = normalizeEventType(body.type);
    const status = parseEventStatus(body.status);
    const busy = body.busy !== false;

    if (busy) {
      const conflictResponse = await buildConflictResponse({
        orgId,
        workerUserIds: workerIds,
        startAt,
        endAt,
        includeEvents: true,
        message: "Scheduling conflict detected for one or more workers.",
      });
      if (conflictResponse) {
        return conflictResponse;
      }
    }

    const created = await prisma.event.create({
      data: {
        orgId,
        leadId: body.leadId || null,
        type: eventType,
        status,
        busy,
        allDay: body.allDay === true,
        title,
        description: body.description?.trim() || null,
        customerName: body.customerName?.trim() || null,
        addressLine: body.addressLine?.trim() || null,
        startAt,
        endAt,
        assignedToUserId: workerIds[0] || null,
        createdByUserId: actor.id,
        workerAssignments: {
          createMany: {
            data: workerIds.map((workerUserId) => ({
              orgId,
              workerUserId,
            })),
          },
        },
      },
      select: calendarEventSelect,
    });

    if (created.provider === "LOCAL" && created.assignedToUserId) {
      void enqueueGoogleSyncJob({
        orgId,
        userId: created.assignedToUserId,
        eventId: created.id,
        action: "UPSERT_EVENT",
      });
    }

    const availabilityByWorker: Record<string, string[]> = {};
    for (const workerUserId of workerIds) {
      const workerTimeZone = await getWorkerCalendarTimeZone({
        workerUserId,
        fallbackTimeZone: settings.calendarTimezone,
      });
      const dateKey = localDateFromUtc(startAt, workerTimeZone);
      const availability = await computeAvailabilityForWorker({
        orgId,
        workerUserId,
        date: dateKey,
        durationMinutes: Math.max(15, Math.round((endAt.getTime() - startAt.getTime()) / 60000)),
        settings,
      });
      availabilityByWorker[workerUserId] = availability.slotsUtc;
    }

    return NextResponse.json({
      ok: true,
      event: serializeCalendarEvent(created),
      availabilityByWorker,
      timeZone: settings.calendarTimezone,
    });
  } catch (error) {
    if (error instanceof CalendarApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to create event.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
