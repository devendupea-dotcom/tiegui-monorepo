import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertOrgReadAccess,
  assertOrgWriteAccess,
  requireAppApiActor,
} from "@/lib/app-api-permissions";
import { archiveEstimate, getEstimateForOrg, saveEstimate } from "@/lib/estimates-store";
import { serializeEstimateDetail } from "@/lib/estimates";
import { capturePortalError } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: {
    estimateId: string;
  };
};

type EstimateUpdatePayload = {
  leadId?: unknown;
  title?: unknown;
  customerName?: unknown;
  siteAddress?: unknown;
  projectType?: unknown;
  description?: unknown;
  notes?: unknown;
  terms?: unknown;
  taxRatePercent?: unknown;
  taxRateSource?: unknown;
  taxZipCode?: unknown;
  taxJurisdiction?: unknown;
  taxLocationCode?: unknown;
  taxCalculatedAt?: unknown;
  validUntil?: unknown;
  status?: unknown;
  lineItems?: unknown;
};

async function getScopedEstimateOrThrow(estimateId: string) {
  const estimate = await prisma.estimate.findUnique({
    where: { id: estimateId },
    select: {
      id: true,
      orgId: true,
    },
  });

  if (!estimate) {
    throw new AppApiError("Estimate not found.", 404);
  }

  return estimate;
}

export async function GET(_: Request, { params }: RouteContext) {
  try {
    const actor = await requireAppApiActor();
    const scoped = await getScopedEstimateOrThrow(params.estimateId);
    assertOrgReadAccess(actor, scoped.orgId);

    const estimate = await getEstimateForOrg({
      orgId: scoped.orgId,
      estimateId: scoped.id,
    });

    if (!estimate) {
      throw new AppApiError("Estimate not found.", 404);
    }

    return NextResponse.json({
      ok: true,
      estimate: serializeEstimateDetail(estimate),
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "GET /api/estimates/[estimateId]",
      estimateId: params.estimateId,
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to load estimate.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: RouteContext) {
  try {
    const actor = await requireAppApiActor();
    const scoped = await getScopedEstimateOrThrow(params.estimateId);
    assertOrgWriteAccess(actor, scoped.orgId);

    const payload = (await req.json().catch(() => null)) as EstimateUpdatePayload | null;
    const estimate = await saveEstimate({
      orgId: scoped.orgId,
      actorId: actor.id,
      estimateId: scoped.id,
      payload,
    });

    return NextResponse.json({
      ok: true,
      estimate,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "PATCH /api/estimates/[estimateId]",
      estimateId: params.estimateId,
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to update estimate.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: RouteContext) {
  try {
    const actor = await requireAppApiActor();
    const scoped = await getScopedEstimateOrThrow(params.estimateId);
    assertOrgWriteAccess(actor, scoped.orgId);

    const estimate = await archiveEstimate({
      orgId: scoped.orgId,
      estimateId: scoped.id,
      actorId: actor.id,
    });

    return NextResponse.json({
      ok: true,
      estimate,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "DELETE /api/estimates/[estimateId]",
      estimateId: params.estimateId,
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to archive estimate.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
