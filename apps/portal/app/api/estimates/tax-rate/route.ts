import { NextResponse } from "next/server";
import {
  AppApiError,
  assertOrgReadAccess,
  requireAppApiActor,
  resolveActorOrgId,
} from "@/lib/app-api-permissions";
import { lookupEstimateTaxRate } from "@/lib/estimate-tax";
import { capturePortalError } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TaxRateLookupPayload = {
  orgId?: unknown;
  siteAddress?: unknown;
};

export async function POST(req: Request) {
  try {
    const actor = await requireAppApiActor();
    const payload = (await req.json().catch(() => null)) as TaxRateLookupPayload | null;
    const orgId = await resolveActorOrgId({
      actor,
      requestedOrgId: typeof payload?.orgId === "string" ? payload.orgId : undefined,
    });
    assertOrgReadAccess(actor, orgId);

    if (typeof payload?.siteAddress !== "string" || !payload.siteAddress.trim()) {
      throw new AppApiError("Site address is required for tax lookup.", 400);
    }

    const result = await lookupEstimateTaxRate({
      siteAddress: payload.siteAddress,
    });

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "POST /api/estimates/tax-rate",
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to look up estimate tax rate.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
