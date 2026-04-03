import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertOrgWriteAccess,
  requireAppApiActor,
} from "@/lib/app-api-permissions";
import { createJobTrackingLink } from "@/lib/job-tracking-store";
import { capturePortalError } from "@/lib/telemetry";
import { getBaseUrlFromRequest } from "@/lib/urls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: {
    jobId: string;
  };
};

async function getScopedJobOrThrow(jobId: string) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      orgId: true,
    },
  });

  if (!job) {
    throw new AppApiError("Dispatch job not found.", 404);
  }

  return job;
}

export async function POST(req: Request, { params }: RouteContext) {
  try {
    const actor = await requireAppApiActor();
    const scoped = await getScopedJobOrThrow(params.jobId);

    assertOrgWriteAccess(actor, scoped.orgId);

    const tracking = await createJobTrackingLink({
      orgId: scoped.orgId,
      jobId: scoped.id,
      actorId: actor.id,
      baseUrl: getBaseUrlFromRequest(req),
    });

    return NextResponse.json({
      ok: true,
      tracking: {
        url: tracking.trackingUrl,
      },
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "POST /api/dispatch/jobs/[jobId]/tracking-link",
      jobId: params.jobId,
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to create tracking link.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
