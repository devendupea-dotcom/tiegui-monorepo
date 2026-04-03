import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertOrgReadAccess,
  assertOrgWriteAccess,
  requireAppApiActor,
  resolveActorOrgId,
} from "@/lib/app-api-permissions";
import { saveEstimateDraft } from "@/lib/estimate-drafts";
import { capturePortalError } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EstimateDraftCreatePayload = {
  orgId?: unknown;
  projectName?: unknown;
  customerName?: unknown;
  siteAddress?: unknown;
  projectType?: unknown;
  notes?: unknown;
  taxRatePercent?: unknown;
  lineItems?: unknown;
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

    const drafts = await prisma.estimateDraft.findMany({
      where: { orgId },
      select: {
        id: true,
        projectName: true,
        customerName: true,
        finalTotal: true,
        updatedAt: true,
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 100,
    });

    return NextResponse.json({
      ok: true,
      drafts: drafts.map((draft) => ({
        id: draft.id,
        projectName: draft.projectName,
        customerName: draft.customerName || "",
        finalTotal: Number(draft.finalTotal),
        updatedAt: draft.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "GET /api/estimates/drafts",
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to load estimate drafts.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const actor = await requireAppApiActor();
    const payload = (await req.json().catch(() => null)) as EstimateDraftCreatePayload | null;
    const orgId = await resolveActorOrgId({
      actor,
      requestedOrgId: typeof payload?.orgId === "string" ? payload.orgId : undefined,
    });

    assertOrgWriteAccess(actor, orgId);

    const draft = await saveEstimateDraft({
      orgId,
      actorId: actor.id,
      payload,
    });

    return NextResponse.json({
      ok: true,
      draft,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "POST /api/estimates/drafts",
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to save estimate draft.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
