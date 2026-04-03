import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertOrgWriteAccess,
  requireAppApiActor,
} from "@/lib/app-api-permissions";
import { revokeEstimateShareLinks } from "@/lib/estimate-share-store";
import { capturePortalError } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: {
    estimateId: string;
  };
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

export async function POST(_: Request, { params }: RouteContext) {
  try {
    const actor = await requireAppApiActor();
    const scoped = await getScopedEstimateOrThrow(params.estimateId);
    assertOrgWriteAccess(actor, scoped.orgId);

    const estimate = await revokeEstimateShareLinks({
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
      route: "POST /api/estimates/[estimateId]/revoke-share",
      estimateId: params.estimateId,
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to revoke estimate share link.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
