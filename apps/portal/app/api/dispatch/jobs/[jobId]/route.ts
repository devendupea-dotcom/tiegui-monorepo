import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertOrgReadAccess,
  assertOrgWriteAccess,
  requireAppApiActor,
} from "@/lib/app-api-permissions";
import { getDispatchSchemaErrorMessage } from "@/lib/prisma-errors";
import { getDispatchJobDetail, updateDispatchJob } from "@/lib/dispatch-store";
import { capturePortalError } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: {
    jobId: string;
  };
};

type UpdateDispatchJobPayload = {
  todayDate?: unknown;
  customerId?: unknown;
  leadId?: unknown;
  linkedEstimateId?: unknown;
  customerName?: unknown;
  phone?: unknown;
  serviceType?: unknown;
  address?: unknown;
  scheduledDate?: unknown;
  scheduledStartTime?: unknown;
  scheduledEndTime?: unknown;
  assignedCrewId?: unknown;
  notes?: unknown;
  priority?: unknown;
  status?: unknown;
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

export async function GET(req: Request, { params }: RouteContext) {
  try {
    const actor = await requireAppApiActor();
    const scoped = await getScopedJobOrThrow(params.jobId);
    const url = new URL(req.url);
    const todayDate = url.searchParams.get("today")?.trim() || undefined;

    assertOrgReadAccess(actor, scoped.orgId);

    const job = await getDispatchJobDetail({
      orgId: scoped.orgId,
      jobId: scoped.id,
      todayDate,
    });

    return NextResponse.json({
      ok: true,
      job,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "GET /api/dispatch/jobs/[jobId]",
      jobId: params.jobId,
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const schemaMessage = getDispatchSchemaErrorMessage(error);
    if (schemaMessage) {
      return NextResponse.json({ ok: false, error: schemaMessage }, { status: 503 });
    }

    const message = error instanceof Error ? error.message : "Failed to load dispatch job.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: RouteContext) {
  try {
    const actor = await requireAppApiActor();
    const scoped = await getScopedJobOrThrow(params.jobId);

    assertOrgWriteAccess(actor, scoped.orgId);

    const payload = (await req.json().catch(() => null)) as UpdateDispatchJobPayload | null;
    const job = await updateDispatchJob({
      orgId: scoped.orgId,
      actorUserId: actor.id,
      jobId: scoped.id,
      payload,
      todayDate: typeof payload?.todayDate === "string" ? payload.todayDate : undefined,
    });

    return NextResponse.json({
      ok: true,
      job,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "PATCH /api/dispatch/jobs/[jobId]",
      jobId: params.jobId,
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const schemaMessage = getDispatchSchemaErrorMessage(error);
    if (schemaMessage) {
      return NextResponse.json({ ok: false, error: schemaMessage }, { status: 503 });
    }

    const message = error instanceof Error ? error.message : "Failed to update dispatch job.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
