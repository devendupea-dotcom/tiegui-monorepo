import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertOrgWriteAccess,
  requireAppApiActor,
} from "@/lib/app-api-permissions";
import { sendPendingDispatchScheduleCustomerUpdate } from "@/lib/dispatch-notifications";
import { capturePortalError } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    jobId: string;
  }>;
};

type CustomerUpdatePayload = {
  recovery?: unknown;
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

export async function POST(req: Request, props: RouteContext) {
  const params = await props.params;
  try {
    const actor = await requireAppApiActor();
    const scoped = await getScopedJobOrThrow(params.jobId);
    const payload = (await req.json().catch(() => null)) as CustomerUpdatePayload | null;

    assertOrgWriteAccess(actor, scoped.orgId);

    const result = await sendPendingDispatchScheduleCustomerUpdate({
      orgId: scoped.orgId,
      jobId: scoped.id,
      actorUserId: actor.id,
      recovery: payload?.recovery === true,
    });

    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "POST /api/dispatch/jobs/[jobId]/customer-update",
      jobId: params.jobId,
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to send customer update.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
