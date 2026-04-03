import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertOrgWriteAccess,
  requireAppApiActor,
} from "@/lib/app-api-permissions";
import { capturePortalError } from "@/lib/telemetry";
import { createJobCostingMaterial } from "@/lib/job-costing-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: {
    jobId: string;
  };
};

type Payload = {
  materialId?: unknown;
  name?: unknown;
  unit?: unknown;
  plannedQuantity?: unknown;
  plannedUnitCost?: unknown;
  actualQuantity?: unknown;
  actualUnitCost?: unknown;
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

export async function POST(req: Request, { params }: RouteContext) {
  try {
    const actor = await requireAppApiActor();
    const scoped = await getScopedJobOrThrow(params.jobId);
    assertOrgWriteAccess(actor, scoped.orgId);

    const payload = (await req.json().catch(() => null)) as Payload | null;
    const job = await createJobCostingMaterial({
      orgId: scoped.orgId,
      jobId: scoped.id,
      payload,
    });

    return NextResponse.json({
      ok: true,
      job,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "POST /api/jobs/[jobId]/costing/materials",
      jobId: params.jobId,
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to add job costing material.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
