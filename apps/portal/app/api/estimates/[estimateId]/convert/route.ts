import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertOrgWriteAccess,
  requireAppApiActor,
} from "@/lib/app-api-permissions";
import { convertEstimate } from "@/lib/estimates-store";
import { capturePortalError } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: {
    estimateId: string;
  };
};

type ConvertEstimatePayload = {
  createJob?: unknown;
  createInvoice?: unknown;
  dispatchDate?: unknown;
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

function parseBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value.trim().toLowerCase() === "true";
  }
  return false;
}

export async function POST(req: Request, { params }: RouteContext) {
  try {
    const actor = await requireAppApiActor();
    const scoped = await getScopedEstimateOrThrow(params.estimateId);
    assertOrgWriteAccess(actor, scoped.orgId);

    const payload = (await req.json().catch(() => null)) as ConvertEstimatePayload | null;
    const result = await convertEstimate({
      orgId: scoped.orgId,
      estimateId: scoped.id,
      actorId: actor.id,
      createJob: parseBoolean(payload?.createJob),
      createInvoice: parseBoolean(payload?.createInvoice),
      dispatchDate: typeof payload?.dispatchDate === "string" ? payload.dispatchDate : undefined,
    });

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "POST /api/estimates/[estimateId]/convert",
      estimateId: params.estimateId,
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to convert estimate.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
