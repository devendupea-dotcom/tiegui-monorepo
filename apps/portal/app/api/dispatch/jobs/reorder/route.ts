import { NextResponse } from "next/server";
import {
  AppApiError,
  assertOrgWriteAccess,
  requireAppApiActor,
  resolveActorOrgId,
} from "@/lib/app-api-permissions";
import { getDispatchSchemaErrorMessage } from "@/lib/prisma-errors";
import { reorderDispatchJobs } from "@/lib/dispatch-store";
import { capturePortalError } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReorderPayload = {
  orgId?: unknown;
  todayDate?: unknown;
  date?: unknown;
  columns?: unknown;
};

function normalizeColumns(value: unknown): { crewId: string | null; jobIds: string[] }[] {
  if (!Array.isArray(value)) {
    throw new AppApiError("Reorder payload is invalid.", 400);
  }

  return value.map((entry) => {
    const row = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    const crewId =
      typeof row.crewId === "string" ? row.crewId.trim() || null : row.crewId == null ? null : null;
    const jobIds = Array.isArray(row.jobIds)
      ? row.jobIds
          .map((jobId) => (typeof jobId === "string" ? jobId.trim() : ""))
          .filter(Boolean)
      : [];

    return {
      crewId,
      jobIds,
    };
  });
}

export async function POST(req: Request) {
  try {
    const actor = await requireAppApiActor();
    const payload = (await req.json().catch(() => null)) as ReorderPayload | null;
    const orgId = await resolveActorOrgId({
      actor,
      requestedOrgId: typeof payload?.orgId === "string" ? payload.orgId : undefined,
    });
    const date = typeof payload?.date === "string" ? payload.date.trim() : "";

    if (!date) {
      throw new AppApiError("Date is required for dispatch reordering.", 400);
    }

    assertOrgWriteAccess(actor, orgId);

    const snapshot = await reorderDispatchJobs({
      orgId,
      actorUserId: actor.id,
      date,
      columns: normalizeColumns(payload?.columns),
      todayDate: typeof payload?.todayDate === "string" ? payload.todayDate : undefined,
    });

    return NextResponse.json({
      ok: true,
      snapshot,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "POST /api/dispatch/jobs/reorder",
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const schemaMessage = getDispatchSchemaErrorMessage(error);
    if (schemaMessage) {
      return NextResponse.json({ ok: false, error: schemaMessage }, { status: 503 });
    }

    const message = error instanceof Error ? error.message : "Failed to reorder dispatch jobs.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
