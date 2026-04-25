import { NextResponse } from "next/server";
import { AppApiError, requireAppApiActor } from "@/lib/app-api-permissions";
import { capturePortalError } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    jobId: string;
  }>;
};

export async function PATCH(_req: Request, props: RouteContext) {
  const params = await props.params;
  try {
    await requireAppApiActor();

    return NextResponse.json(
      {
        ok: false,
        error:
          "PATCH /api/jobs/[jobId]/status is deprecated. Update schedule timing in calendar routes and execution state through operational job or dispatch routes.",
      },
      { status: 410 },
    );
  } catch (error) {
    await capturePortalError(error, {
      route: "PATCH /api/jobs/[jobId]/status",
      jobId: params.jobId,
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "This status route is no longer available.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
