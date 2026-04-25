import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertCanMutateLeadJob,
  assertOrgReadAccess,
  requireAppApiActor,
} from "@/lib/app-api-permissions";
import { createLeadPhoto, leadPhotoSelect, resolveLeadPhotoUrls } from "@/lib/lead-photos";
import { capturePortalError } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    estimateId: string;
  }>;
};

async function getScopedEstimateOrThrow(estimateId: string) {
  const estimate = await prisma.estimate.findUnique({
    where: { id: estimateId },
    select: {
      id: true,
      orgId: true,
      leadId: true,
    },
  });

  if (!estimate) {
    throw new AppApiError("Estimate not found.", 404);
  }

  return estimate;
}

function requireEstimateLeadId(leadId: string | null): string {
  if (!leadId) {
    throw new AppApiError("Attach a lead to this estimate before adding photos.", 400);
  }
  return leadId;
}

export async function GET(_: Request, props: RouteContext) {
  const params = await props.params;
  try {
    const actor = await requireAppApiActor();
    const estimate = await getScopedEstimateOrThrow(params.estimateId);
    assertOrgReadAccess(actor, estimate.orgId);

    const leadId = requireEstimateLeadId(estimate.leadId);

    const photos = await prisma.leadPhoto.findMany({
      where: {
        orgId: estimate.orgId,
        leadId,
      },
      select: leadPhotoSelect,
      orderBy: [{ createdAt: "desc" }],
      take: 120,
    });

    return NextResponse.json({
      ok: true,
      photos: await resolveLeadPhotoUrls(photos),
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "GET /api/estimates/[estimateId]/photos",
      estimateId: params.estimateId,
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to load estimate photos.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request, props: RouteContext) {
  const params = await props.params;
  try {
    const actor = await requireAppApiActor();
    const estimate = await getScopedEstimateOrThrow(params.estimateId);
    const leadId = requireEstimateLeadId(estimate.leadId);

    await assertCanMutateLeadJob({
      actor,
      orgId: estimate.orgId,
      leadId,
    });

    const photo = await createLeadPhoto({
      req,
      orgId: estimate.orgId,
      leadId,
      actorId: actor.id,
      fallbackFileName: "estimate-photo",
    });

    return NextResponse.json({ ok: true, photo });
  } catch (error) {
    await capturePortalError(error, {
      route: "POST /api/estimates/[estimateId]/photos",
      estimateId: params.estimateId,
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to upload estimate photo.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
