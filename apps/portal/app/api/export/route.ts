import { NextResponse } from "next/server";
import { createOrgExportArchive } from "@/lib/integrations/export";
import { IntegrationScopeError, resolveIntegrationOrgScope } from "@/lib/integrations/scope";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const scope = await resolveIntegrationOrgScope(req);
    const archive = await createOrgExportArchive(scope.orgId);

    return new NextResponse(archive.stream, {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${archive.fileName}"`,
        "content-length": String(archive.byteLength),
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof IntegrationScopeError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Export failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
