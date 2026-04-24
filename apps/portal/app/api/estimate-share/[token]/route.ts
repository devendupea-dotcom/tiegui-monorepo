import { NextResponse } from "next/server";
import { AppApiError } from "@/lib/app-api-permissions";
import { getEstimateShareByToken } from "@/lib/estimate-share-store";
import { capturePortalError } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    token: string;
  }>;
};

export async function GET(_: Request, props: RouteContext) {
  const params = await props.params;
  try {
    const estimate = await getEstimateShareByToken(params.token);
    return NextResponse.json({
      ok: true,
      estimate,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "GET /api/estimate-share/[token]",
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to load estimate link.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
