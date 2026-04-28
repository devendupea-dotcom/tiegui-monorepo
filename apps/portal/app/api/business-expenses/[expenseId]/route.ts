import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertOrgReadAccess,
  assertOrgWriteAccess,
  requireAppApiActor,
} from "@/lib/app-api-permissions";
import { deleteBusinessExpense, getBusinessExpense, saveBusinessExpense } from "@/lib/business-expenses-store";
import { capturePortalError } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ expenseId: string }>;
};

type BusinessExpenseUpdatePayload = {
  jobId?: unknown;
  purchaseOrderId?: unknown;
  expenseDate?: unknown;
  vendorName?: unknown;
  category?: unknown;
  description?: unknown;
  amount?: unknown;
  notes?: unknown;
};

async function resolveExpenseOrgId(expenseId: string): Promise<string> {
  const scoped = await prisma.businessExpense.findUnique({
    where: { id: expenseId },
    select: { orgId: true },
  });

  if (!scoped) {
    throw new AppApiError("Business expense not found.", 404);
  }

  return scoped.orgId;
}

export async function GET(_req: Request, props: RouteContext) {
  const params = await props.params;
  try {
    const actor = await requireAppApiActor();
    const orgId = await resolveExpenseOrgId(params.expenseId);
    assertOrgReadAccess(actor, orgId);

    const expense = await getBusinessExpense(orgId, params.expenseId);

    return NextResponse.json({
      ok: true,
      expense,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "GET /api/business-expenses/[expenseId]",
      expenseId: params.expenseId,
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to load business expense.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request, props: RouteContext) {
  const params = await props.params;
  try {
    const actor = await requireAppApiActor();
    const orgId = await resolveExpenseOrgId(params.expenseId);
    assertOrgWriteAccess(actor, orgId);

    const payload = (await req.json().catch(() => null)) as BusinessExpenseUpdatePayload | null;
    const expense = await saveBusinessExpense({
      orgId,
      actorId: actor.id,
      expenseId: params.expenseId,
      payload,
    });

    return NextResponse.json({
      ok: true,
      expense,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "PATCH /api/business-expenses/[expenseId]",
      expenseId: params.expenseId,
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to update business expense.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, props: RouteContext) {
  const params = await props.params;
  try {
    const actor = await requireAppApiActor();
    const orgId = await resolveExpenseOrgId(params.expenseId);
    assertOrgWriteAccess(actor, orgId);

    await deleteBusinessExpense(orgId, params.expenseId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    await capturePortalError(error, {
      route: "DELETE /api/business-expenses/[expenseId]",
      expenseId: params.expenseId,
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to delete business expense.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
