import { NextResponse } from "next/server";
import { AppApiError } from "@/lib/app-api-permissions";
import { declineEstimateShare } from "@/lib/estimate-share-store";
import { capturePortalError } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: {
    token: string;
  };
};

type DecisionPayload = {
  customerName?: unknown;
  note?: unknown;
};

export async function POST(req: Request, { params }: RouteContext) {
  try {
    const payload = (await req.json().catch(() => null)) as DecisionPayload | null;
    const estimate = await declineEstimateShare({
      token: params.token,
      decisionName: payload?.customerName,
      decisionNote: payload?.note,
    });
    return NextResponse.json({
      ok: true,
      estimate,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "POST /api/estimate-share/[token]/decline",
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to decline estimate.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
