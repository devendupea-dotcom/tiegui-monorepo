import { NextResponse } from "next/server";
import type { PurchaseOrderStatus } from "@prisma/client";
import {
  AppApiError,
  assertOrgReadAccess,
  assertOrgWriteAccess,
  requireAppApiActor,
  resolveActorOrgId,
} from "@/lib/app-api-permissions";
import { listPurchaseOrders, savePurchaseOrder } from "@/lib/purchase-orders-store";
import { purchaseOrderStatusOptions } from "@/lib/purchase-orders";
import { capturePortalError } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PurchaseOrderCreatePayload = {
  orgId?: unknown;
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

function isPurchaseOrderStatus(value: string): boolean {
  return purchaseOrderStatusOptions.includes(value as PurchaseOrderStatus);
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

    const orders = await listPurchaseOrders({
      orgId,
      query: url.searchParams.get("q")?.trim() || "",
      status: isPurchaseOrderStatus(url.searchParams.get("status")?.trim().toUpperCase() || "")
        ? url.searchParams.get("status")?.trim().toUpperCase() || ""
        : "",
      jobId: url.searchParams.get("jobId")?.trim() || null,
    });

    return NextResponse.json({
      ok: true,
      purchaseOrders: orders,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "GET /api/purchase-orders",
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to load purchase orders.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const actor = await requireAppApiActor();
    const payload = (await req.json().catch(() => null)) as PurchaseOrderCreatePayload | null;
    const orgId = await resolveActorOrgId({
      actor,
      requestedOrgId: typeof payload?.orgId === "string" ? payload.orgId : undefined,
    });

    assertOrgWriteAccess(actor, orgId);

    const purchaseOrder = await savePurchaseOrder({
      orgId,
      actorId: actor.id,
      payload,
    });

    return NextResponse.json({
      ok: true,
      purchaseOrder,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "POST /api/purchase-orders",
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to create purchase order.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
