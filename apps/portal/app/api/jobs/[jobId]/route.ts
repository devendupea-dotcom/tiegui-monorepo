import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertOrgReadAccess,
  assertOrgWriteAccess,
  requireAppApiActor,
} from "@/lib/app-api-permissions";
import { getJobForOrg, saveJobRecord } from "@/lib/job-records-store";
import { serializeJobDetail } from "@/lib/job-records";
import { capturePortalError } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: {
    jobId: string;
  };
};

type JobUpdatePayload = {
  customerName?: unknown;
  address?: unknown;
  projectType?: unknown;
  notes?: unknown;
  status?: unknown;
  estimateDraftId?: unknown;
  measurements?: unknown;
  materials?: unknown;
  labor?: unknown;
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

    const job = await getJobForOrg({
      jobId: scoped.id,
      orgId: scoped.orgId,
    });

    if (!job) {
      throw new AppApiError("Job not found.", 404);
    }

    return NextResponse.json({
      ok: true,
      job: serializeJobDetail(job),
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "GET /api/jobs/[jobId]",
      jobId: params.jobId,
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to load job.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: RouteContext) {
  try {
    const actor = await requireAppApiActor();
    const scoped = await getScopedJobOrThrow(params.jobId);
    assertOrgWriteAccess(actor, scoped.orgId);

    const payload = (await req.json().catch(() => null)) as JobUpdatePayload | null;
    const job = await saveJobRecord({
      orgId: scoped.orgId,
      actorId: actor.id,
      jobId: scoped.id,
      payload,
    });

    return NextResponse.json({
      ok: true,
      job,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "PUT /api/jobs/[jobId]",
      jobId: params.jobId,
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to update job.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
