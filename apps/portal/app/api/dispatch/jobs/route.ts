import { NextResponse } from "next/server";
import {
  AppApiError,
  assertOrgWriteAccess,
  requireAppApiActor,
  resolveActorOrgId,
} from "@/lib/app-api-permissions";
import { getDispatchSchemaErrorMessage } from "@/lib/prisma-errors";
import { createDispatchJob } from "@/lib/dispatch-store";
import { capturePortalError } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateDispatchJobPayload = {
  orgId?: unknown;
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

export async function POST(req: Request) {
  try {
    const actor = await requireAppApiActor();
    const payload = (await req.json().catch(() => null)) as CreateDispatchJobPayload | null;
    const orgId = await resolveActorOrgId({
      actor,
      requestedOrgId: typeof payload?.orgId === "string" ? payload.orgId : undefined,
    });

    assertOrgWriteAccess(actor, orgId);

    const job = await createDispatchJob({
      orgId,
      actorUserId: actor.id,
      payload,
      todayDate: typeof payload?.todayDate === "string" ? payload.todayDate : undefined,
    });

    return NextResponse.json({
      ok: true,
      job,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "POST /api/dispatch/jobs",
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const schemaMessage = getDispatchSchemaErrorMessage(error);
    if (schemaMessage) {
      return NextResponse.json({ ok: false, error: schemaMessage }, { status: 503 });
    }

    const message = error instanceof Error ? error.message : "Failed to create dispatch job.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
