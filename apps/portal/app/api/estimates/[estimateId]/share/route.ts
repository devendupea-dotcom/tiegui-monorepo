import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertOrgWriteAccess,
  requireAppApiActor,
} from "@/lib/app-api-permissions";
import { createEstimateShareLink } from "@/lib/estimate-share-store";
import { capturePortalError } from "@/lib/telemetry";
import { getBaseUrlFromRequest } from "@/lib/urls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: {
    estimateId: string;
  };
};

type ShareEstimatePayload = {
  recipientName?: unknown;
  recipientEmail?: unknown;
  recipientPhoneE164?: unknown;
  expiresAt?: unknown;
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

export async function POST(req: Request, { params }: RouteContext) {
  try {
    const actor = await requireAppApiActor();
    const scoped = await getScopedEstimateOrThrow(params.estimateId);
    assertOrgWriteAccess(actor, scoped.orgId);

    const payload = (await req.json().catch(() => null)) as ShareEstimatePayload | null;
    const share = await createEstimateShareLink({
      orgId: scoped.orgId,
      estimateId: scoped.id,
      actorId: actor.id,
      baseUrl: getBaseUrlFromRequest(req),
      payload,
    });

    return NextResponse.json({
      ok: true,
      estimate: share.estimate,
      share: {
        url: share.shareUrl,
        expiresAt: share.expiresAt,
      },
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "POST /api/estimates/[estimateId]/share",
      estimateId: params.estimateId,
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to generate estimate share link.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
