import { NextResponse } from "next/server";
import {
  AppApiError,
  assertOrgReadAccess,
  assertOrgWriteAccess,
  requireAppApiActor,
  resolveActorOrgId,
} from "@/lib/app-api-permissions";
import { getDispatchSchemaErrorMessage } from "@/lib/prisma-errors";
import { getDispatchCrewSettings, updateDispatchCrew } from "@/lib/dispatch-store";
import { capturePortalError } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CrewPayload = {
  orgId?: unknown;
  crewId?: unknown;
  name?: unknown;
  active?: unknown;
};

export async function GET(req: Request) {
  try {
    const actor = await requireAppApiActor();
    const url = new URL(req.url);
    const orgId = await resolveActorOrgId({
      actor,
      requestedOrgId: url.searchParams.get("orgId"),
    });
    assertOrgReadAccess(actor, orgId);

    const crews = await getDispatchCrewSettings(orgId);
    return NextResponse.json({ ok: true, crews });
  } catch (error) {
    await capturePortalError(error, {
      route: "GET /api/dispatch/crews",
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const schemaMessage = getDispatchSchemaErrorMessage(error);
    if (schemaMessage) {
      return NextResponse.json({ ok: false, error: schemaMessage }, { status: 503 });
    }

    const message = error instanceof Error ? error.message : "Failed to load crews.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const actor = await requireAppApiActor();
    const payload = (await req.json().catch(() => null)) as CrewPayload | null;
    const orgId = await resolveActorOrgId({
      actor,
      requestedOrgId: typeof payload?.orgId === "string" ? payload.orgId : undefined,
    });
    assertOrgWriteAccess(actor, orgId);

    if (typeof payload?.crewId !== "string" || !payload.crewId.trim()) {
      throw new AppApiError("Crew is required.", 400);
    }

    const crews = await updateDispatchCrew({
      orgId,
      crewId: payload.crewId.trim(),
      payload,
    });

    return NextResponse.json({ ok: true, crews });
  } catch (error) {
    await capturePortalError(error, {
      route: "PATCH /api/dispatch/crews",
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const schemaMessage = getDispatchSchemaErrorMessage(error);
    if (schemaMessage) {
      return NextResponse.json({ ok: false, error: schemaMessage }, { status: 503 });
    }

    const message = error instanceof Error ? error.message : "Failed to update crew.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
