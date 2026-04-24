import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertOrgWriteAccess,
  requireAppApiActor,
} from "@/lib/app-api-permissions";
import { addEstimateLineItem } from "@/lib/estimates-store";
import { capturePortalError } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    estimateId: string;
  }>;
};

type AddEstimateItemPayload = {
  materialId?: unknown;
  type?: unknown;
  name?: unknown;
  description?: unknown;
  quantity?: unknown;
  unit?: unknown;
  unitPrice?: unknown;
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

export async function POST(req: Request, props: RouteContext) {
  const params = await props.params;
  try {
    const actor = await requireAppApiActor();
    const scoped = await getScopedEstimateOrThrow(params.estimateId);
    assertOrgWriteAccess(actor, scoped.orgId);

    const payload = (await req.json().catch(() => null)) as AddEstimateItemPayload | null;
    const estimate = await addEstimateLineItem({
      orgId: scoped.orgId,
      estimateId: scoped.id,
      actorId: actor.id,
      payload,
    });

    return NextResponse.json({
      ok: true,
      estimate,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "POST /api/estimates/[estimateId]/items",
      estimateId: params.estimateId,
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to add estimate line item.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
