import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertOrgReadAccess,
  assertOrgWriteAccess,
  requireAppApiActor,
} from "@/lib/app-api-permissions";
import { getEstimateDraftForOrg, saveEstimateDraft } from "@/lib/estimate-drafts";
import { serializeEstimateDraft } from "@/lib/estimates";
import { capturePortalError } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: {
    id: string;
  };
};

type EstimateDraftUpdatePayload = {
  projectName?: unknown;
  customerName?: unknown;
  siteAddress?: unknown;
  projectType?: unknown;
  notes?: unknown;
  taxRatePercent?: unknown;
  lineItems?: unknown;
};

async function getScopedDraftOrThrow(draftId: string) {
  const draft = await prisma.estimateDraft.findUnique({
    where: { id: draftId },
    select: {
      id: true,
      orgId: true,
    },
  });

  if (!draft) {
    throw new AppApiError("Estimate draft not found.", 404);
  }

  return draft;
}

export async function GET(_: Request, { params }: RouteContext) {
  try {
    const actor = await requireAppApiActor();
    const scoped = await getScopedDraftOrThrow(params.id);
    assertOrgReadAccess(actor, scoped.orgId);

    const draft = await getEstimateDraftForOrg({
      draftId: scoped.id,
      orgId: scoped.orgId,
    });

    if (!draft) {
      throw new AppApiError("Estimate draft not found.", 404);
    }

    return NextResponse.json({
      ok: true,
      draft: serializeEstimateDraft(draft),
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "GET /api/estimates/drafts/[id]",
      draftId: params.id,
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to load estimate draft.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: RouteContext) {
  try {
    const actor = await requireAppApiActor();
    const scoped = await getScopedDraftOrThrow(params.id);
    assertOrgWriteAccess(actor, scoped.orgId);

    const payload = (await req.json().catch(() => null)) as EstimateDraftUpdatePayload | null;

    const draft = await saveEstimateDraft({
      orgId: scoped.orgId,
      actorId: actor.id,
      draftId: scoped.id,
      payload,
    });

    return NextResponse.json({
      ok: true,
      draft,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "PUT /api/estimates/drafts/[id]",
      draftId: params.id,
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to update estimate draft.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
