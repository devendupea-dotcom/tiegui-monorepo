import { NextResponse } from "next/server";
import type { CalendarHoldStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  CalendarApiError,
  assertOrgReadAccess,
  assertOrgWriteAccess,
  requireCalendarActor,
} from "@/lib/calendar/permissions";
import { parseUtcDateTime } from "@/lib/calendar/dates";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: { holdId: string };
};

type HoldUpdatePayload = {
  status?: string;
  expiresAt?: string | null;
};

function parseDate(value: string | null | undefined): Date | null {
  return parseUtcDateTime(value);
}

function parseHoldStatus(value: unknown): CalendarHoldStatus | undefined {
  const allowed: CalendarHoldStatus[] = ["ACTIVE", "CONFIRMED", "EXPIRED", "CANCELLED"];
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toUpperCase();
  return allowed.includes(normalized as CalendarHoldStatus) ? (normalized as CalendarHoldStatus) : undefined;
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

export async function GET(_req: Request, { params }: RouteContext) {
  try {
    const actor = await requireCalendarActor();
    const hold = await prisma.calendarHold.findUnique({
      where: { id: params.holdId },
    });
    if (!hold) {
      throw new CalendarApiError("Hold not found.", 404);
    }
    assertOrgReadAccess(actor, hold.orgId);

    return NextResponse.json({
      ok: true,
      hold: serializeHold(hold),
    });
  } catch (error) {
    if (error instanceof CalendarApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to load hold.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: RouteContext) {
  try {
    const actor = await requireCalendarActor();
    const hold = await prisma.calendarHold.findUnique({
      where: { id: params.holdId },
    });
    if (!hold) {
      throw new CalendarApiError("Hold not found.", 404);
    }
    assertOrgWriteAccess(actor, hold.orgId);

    const body = (await req.json().catch(() => null)) as HoldUpdatePayload | null;
    if (!body) {
      throw new CalendarApiError("Invalid JSON payload.", 400);
    }

    const status = parseHoldStatus(body.status) || hold.status;

    const expiresAt = parseDate(body.expiresAt || null) || hold.expiresAt;

    const updated = await prisma.calendarHold.update({
      where: { id: hold.id },
      data: {
        status,
        expiresAt,
      },
    });

    return NextResponse.json({
      ok: true,
      hold: serializeHold(updated),
    });
  } catch (error) {
    if (error instanceof CalendarApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to update hold.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  try {
    const actor = await requireCalendarActor();
    const hold = await prisma.calendarHold.findUnique({
      where: { id: params.holdId },
    });
    if (!hold) {
      throw new CalendarApiError("Hold not found.", 404);
    }
    assertOrgWriteAccess(actor, hold.orgId);

    await prisma.calendarHold.delete({
      where: { id: hold.id },
    });

    return NextResponse.json({
      ok: true,
      deletedId: hold.id,
    });
  } catch (error) {
    if (error instanceof CalendarApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to delete hold.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
