import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertOrgReadAccess,
  assertOrgWriteAccess,
  requireAppApiActor,
} from "@/lib/app-api-permissions";
import { capturePortalError } from "@/lib/telemetry";
import { getJobCostingForOrg, updateJobCosting } from "@/lib/job-costing-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: {
    jobId: string;
  };
};

type UpdatePayload = {
  costingNotes?: unknown;
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
    throw new AppApiError("Job not found.", 404);
  }

  return job;
}

export async function GET(_: Request, { params }: RouteContext) {
  try {
    const actor = await requireAppApiActor();
    const scoped = await getScopedJobOrThrow(params.jobId);
    assertOrgReadAccess(actor, scoped.orgId);

    const job = await getJobCostingForOrg({
      orgId: scoped.orgId,
      jobId: scoped.id,
    });

    if (!job) {
      throw new AppApiError("Job not found.", 404);
    }

    return NextResponse.json({
      ok: true,
      job,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "GET /api/jobs/[jobId]/costing",
      jobId: params.jobId,
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to load job costing detail.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: RouteContext) {
  try {
    const actor = await requireAppApiActor();
    const scoped = await getScopedJobOrThrow(params.jobId);
    assertOrgWriteAccess(actor, scoped.orgId);

    const payload = (await req.json().catch(() => null)) as UpdatePayload | null;
    const job = await updateJobCosting({
      orgId: scoped.orgId,
      jobId: scoped.id,
      costingNotes: payload?.costingNotes,
    });

    return NextResponse.json({
      ok: true,
      job,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "PATCH /api/jobs/[jobId]/costing",
      jobId: params.jobId,
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to update job costing.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
