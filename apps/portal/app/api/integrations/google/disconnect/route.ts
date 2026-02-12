import { NextResponse } from "next/server";
import { disconnectGoogleForOrgUser } from "@/lib/integrations/google-sync";
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

    await disconnectGoogleForOrgUser({
      orgId: scope.orgId,
      userId: scope.user.id,
    });

    return NextResponse.json({
      ok: true,
      orgId: scope.orgId,
      userId: scope.user.id,
    });
  } catch (error) {
    if (error instanceof IntegrationScopeError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to disconnect Google account.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
