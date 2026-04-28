import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertOrgWriteAccess,
  requireAppApiActor,
} from "@/lib/app-api-permissions";
import { recordDispatchManualContactOutcome } from "@/lib/dispatch-notifications";
import { capturePortalError } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    jobId: string;
  }>;
};

type ManualContactOutcomePayload = {
  outcome?: unknown;
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

function isManualContactOutcome(
  value: unknown,
): value is "confirmed_schedule" | "reschedule_needed" | "no_response" {
  return value === "confirmed_schedule" || value === "reschedule_needed" || value === "no_response";
}

export async function POST(req: Request, props: RouteContext) {
  const params = await props.params;
  try {
    const actor = await requireAppApiActor();
    const scoped = await getScopedJobOrThrow(params.jobId);
    const payload = (await req.json().catch(() => null)) as ManualContactOutcomePayload | null;

    assertOrgWriteAccess(actor, scoped.orgId);

    if (!isManualContactOutcome(payload?.outcome)) {
      throw new AppApiError("Manual contact outcome is required.", 400);
    }

    await recordDispatchManualContactOutcome({
      orgId: scoped.orgId,
      jobId: scoped.id,
      actorUserId: actor.id,
      outcome: payload.outcome,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    await capturePortalError(error, {
      route: "POST /api/jobs/[jobId]/manual-contact-outcome",
      jobId: params.jobId,
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to record manual contact outcome.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
