import { NextResponse } from "next/server";
import { createGoogleOAuthState } from "@/lib/integrations/google-oauth-state";
import {
  buildGoogleAuthorizeUrl,
  getGoogleScopes,
  resolveGoogleRedirectUri,
} from "@/lib/integrations/googleClient";
import { isGoogleConfigured } from "@/lib/integrations/provider-config";
import {
  IntegrationScopeError,
  resolveIntegrationAdminScope,
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
    const scope = await resolveIntegrationAdminScope(req);
    if (!scope.user.id) {
      throw new IntegrationScopeError("Unauthorized", 401);
    }
    if (!isGoogleConfigured()) {
      return NextResponse.redirect(buildSettingsUrl(req, { ...scope, error: "google_not_configured" }));
    }

    const url = new URL(req.url);
    const writeRequested = url.searchParams.get("write") === "1" || url.searchParams.get("mode") === "write";
    const origin = `${url.protocol}//${url.host}`;
    const redirectUri = resolveGoogleRedirectUri(origin);
    const scopes = getGoogleScopes({ wantsWrite: writeRequested });
    const state = await createGoogleOAuthState({
      orgId: scope.orgId,
      userId: scope.user.id,
      redirectUri,
      scopes,
      wantsWrite: writeRequested,
    });

    return NextResponse.redirect(
      buildGoogleAuthorizeUrl({
        state,
        redirectUri,
        scopes,
      }),
    );
  } catch (error) {
    if (error instanceof IntegrationScopeError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to start Google OAuth.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
