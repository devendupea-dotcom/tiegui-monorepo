import { NextResponse } from "next/server";
import {
  AppApiError,
  assertOrgReadAccess,
  requireAppApiActor,
  resolveActorOrgId,
} from "@/lib/app-api-permissions";
import { searchDispatchLookups } from "@/lib/dispatch-lookups";
import { capturePortalError } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const actor = await requireAppApiActor();
    const url = new URL(req.url);
    const orgId = await resolveActorOrgId({
      actor,
      requestedOrgId: url.searchParams.get("orgId"),
    });
    assertOrgReadAccess(actor, orgId);

    const result = await searchDispatchLookups({
      orgId,
      query: url.searchParams.get("q")?.trim() || "",
    });

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "GET /api/dispatch/lookups",
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to load dispatch lookups.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
