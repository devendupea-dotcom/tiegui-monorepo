import { NextResponse } from "next/server";
import {
  AppApiError,
  assertOrgReadAccess,
  requireAppApiActor,
  resolveActorOrgId,
} from "@/lib/app-api-permissions";
import { capturePortalError } from "@/lib/telemetry";
import { getJobCostingOverview } from "@/lib/job-costing-store";

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

    const jobs = await getJobCostingOverview({
      orgId,
      query: url.searchParams.get("q") || "",
      status: url.searchParams.get("status") || "",
    });

    return NextResponse.json({
      ok: true,
      jobs,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "GET /api/jobs/costing",
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to load job costing.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
