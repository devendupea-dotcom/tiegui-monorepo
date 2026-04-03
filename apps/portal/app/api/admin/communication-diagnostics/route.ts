import { NextResponse } from "next/server";
import { canManageAnyOrgJobs, requireAppApiActor, resolveActorOrgId, AppApiError } from "@/lib/app-api-permissions";
import { getCommunicationDiagnostics } from "@/lib/communication-diagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const actor = await requireAppApiActor();
    if (!actor.internalUser && !canManageAnyOrgJobs(actor)) {
      throw new AppApiError("Only owners, admins, or internal users can view communication diagnostics.", 403);
    }

    const requestUrl = new URL(req.url);
    const orgId = await resolveActorOrgId({
      actor,
      requestedOrgId: requestUrl.searchParams.get("orgId"),
    });

    const summary = await getCommunicationDiagnostics(orgId);
    return NextResponse.json({
      ok: true,
      summary,
    });
  } catch (error) {
    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to load communication diagnostics.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
