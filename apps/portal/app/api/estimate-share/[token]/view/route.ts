import { NextResponse } from "next/server";
import { AppApiError } from "@/lib/app-api-permissions";
import { recordEstimateShareView } from "@/lib/estimate-share-store";
import { capturePortalError } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    token: string;
  }>;
};

export async function POST(_: Request, props: RouteContext) {
  const params = await props.params;
  try {
    const estimate = await recordEstimateShareView(params.token);
    return NextResponse.json({
      ok: true,
      estimate,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "POST /api/estimate-share/[token]/view",
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to record estimate view.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
