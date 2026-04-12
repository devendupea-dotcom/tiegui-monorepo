import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertOrgWriteAccess,
  requireAppApiActor,
} from "@/lib/app-api-permissions";
import { recordDispatchManualFollowThrough } from "@/lib/dispatch-notifications";
import { capturePortalError } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: {
    jobId: string;
  };
};

type ManualFollowThroughPayload = {
  state?: unknown;
  actionId?: unknown;
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

function isManualFollowThroughState(value: unknown): value is "started" | "handled" {
  return value === "started" || value === "handled";
}

export async function POST(req: Request, { params }: RouteContext) {
  try {
    const actor = await requireAppApiActor();
    const scoped = await getScopedJobOrThrow(params.jobId);
    const payload = (await req.json().catch(() => null)) as ManualFollowThroughPayload | null;

    assertOrgWriteAccess(actor, scoped.orgId);

    if (!isManualFollowThroughState(payload?.state)) {
      throw new AppApiError("Manual follow-through state is required.", 400);
    }

    await recordDispatchManualFollowThrough({
      orgId: scoped.orgId,
      jobId: scoped.id,
      actorUserId: actor.id,
      state: payload.state,
      actionId: typeof payload?.actionId === "string" && payload.actionId.trim() ? payload.actionId.trim() : null,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    await capturePortalError(error, {
      route: "POST /api/jobs/[jobId]/manual-follow-through",
      jobId: params.jobId,
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to record manual follow-through.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
