import { addMinutes } from "date-fns";
import { NextResponse } from "next/server";
import type { CalendarEventStatus } from "@prisma/client";
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
  canEditAnyEventInOrg,
  requireCalendarActor,
} from "@/lib/calendar/permissions";
import { localDateFromUtc, parseUtcDateTime } from "@/lib/calendar/dates";
import { enqueueGoogleSyncJob } from "@/lib/integrations/google-sync";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: { eventId: string };
};

type UpdateEventPayload = {
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

function parseDate(value: string | null | undefined): Date | null {
  return parseUtcDateTime(value);
}

function parseWorkerIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    ids.add(trimmed);
  }
  return [...ids];
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
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toUpperCase();
  return allowed.includes(normalized as CalendarEventStatus) ? (normalized as CalendarEventStatus) : undefined;
}

async function getEventOrThrow(eventId: string) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: calendarEventSelect,
  });

  if (!event) {
    throw new CalendarApiError("Event not found.", 404);
  }

  return event;
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

function assertCanEditSpecificEvent(input: {
  actor: Awaited<ReturnType<typeof requireCalendarActor>>;
  currentWorkerIds: string[];
}) {
  if (canEditAnyEventInOrg(input.actor)) {
    return;
  }

  if (input.actor.calendarAccessRole === "READ_ONLY") {
    throw new CalendarApiError("Read-only users cannot edit calendar data.", 403);
  }

  if (!input.currentWorkerIds.includes(input.actor.id)) {
    throw new CalendarApiError("Workers can only edit events assigned to themselves.", 403);
  }
}

async function buildConflictResponse(input: {
  orgId: string;
  workerUserIds: string[];
  startAt: Date;
  endAt: Date;
  excludeEventId: string;
  includeEvents: boolean;
}) {
  const settings = await getOrgCalendarSettings(input.orgId);
  const conflicts = await detectWorkerConflicts({
    orgId: input.orgId,
    workerUserIds: input.workerUserIds,
    startAtUtc: input.startAt,
    endAtUtc: input.endAt,
    includeEvents: input.includeEvents,
    excludeEventId: input.excludeEventId,
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
      error: "Scheduling conflict detected.",
      conflicts,
      suggestedSlots: suggestions?.slotsUtc.slice(0, 6) || [],
      timeZone: suggestionTimeZone,
    },
    { status: 409 },
  );
}

export async function GET(_req: Request, { params }: RouteContext) {
  try {
    const actor = await requireCalendarActor();
    const event = await getEventOrThrow(params.eventId);
    assertOrgReadAccess(actor, event.orgId);

    return NextResponse.json({
      ok: true,
      event: serializeCalendarEvent(event),
    });
  } catch (error) {
    if (error instanceof CalendarApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to load event.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: RouteContext) {
  try {
    const actor = await requireCalendarActor();
    const existing = await getEventOrThrow(params.eventId);
    assertOrgWriteAccess(actor, existing.orgId);
    if (existing.provider === "GOOGLE") {
      throw new CalendarApiError("Google-synced events are read-only in TieGui.", 403);
    }
    assertCanEditSpecificEvent({
      actor,
      currentWorkerIds: existing.workerAssignments.map((item) => item.workerUserId),
    });

    const body = (await req.json().catch(() => null)) as UpdateEventPayload | null;
    if (!body) {
      throw new CalendarApiError("Invalid JSON payload.", 400);
    }

    const requestedWorkers = parseWorkerIds(body.workerIds);
    const previousAssignedUserId = existing.assignedToUserId;
    const nextWorkerIds = await resolveEditableWorkerIds({
      orgId: existing.orgId,
      requestedWorkerIds:
        requestedWorkers.length > 0 ? requestedWorkers : existing.workerAssignments.map((item) => item.workerUserId),
    });
    const nextAssignedUserId = nextWorkerIds[0] || null;
    const reassigned =
      previousAssignedUserId && nextAssignedUserId && previousAssignedUserId !== nextAssignedUserId;

    assertWorkerEditAllowed({
      actor,
      workerUserIds: nextWorkerIds,
    });

    const nextStartAt = parseDate(body.startAt || null) || existing.startAt;
    const parsedEndAt = parseDate(body.endAt || null);
    let nextEndAt = parsedEndAt || existing.endAt || addMinutes(nextStartAt, 30);
    if (!parsedEndAt && body.durationMinutes && Number.isFinite(body.durationMinutes)) {
      nextEndAt = addMinutes(nextStartAt, Math.max(15, Math.min(12 * 60, Number(body.durationMinutes))));
    }
    if (nextEndAt <= nextStartAt) {
      throw new CalendarApiError("endAt must be after startAt.", 400);
    }

    const busy = body.busy ?? existing.busy;
    if (busy) {
      const conflictResponse = await buildConflictResponse({
        orgId: existing.orgId,
        workerUserIds: nextWorkerIds,
        startAt: nextStartAt,
        endAt: nextEndAt,
        excludeEventId: existing.id,
        includeEvents: true,
      });
      if (conflictResponse) {
        return conflictResponse;
      }
    }

    const updated = await prisma.event.update({
      where: { id: existing.id },
      data: {
        leadId: body.leadId !== undefined ? body.leadId : existing.leadId,
        type: body.type ? normalizeEventType(body.type) : existing.type,
        status: parseEventStatus(body.status) || existing.status,
        busy,
        allDay: body.allDay ?? existing.allDay,
        title: body.title?.trim() || existing.title,
        description: body.description !== undefined ? body.description?.trim() || null : existing.description,
        customerName: body.customerName !== undefined ? body.customerName?.trim() || null : existing.customerName,
        addressLine: body.addressLine !== undefined ? body.addressLine?.trim() || null : existing.addressLine,
        startAt: nextStartAt,
        endAt: nextEndAt,
        assignedToUserId: nextAssignedUserId,
        ...(reassigned
          ? {
              googleEventId: null,
              googleCalendarId: null,
            }
          : {}),
        syncStatus: "PENDING",
        lastSyncedAt: null,
        workerAssignments: {
          deleteMany: {},
          createMany: {
            data: nextWorkerIds.map((workerUserId) => ({
              orgId: existing.orgId,
              workerUserId,
            })),
          },
        },
      },
      select: calendarEventSelect,
    });

    if (reassigned && existing.googleEventId && existing.googleCalendarId) {
      void enqueueGoogleSyncJob({
        orgId: existing.orgId,
        userId: previousAssignedUserId,
        action: "DELETE_EVENT",
        payloadJson: {
          googleEventId: existing.googleEventId,
          googleCalendarId: existing.googleCalendarId,
        },
      });
    }

    if (nextAssignedUserId) {
      void enqueueGoogleSyncJob({
        orgId: existing.orgId,
        userId: nextAssignedUserId,
        eventId: updated.id,
        action: "UPSERT_EVENT",
      });
    }

    const settings = await getOrgCalendarSettings(existing.orgId);
    const workerIdsToRecompute = [...new Set([
      ...existing.workerAssignments.map((item) => item.workerUserId),
      ...nextWorkerIds,
    ])];
    const availabilityByWorker: Record<string, string[]> = {};
    for (const workerUserId of workerIdsToRecompute) {
      const workerTimeZone = await getWorkerCalendarTimeZone({
        workerUserId,
        fallbackTimeZone: settings.calendarTimezone,
      });
      const dateKey = localDateFromUtc(nextStartAt, workerTimeZone);
      const availability = await computeAvailabilityForWorker({
        orgId: existing.orgId,
        workerUserId,
        date: dateKey,
        durationMinutes: Math.max(15, Math.round((nextEndAt.getTime() - nextStartAt.getTime()) / 60000)),
        settings,
      });
      availabilityByWorker[workerUserId] = availability.slotsUtc;
    }

    return NextResponse.json({
      ok: true,
      event: serializeCalendarEvent(updated),
      availabilityByWorker,
      timeZone: settings.calendarTimezone,
    });
  } catch (error) {
    if (error instanceof CalendarApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to update event.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  try {
    const actor = await requireCalendarActor();
    const existing = await getEventOrThrow(params.eventId);
    assertOrgWriteAccess(actor, existing.orgId);
    if (existing.provider === "GOOGLE") {
      throw new CalendarApiError("Google-synced events are read-only in TieGui.", 403);
    }
    assertCanEditSpecificEvent({
      actor,
      currentWorkerIds: existing.workerAssignments.map((item) => item.workerUserId),
    });

    if (existing.assignedToUserId && existing.googleEventId && existing.googleCalendarId) {
      void enqueueGoogleSyncJob({
        orgId: existing.orgId,
        userId: existing.assignedToUserId,
        action: "DELETE_EVENT",
        payloadJson: {
          googleEventId: existing.googleEventId,
          googleCalendarId: existing.googleCalendarId,
        },
      });
    }

    await prisma.event.delete({
      where: { id: existing.id },
    });

    return NextResponse.json({
      ok: true,
      deletedId: existing.id,
    });
  } catch (error) {
    if (error instanceof CalendarApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to delete event.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
