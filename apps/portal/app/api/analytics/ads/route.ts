import { NextResponse } from "next/server";
import {
  AppApiError,
  canManageAnyOrgJobs,
  requireAppApiActor,
  resolveActorOrgId,
} from "@/lib/app-api-permissions";
import { getPortalAdsMetrics } from "@/lib/portal-analytics";
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

    if (!actor.internalUser && !canManageAnyOrgJobs(actor)) {
      throw new AppApiError("Only owners and admins can view ads analytics.", 403);
    }

    const ads = await getPortalAdsMetrics({
      viewer: {
        id: actor.id,
        internalUser: actor.internalUser,
        calendarAccessRole: actor.calendarAccessRole,
        orgId,
      },
      month: url.searchParams.get("month"),
    });

    return NextResponse.json({
      ok: true,
      ...ads,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "GET /api/analytics/ads",
    });
    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to load ads analytics.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
