import { NextResponse } from "next/server";
import { createIntegrationOAuthState } from "@/lib/integrations/oauth-state";
import { buildJobberAuthorizeUrl, resolveJobberRedirectUri } from "@/lib/integrations/jobberClient";
import { isJobberConfigured } from "@/lib/integrations/provider-config";
import { IntegrationScopeError, resolveIntegrationAdminScope } from "@/lib/integrations/scope";

export const dynamic = "force-dynamic";

function buildSettingsUrl(req: Request, input: { orgId: string; internalUser: boolean; error?: string }) {
  const requestUrl = new URL(req.url);
  const target = new URL("/app/settings/integrations", requestUrl.origin);
  if (input.internalUser) {
    target.searchParams.set("orgId", input.orgId);
  }
  if (input.error) {
    target.searchParams.set("error", input.error);
  }
  return target;
}

export async function GET(req: Request) {
  try {
    const scope = await resolveIntegrationAdminScope(req);
    if (!isJobberConfigured()) {
      return NextResponse.redirect(buildSettingsUrl(req, { ...scope, error: "jobber_not_configured" }));
    }

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
