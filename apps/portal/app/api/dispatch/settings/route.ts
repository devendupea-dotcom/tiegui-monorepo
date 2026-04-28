import { NextResponse } from "next/server";
import {
  AppApiError,
  assertOrgReadAccess,
  assertOrgWriteAccess,
  requireAppApiActor,
  resolveActorOrgId,
} from "@/lib/app-api-permissions";
import { getDispatchNotificationSettings, updateDispatchNotificationSettings } from "@/lib/dispatch-notifications";
import { capturePortalError } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type NotificationSettingsPayload = {
  orgId?: unknown;
  smsEnabled?: unknown;
  notifyScheduled?: unknown;
  notifyOnTheWay?: unknown;
  notifyRescheduled?: unknown;
  notifyCompleted?: unknown;
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

    const settings = await getDispatchNotificationSettings(orgId);
    return NextResponse.json({ ok: true, settings });
  } catch (error) {
    await capturePortalError(error, {
      route: "GET /api/dispatch/settings",
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to load dispatch settings.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const actor = await requireAppApiActor();
    const payload = (await req.json().catch(() => null)) as NotificationSettingsPayload | null;
    const orgId = await resolveActorOrgId({
      actor,
      requestedOrgId: typeof payload?.orgId === "string" ? payload.orgId : undefined,
    });
    assertOrgWriteAccess(actor, orgId);

    const settings = await updateDispatchNotificationSettings({
      orgId,
      payload,
    });

    return NextResponse.json({ ok: true, settings });
  } catch (error) {
    await capturePortalError(error, {
      route: "PATCH /api/dispatch/settings",
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to save dispatch settings.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
