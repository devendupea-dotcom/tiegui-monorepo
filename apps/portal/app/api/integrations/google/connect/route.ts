import { NextResponse } from "next/server";
import { createGoogleOAuthState } from "@/lib/integrations/google-oauth-state";
import {
  buildGoogleAuthorizeUrl,
  getGoogleScopes,
  resolveGoogleRedirectUri,
} from "@/lib/integrations/googleClient";
import {
  IntegrationScopeError,
  resolveIntegrationOrgScope,
} from "@/lib/integrations/scope";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const scope = await resolveIntegrationOrgScope(req);
    if (!scope.user.id) {
      throw new IntegrationScopeError("Unauthorized", 401);
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
