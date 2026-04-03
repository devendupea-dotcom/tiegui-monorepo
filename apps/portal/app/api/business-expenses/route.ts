import { NextResponse } from "next/server";
import {
  AppApiError,
  assertOrgReadAccess,
  assertOrgWriteAccess,
  requireAppApiActor,
  resolveActorOrgId,
} from "@/lib/app-api-permissions";
import { listBusinessExpenses, saveBusinessExpense } from "@/lib/business-expenses-store";
import { capturePortalError } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BusinessExpenseCreatePayload = {
  orgId?: unknown;
  jobId?: unknown;
  purchaseOrderId?: unknown;
  expenseDate?: unknown;
  vendorName?: unknown;
  category?: unknown;
  description?: unknown;
  amount?: unknown;
  notes?: unknown;
};

export async function GET(req: Request) {
  try {
    const actor = await requireAppApiActor();
    const url = new URL(req.url);
    const orgId = await resolveActorOrgId({
      actor,
      requestedOrgId: url.searchParams.get("orgId"),
    });

    assertOrgReadAccess(actor, orgId);

    const expenses = await listBusinessExpenses({
      orgId,
      query: url.searchParams.get("q")?.trim() || "",
      category: url.searchParams.get("category")?.trim() || "",
      jobId: url.searchParams.get("jobId")?.trim() || null,
    });

    return NextResponse.json({
      ok: true,
      expenses,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "GET /api/business-expenses",
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to load business expenses.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const actor = await requireAppApiActor();
    const payload = (await req.json().catch(() => null)) as BusinessExpenseCreatePayload | null;
    const orgId = await resolveActorOrgId({
      actor,
      requestedOrgId: typeof payload?.orgId === "string" ? payload.orgId : undefined,
    });

    assertOrgWriteAccess(actor, orgId);

    const expense = await saveBusinessExpense({
      orgId,
      actorId: actor.id,
      payload,
    });

    return NextResponse.json({
      ok: true,
      expense,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "POST /api/business-expenses",
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to create business expense.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
