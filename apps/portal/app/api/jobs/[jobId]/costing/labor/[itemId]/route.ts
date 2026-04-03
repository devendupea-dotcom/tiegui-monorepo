import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertOrgWriteAccess,
  requireAppApiActor,
} from "@/lib/app-api-permissions";
import { capturePortalError } from "@/lib/telemetry";
import { deleteJobCostingLabor, updateJobCostingLabor } from "@/lib/job-costing-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: {
    jobId: string;
    itemId: string;
  };
};

type Payload = {
  description?: unknown;
  unit?: unknown;
  plannedQuantity?: unknown;
  plannedUnitCost?: unknown;
  actualHours?: unknown;
  actualHourlyCost?: unknown;
  varianceNotes?: unknown;
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

export async function PATCH(req: Request, { params }: RouteContext) {
  try {
    const actor = await requireAppApiActor();
    const scoped = await getScopedJobOrThrow(params.jobId);
    assertOrgWriteAccess(actor, scoped.orgId);

    const payload = (await req.json().catch(() => null)) as Payload | null;
    const job = await updateJobCostingLabor({
      orgId: scoped.orgId,
      jobId: scoped.id,
      itemId: params.itemId,
      payload,
    });

    return NextResponse.json({
      ok: true,
      job,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "PATCH /api/jobs/[jobId]/costing/labor/[itemId]",
      jobId: params.jobId,
      itemId: params.itemId,
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to update job costing labor.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: RouteContext) {
  try {
    const actor = await requireAppApiActor();
    const scoped = await getScopedJobOrThrow(params.jobId);
    assertOrgWriteAccess(actor, scoped.orgId);

    const job = await deleteJobCostingLabor({
      orgId: scoped.orgId,
      jobId: scoped.id,
      itemId: params.itemId,
    });

    return NextResponse.json({
      ok: true,
      job,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "DELETE /api/jobs/[jobId]/costing/labor/[itemId]",
      jobId: params.jobId,
      itemId: params.itemId,
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to delete job costing labor.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
