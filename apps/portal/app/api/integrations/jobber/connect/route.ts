import { NextResponse } from "next/server";
import { createIntegrationOAuthState } from "@/lib/integrations/oauth-state";
import { buildJobberAuthorizeUrl, resolveJobberRedirectUri } from "@/lib/integrations/jobberClient";
import { IntegrationScopeError, resolveIntegrationOrgScope } from "@/lib/integrations/scope";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const scope = await resolveIntegrationOrgScope(req);
    const requestUrl = new URL(req.url);
    const origin = `${requestUrl.protocol}//${requestUrl.host}`;
    const redirectUri = resolveJobberRedirectUri(origin);
    const state = await createIntegrationOAuthState({
      orgId: scope.orgId,
      provider: "JOBBER",
      redirectUri,
    });

    return NextResponse.redirect(buildJobberAuthorizeUrl({ state, redirectUri }));
  } catch (error) {
    if (error instanceof IntegrationScopeError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    return NextResponse.json({ ok: false, error: "Failed to start Jobber OAuth." }, { status: 500 });
  }
}
