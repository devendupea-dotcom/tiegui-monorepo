import { NextResponse } from "next/server";
import {
  AppApiError,
  requireAppApiActor,
  resolveActorOrgId,
} from "@/lib/app-api-permissions";
import { getPortalSummaryMetrics, type AnalyticsRange } from "@/lib/portal-analytics";
import { capturePortalError } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeRange(value: string | null): AnalyticsRange {
  if (value === "7d" || value === "30d") {
    return value;
  }
  return "month";
}

export async function GET(req: Request) {
  try {
    const actor = await requireAppApiActor();
    const url = new URL(req.url);
    const orgId = await resolveActorOrgId({
      actor,
      requestedOrgId: url.searchParams.get("orgId"),
    });
    const range = normalizeRange(url.searchParams.get("range"));

    const summary = await getPortalSummaryMetrics({
      viewer: {
        id: actor.id,
        internalUser: actor.internalUser,
        calendarAccessRole: actor.calendarAccessRole,
        orgId,
      },
      range,
    });

    return NextResponse.json({
      ok: true,
      ...summary,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "GET /api/analytics/summary",
    });
    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to load dashboard summary.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
