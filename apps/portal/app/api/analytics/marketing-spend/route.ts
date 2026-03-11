import { NextResponse } from "next/server";
import type { MarketingChannel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  canManageAnyOrgJobs,
  requireAppApiActor,
  resolveActorOrgId,
} from "@/lib/app-api-permissions";
import { listMarketingSpend } from "@/lib/portal-analytics";
import { capturePortalError } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANNELS: MarketingChannel[] = ["GOOGLE_ADS", "META_ADS", "OTHER"];

type MarketingSpendPayload = {
  id?: string;
  orgId?: string;
  month?: string;
  channel?: string;
  spendCents?: number;
  notes?: string | null;
};

function parseMonthStart(value: unknown): Date {
  if (typeof value === "string" && /^\d{4}-\d{2}$/.test(value.trim())) {
    const parsed = new Date(`${value.trim()}-01T00:00:00.000Z`);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  throw new AppApiError("month must be in YYYY-MM format.", 400);
}

function parseChannel(value: unknown): MarketingChannel {
  if (typeof value !== "string") {
    throw new AppApiError("channel is required.", 400);
  }
  const normalized = value.trim().toUpperCase();
  if (!CHANNELS.includes(normalized as MarketingChannel)) {
    throw new AppApiError("Invalid channel.", 400);
  }
  return normalized as MarketingChannel;
}

function parseSpendCents(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(String(value || ""));
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new AppApiError("spendCents must be zero or greater.", 400);
  }
  return Math.round(parsed);
}

function parseNotes(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") {
    throw new AppApiError("notes must be a string.", 400);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 600) {
    throw new AppApiError("notes must be 600 characters or less.", 400);
  }
  return trimmed;
}

async function assertSpendWriteAccess(actor: Awaited<ReturnType<typeof requireAppApiActor>>) {
  if (actor.internalUser || canManageAnyOrgJobs(actor)) {
    return;
  }
  throw new AppApiError("Only owners and admins can edit marketing spend.", 403);
}

export async function GET(req: Request) {
  try {
    const actor = await requireAppApiActor();
    const url = new URL(req.url);
    const orgId = await resolveActorOrgId({
      actor,
      requestedOrgId: url.searchParams.get("orgId"),
    });

    if (!actor.internalUser && !canManageAnyOrgJobs(actor)) {
      throw new AppApiError("Only owners and admins can view marketing spend.", 403);
    }

    const entries = await listMarketingSpend({
      orgId,
      month: url.searchParams.get("month"),
    });

    return NextResponse.json({
      ok: true,
      month: entries[0]?.month || url.searchParams.get("month"),
      entries,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "GET /api/analytics/marketing-spend",
    });
    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to load marketing spend.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const actor = await requireAppApiActor();
    await assertSpendWriteAccess(actor);

    const payload = (await req.json().catch(() => null)) as MarketingSpendPayload | null;
    if (!payload) {
      throw new AppApiError("Invalid JSON payload.", 400);
    }

    const orgId = await resolveActorOrgId({
      actor,
      requestedOrgId: payload.orgId,
    });
    const monthStart = parseMonthStart(payload.month);
    const channel = parseChannel(payload.channel);
    const spendCents = parseSpendCents(payload.spendCents);
    const notes = parseNotes(payload.notes);

    const entry = await prisma.marketingSpend.upsert({
      where: {
        orgId_monthStart_channel: {
          orgId,
          monthStart,
          channel,
        },
      },
      create: {
        orgId,
        monthStart,
        channel,
        spendCents,
        notes,
        createdByUserId: actor.id,
      },
      update: {
        spendCents,
        notes,
        createdByUserId: actor.id,
      },
    });

    return NextResponse.json({
      ok: true,
      entry: {
        id: entry.id,
        month: `${entry.monthStart.getUTCFullYear()}-${String(entry.monthStart.getUTCMonth() + 1).padStart(2, "0")}`,
        channel: entry.channel,
        spendCents: entry.spendCents,
        notes: entry.notes,
      },
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "POST /api/analytics/marketing-spend",
    });
    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to save marketing spend.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const actor = await requireAppApiActor();
    await assertSpendWriteAccess(actor);

    const payload = (await req.json().catch(() => null)) as MarketingSpendPayload | null;
    if (!payload?.id || typeof payload.id !== "string") {
      throw new AppApiError("id is required.", 400);
    }

    const existing = await prisma.marketingSpend.findUnique({
      where: { id: payload.id },
      select: {
        id: true,
        orgId: true,
      },
    });
    if (!existing) {
      throw new AppApiError("Marketing spend entry not found.", 404);
    }

    const orgId = await resolveActorOrgId({
      actor,
      requestedOrgId: existing.orgId,
    });
    const monthStart = payload.month ? parseMonthStart(payload.month) : undefined;
    const channel = payload.channel ? parseChannel(payload.channel) : undefined;
    const spendCents = payload.spendCents !== undefined ? parseSpendCents(payload.spendCents) : undefined;
    const notes = payload.notes !== undefined ? parseNotes(payload.notes) : undefined;

    const entry = await prisma.marketingSpend.update({
      where: { id: payload.id },
      data: {
        ...(existing.orgId === orgId ? {} : { orgId }),
        ...(monthStart ? { monthStart } : {}),
        ...(channel ? { channel } : {}),
        ...(spendCents !== undefined ? { spendCents } : {}),
        ...(notes !== undefined ? { notes } : {}),
        createdByUserId: actor.id,
      },
    });

    return NextResponse.json({
      ok: true,
      entry: {
        id: entry.id,
        month: `${entry.monthStart.getUTCFullYear()}-${String(entry.monthStart.getUTCMonth() + 1).padStart(2, "0")}`,
        channel: entry.channel,
        spendCents: entry.spendCents,
        notes: entry.notes,
      },
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "PUT /api/analytics/marketing-spend",
    });
    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to update marketing spend.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const actor = await requireAppApiActor();
    await assertSpendWriteAccess(actor);

    const url = new URL(req.url);
    const id = url.searchParams.get("id")?.trim();
    if (!id) {
      throw new AppApiError("id is required.", 400);
    }

    const existing = await prisma.marketingSpend.findUnique({
      where: { id },
      select: { id: true, orgId: true },
    });
    if (!existing) {
      throw new AppApiError("Marketing spend entry not found.", 404);
    }

    await resolveActorOrgId({
      actor,
      requestedOrgId: existing.orgId,
    });

    await prisma.marketingSpend.delete({
      where: { id },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    await capturePortalError(error, {
      route: "DELETE /api/analytics/marketing-spend",
    });
    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to delete marketing spend.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
