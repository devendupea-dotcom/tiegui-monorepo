import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { CUSTOMER_IMPORT_MAX_ROWS, type CustomerImportMapping, type CustomerImportRawRow } from "@/lib/customer-import";
import { applyCustomerImportRows } from "@/lib/customer-import-crm";
import { AppApiError, assertOrgWriteAccess, requireAppApiActor, resolveActorOrgId } from "@/lib/app-api-permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ImportPayload = {
  orgId?: string;
  rows?: CustomerImportRawRow[];
  mapping?: CustomerImportMapping;
  fileName?: string;
};

export async function POST(req: Request) {
  try {
    const actor = await requireAppApiActor();
    const payload = (await req.json().catch(() => null)) as ImportPayload | null;

    if (!payload) {
      throw new AppApiError("Invalid JSON payload.", 400);
    }

    const orgId = await resolveActorOrgId({
      actor,
      requestedOrgId: payload.orgId,
    });
    assertOrgWriteAccess(actor, orgId);

    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (rows.length === 0) {
      throw new AppApiError("At least one row is required for import.", 400);
    }
    if (rows.length > CUSTOMER_IMPORT_MAX_ROWS) {
      throw new AppApiError(`Import supports up to ${CUSTOMER_IMPORT_MAX_ROWS} rows per run.`, 400);
    }
    if (!payload.mapping) {
      throw new AppApiError("Column mapping is required.", 400);
    }

    const result = await applyCustomerImportRows({
      orgId,
      actorUserId: actor.id,
      rows,
      mapping: payload.mapping,
      fileName: typeof payload.fileName === "string" ? payload.fileName : null,
    });

    revalidatePath("/app/crm");
    revalidatePath("/app/jobs");
    revalidatePath("/app/settings/integrations");

    return NextResponse.json({
      ok: true,
      orgId,
      outcome: result.outcome,
      historyItem: result.historyItem,
    });
  } catch (error) {
    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Import failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
