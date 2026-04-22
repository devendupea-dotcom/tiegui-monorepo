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
  assertOrgWriteAccess,
  assertWorkerEditAllowed,
  requireCalendarActor,
} from "@/lib/calendar/permissions";
import { localDateFromUtc, parseUtcDateTime } from "@/lib/calendar/dates";
import { enqueueGoogleSyncJob } from "@/lib/integrations/google-sync";
import { syncLeadBookingState } from "@/lib/lead-booking";
import { resolveWorkspaceUserIds } from "@/lib/workspace-users";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: { holdId: string };
};

type ConfirmHoldPayload = {
  title?: string | null;
  description?: string | null;
  customerName?: string | null;
  addressLine?: string | null;
  leadId?: string | null;
  type?: string;
  status?: string;
  busy?: boolean;
  allDay?: boolean;
  workerIds?: string[];
  endAt?: string | null;
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
    "COMPLETED",
    "CANCELLED",
    "NO_SHOW",
  ];
  if (typeof value !== "string") return "CONFIRMED";
  const normalized = value.trim().toUpperCase();
  return allowed.includes(normalized as CalendarEventStatus) ? (normalized as CalendarEventStatus) : "CONFIRMED";
}

export async function POST(req: Request, { params }: RouteContext) {
  try {
    const actor = await requireCalendarActor();
    const hold = await prisma.calendarHold.findUnique({
      where: { id: params.holdId },
    });

    if (!hold) {
      throw new CalendarApiError("Hold not found.", 404);
    }

    assertOrgWriteAccess(actor, hold.orgId);

    if (hold.status !== "ACTIVE") {
      throw new CalendarApiError("Only ACTIVE holds can be confirmed.", 400);
    }

    if (hold.expiresAt <= new Date()) {
      await prisma.calendarHold.update({
        where: { id: hold.id },
        data: { status: "EXPIRED" },
      });
      throw new CalendarApiError("Hold has expired.", 400);
    }

    const body = (await req.json().catch(() => ({}))) as ConfirmHoldPayload;
    const requestedWorkers = parseWorkerIds(body.workerIds);
    const workerIds = requestedWorkers.length > 0 ? requestedWorkers : [hold.workerUserId];

    const validWorkerIds = await resolveWorkspaceUserIds({
      organizationId: hold.orgId,
      requestedUserIds: workerIds,
      includeInternal: true,
    });

    if (validWorkerIds.length !== workerIds.length) {
      throw new CalendarApiError("One or more worker assignments are invalid.", 400);
    }

    assertWorkerEditAllowed({
      actor,
      workerUserIds: workerIds,
    });

    const startAt = hold.startAt;
    const endAt = parseDate(body.endAt || null) || hold.endAt || addMinutes(startAt, 30);
    if (endAt <= startAt) {
      throw new CalendarApiError("endAt must be after startAt.", 400);
    }

    const busy = body.busy !== false;
    if (busy) {
      const conflicts = await detectWorkerConflicts({
        orgId: hold.orgId,
        workerUserIds: workerIds,
        startAtUtc: startAt,
        endAtUtc: endAt,
        includeEvents: true,
        excludeHoldId: hold.id,
      });

      if (conflicts.length > 0) {
        return NextResponse.json(
          {
            ok: false,
            error: "Hold confirmation conflicts with schedule.",
            conflicts,
          },
          { status: 409 },
        );
      }
    }

    const event = await prisma.$transaction(async (tx) => {
      const nextEvent = await tx.event.create({
        data: {
          orgId: hold.orgId,
          leadId: body.leadId || hold.leadId || null,
          type: normalizeEventType(body.type),
          status: parseEventStatus(body.status),
          busy,
          allDay: body.allDay === true,
          title: body.title?.trim() || hold.title || "Scheduled Job",
          description: body.description?.trim() || null,
          customerName: body.customerName?.trim() || hold.customerName || null,
          addressLine: body.addressLine?.trim() || hold.addressLine || null,
          startAt,
          endAt,
          assignedToUserId: workerIds[0] || null,
          createdByUserId: actor.id,
          workerAssignments: {
            createMany: {
              data: workerIds.map((workerUserId) => ({
                orgId: hold.orgId,
                workerUserId,
              })),
            },
          },
        },
        select: calendarEventSelect,
      });

      const linkedJobId = await syncLeadBookingState(tx, {
        orgId: hold.orgId,
        leadId: nextEvent.leadId,
        eventId: nextEvent.id,
        type: nextEvent.type,
        status: nextEvent.status,
        startAt: nextEvent.startAt,
        endAt: nextEvent.endAt,
        title: nextEvent.title,
        customerName: nextEvent.customerName,
        addressLine: nextEvent.addressLine,
        createdByUserId: nextEvent.createdByUserId,
      });

      await tx.calendarHold.update({
        where: { id: hold.id },
        data: {
          status: "CONFIRMED",
        },
      });

      return {
        ...nextEvent,
        jobId: linkedJobId ?? nextEvent.jobId,
      };
    });

    if (event.provider === "LOCAL" && event.assignedToUserId) {
      void enqueueGoogleSyncJob({
        orgId: hold.orgId,
        userId: event.assignedToUserId,
        eventId: event.id,
        action: "UPSERT_EVENT",
      });
    }

    const settings = await getOrgCalendarSettings(hold.orgId);
    const availabilityByWorker: Record<string, string[]> = {};
    for (const workerUserId of workerIds) {
      const workerTimeZone = await getWorkerCalendarTimeZone({
        workerUserId,
        fallbackTimeZone: settings.calendarTimezone,
      });
      const dateKey = localDateFromUtc(startAt, workerTimeZone);
      const availability = await computeAvailabilityForWorker({
        orgId: hold.orgId,
        workerUserId,
        date: dateKey,
        durationMinutes: Math.max(15, Math.round((endAt.getTime() - startAt.getTime()) / 60000)),
        settings,
      });
      availabilityByWorker[workerUserId] = availability.slotsUtc;
    }

    return NextResponse.json({
      ok: true,
      event: serializeCalendarEvent(event),
      holdId: hold.id,
      availabilityByWorker,
      timeZone: settings.calendarTimezone,
    });
  } catch (error) {
    if (error instanceof CalendarApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to confirm hold.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
