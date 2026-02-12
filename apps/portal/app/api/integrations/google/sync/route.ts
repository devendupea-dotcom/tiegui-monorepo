import { NextResponse } from "next/server";
import { syncGoogleBusyBlocksForOrgUser } from "@/lib/integrations/google-sync";
import {
  IntegrationScopeError,
  resolveIntegrationOrgScope,
} from "@/lib/integrations/scope";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const scope = await resolveIntegrationOrgScope(req);
    if (!scope.user.id) {
      throw new IntegrationScopeError("Unauthorized", 401);
    }

    const result = await syncGoogleBusyBlocksForOrgUser({
      orgId: scope.orgId,
      userId: scope.user.id,
    });

    return NextResponse.json({
      ok: true,
      orgId: scope.orgId,
      ...result,
    });
  } catch (error) {
    if (error instanceof IntegrationScopeError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Google sync failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
