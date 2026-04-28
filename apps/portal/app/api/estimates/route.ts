import { NextResponse } from "next/server";
import { type EstimateStatus } from "@prisma/client";
import {
  AppApiError,
  assertOrgReadAccess,
  assertOrgWriteAccess,
  requireAppApiActor,
  resolveActorOrgId,
} from "@/lib/app-api-permissions";
import { estimateListInclude, buildEstimateListWhere, saveEstimate } from "@/lib/estimates-store";
import { estimateStatusOptions, serializeEstimateSummary } from "@/lib/estimates";
import { prisma } from "@/lib/prisma";
import { capturePortalError } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EstimateCreatePayload = {
  orgId?: unknown;
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

function parseStatusFilter(value: string): EstimateStatus[] {
  return value
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry): entry is EstimateStatus => estimateStatusOptions.includes(entry as EstimateStatus));
}

export async function GET(req: Request) {
  try {
    const actor = await requireAppApiActor();
    const url = new URL(req.url);
    const orgId = await resolveActorOrgId({
      actor,
      requestedOrgId: url.searchParams.get("orgId"),
    });
    assertOrgReadAccess(actor, orgId);

    const query = url.searchParams.get("q")?.trim() || "";
    const statusFilter = parseStatusFilter(url.searchParams.get("status") || "");
    const includeArchived = url.searchParams.get("includeArchived") === "1";

    const estimates = await prisma.estimate.findMany({
      where: buildEstimateListWhere({
        orgId,
        query,
        statusValues: statusFilter,
        includeArchived,
      }),
      include: estimateListInclude,
      orderBy: [{ updatedAt: "desc" }],
      take: 200,
    });

    return NextResponse.json({
      ok: true,
      estimates: estimates.map(serializeEstimateSummary),
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "GET /api/estimates",
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to load estimates.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const actor = await requireAppApiActor();
    const payload = (await req.json().catch(() => null)) as EstimateCreatePayload | null;
    const orgId = await resolveActorOrgId({
      actor,
      requestedOrgId: typeof payload?.orgId === "string" ? payload.orgId : undefined,
    });
    assertOrgWriteAccess(actor, orgId);

    const estimate = await saveEstimate({
      orgId,
      actorId: actor.id,
      payload,
    });

    return NextResponse.json({
      ok: true,
      estimate,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "POST /api/estimates",
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to create estimate.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
