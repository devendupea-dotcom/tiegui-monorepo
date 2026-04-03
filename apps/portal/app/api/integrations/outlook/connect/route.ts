import { NextResponse } from "next/server";
import { createIntegrationOAuthState } from "@/lib/integrations/oauth-state";
import {
  buildOutlookAuthorizeUrl,
  resolveOutlookRedirectUri,
} from "@/lib/integrations/outlookClient";
import { isOutlookConfigured } from "@/lib/integrations/provider-config";
import {
  IntegrationScopeError,
  resolveIntegrationOrgScope,
} from "@/lib/integrations/scope";

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
    const scope = await resolveIntegrationOrgScope(req);
    if (!scope.user.id) {
      throw new IntegrationScopeError("Unauthorized", 401);
    }
    if (!isOutlookConfigured()) {
      return NextResponse.redirect(buildSettingsUrl(req, { ...scope, error: "outlook_not_configured" }));
    }

    const url = new URL(req.url);
    const origin = `${url.protocol}//${url.host}`;
    const redirectUri = resolveOutlookRedirectUri(origin);
    const state = await createIntegrationOAuthState({
      orgId: scope.orgId,
      provider: "OUTLOOK",
      redirectUri,
    });

    return NextResponse.redirect(
      buildOutlookAuthorizeUrl({
        state,
        redirectUri,
      }),
    );
  } catch (error) {
    if (error instanceof IntegrationScopeError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to start Outlook OAuth.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
