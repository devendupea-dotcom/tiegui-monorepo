import { NextResponse } from "next/server";
import {
  AppApiError,
  assertOrgWriteAccess,
  canManageAnyOrgJobs,
  requireAppApiActor,
  resolveActorOrgId,
} from "@/lib/app-api-permissions";
import { runCommunicationIntegrityRepair } from "@/lib/communication-integrity-repair";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RepairRequestBody = {
  orgId?: unknown;
  apply?: unknown;
  rowLimit?: unknown;
};

export async function POST(req: Request) {
  try {
    const actor = await requireAppApiActor();
    if (!actor.internalUser && !canManageAnyOrgJobs(actor)) {
      throw new AppApiError(
        "Only owners, admins, or internal users can run communication repairs.",
        403,
      );
    }

    const payload = (await req
      .json()
      .catch(() => null)) as RepairRequestBody | null;
    const orgId = await resolveActorOrgId({
      actor,
      requestedOrgId: typeof payload?.orgId === "string" ? payload.orgId : null,
    });
    const apply = payload?.apply === true;
    const rowLimit =
      typeof payload?.rowLimit === "number" &&
      Number.isFinite(payload.rowLimit) &&
      payload.rowLimit > 0
        ? Math.floor(payload.rowLimit)
        : null;

    if (apply) {
      assertOrgWriteAccess(actor, orgId);
    }

    const result = await runCommunicationIntegrityRepair({
      orgId,
      apply,
      rowLimit,
    });

    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (error) {
    if (error instanceof AppApiError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: error.status },
      );
    }
    const message =
      error instanceof Error
        ? error.message
        : "Failed to run communication repairs.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
