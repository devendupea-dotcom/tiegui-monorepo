import { NextResponse } from "next/server";
import {
  AppApiError,
  assertOrgReadAccess,
  assertOrgWriteAccess,
  requireAppApiActor,
} from "@/lib/app-api-permissions";
import { prisma } from "@/lib/prisma";
import { getPurchaseOrderDetail, cancelPurchaseOrder, savePurchaseOrder } from "@/lib/purchase-orders-store";
import { capturePortalError } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ poId: string }>;
};

type PurchaseOrderUpdatePayload = {
  jobId?: unknown;
  vendorName?: unknown;
  vendorEmail?: unknown;
  vendorPhone?: unknown;
  vendorAddress?: unknown;
  title?: unknown;
  notes?: unknown;
  taxRatePercent?: unknown;
  status?: unknown;
  lineItems?: unknown;
};

async function resolvePurchaseOrderOrgId(purchaseOrderId: string): Promise<string> {
  const scoped = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: { orgId: true },
  });

  if (!scoped) {
    throw new AppApiError("Purchase order not found.", 404);
  }

  return scoped.orgId;
}

export async function GET(_req: Request, props: RouteContext) {
  const params = await props.params;
  try {
    const actor = await requireAppApiActor();
    const orgId = await resolvePurchaseOrderOrgId(params.poId);
    assertOrgReadAccess(actor, orgId);

    const purchaseOrder = await getPurchaseOrderDetail(orgId, params.poId);

    return NextResponse.json({
      ok: true,
      purchaseOrder,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "GET /api/purchase-orders/[poId]",
      purchaseOrderId: params.poId,
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to load purchase order.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request, props: RouteContext) {
  const params = await props.params;
  try {
    const actor = await requireAppApiActor();
    const orgId = await resolvePurchaseOrderOrgId(params.poId);
    assertOrgWriteAccess(actor, orgId);

    const payload = (await req.json().catch(() => null)) as PurchaseOrderUpdatePayload | null;
    const purchaseOrder = await savePurchaseOrder({
      orgId,
      actorId: actor.id,
      purchaseOrderId: params.poId,
      payload,
    });

    return NextResponse.json({
      ok: true,
      purchaseOrder,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "PATCH /api/purchase-orders/[poId]",
      purchaseOrderId: params.poId,
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to update purchase order.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, props: RouteContext) {
  const params = await props.params;
  try {
    const actor = await requireAppApiActor();
    const orgId = await resolvePurchaseOrderOrgId(params.poId);
    assertOrgWriteAccess(actor, orgId);

    await cancelPurchaseOrder(orgId, params.poId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    await capturePortalError(error, {
      route: "DELETE /api/purchase-orders/[poId]",
      purchaseOrderId: params.poId,
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to cancel purchase order.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
