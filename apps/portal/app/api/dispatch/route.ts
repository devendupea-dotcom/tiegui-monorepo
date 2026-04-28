import { NextResponse } from "next/server";
import {
  AppApiError,
  assertOrgReadAccess,
  requireAppApiActor,
  resolveActorOrgId,
} from "@/lib/app-api-permissions";
import { getDispatchTodayDateKey } from "@/lib/dispatch";
import { getDispatchSchemaErrorMessage } from "@/lib/prisma-errors";
import { getDispatchDaySnapshot } from "@/lib/dispatch-store";
import { capturePortalError } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const actor = await requireAppApiActor();
    const url = new URL(req.url);
    const date = url.searchParams.get("date")?.trim() || getDispatchTodayDateKey();
    const todayDate = url.searchParams.get("today")?.trim() || undefined;
    const orgId = await resolveActorOrgId({
      actor,
      requestedOrgId: url.searchParams.get("orgId"),
    });

    assertOrgReadAccess(actor, orgId);

    const snapshot = await getDispatchDaySnapshot({
      orgId,
      date,
      todayDate,
    });

    return NextResponse.json({
      ok: true,
      snapshot,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "GET /api/dispatch",
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const schemaMessage = getDispatchSchemaErrorMessage(error);
    if (schemaMessage) {
      return NextResponse.json({ ok: false, error: schemaMessage }, { status: 503 });
    }

    const message = error instanceof Error ? error.message : "Failed to load dispatch.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
