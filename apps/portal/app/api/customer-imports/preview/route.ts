import { NextResponse } from "next/server";
import { CUSTOMER_IMPORT_MAX_ROWS, type CustomerImportMapping, type CustomerImportRawRow } from "@/lib/customer-import";
import { previewCustomerImportRows } from "@/lib/customer-import-crm";
import { AppApiError, assertOrgWriteAccess, requireAppApiActor, resolveActorOrgId } from "@/lib/app-api-permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PreviewPayload = {
  orgId?: string;
  rows?: CustomerImportRawRow[];
  mapping?: CustomerImportMapping;
};

export async function POST(req: Request) {
  try {
    const actor = await requireAppApiActor();
    const payload = (await req.json().catch(() => null)) as PreviewPayload | null;

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
      throw new AppApiError("At least one row is required for preview.", 400);
    }
    if (rows.length > CUSTOMER_IMPORT_MAX_ROWS) {
      throw new AppApiError(`Preview supports up to ${CUSTOMER_IMPORT_MAX_ROWS} rows per import.`, 400);
    }
    if (!payload.mapping) {
      throw new AppApiError("Column mapping is required.", 400);
    }

    const preview = await previewCustomerImportRows({
      orgId,
      rows,
      mapping: payload.mapping,
    });

    return NextResponse.json({
      ok: true,
      orgId,
      rows: preview.rows,
      summary: preview.summary,
      sampleRows: preview.sampleRows,
    });
  } catch (error) {
    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Preview failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
