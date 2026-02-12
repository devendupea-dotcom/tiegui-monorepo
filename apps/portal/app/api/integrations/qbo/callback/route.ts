import { NextResponse } from "next/server";
import { saveIntegrationAccount } from "@/lib/integrations/account-store";
import { consumeIntegrationOAuthState } from "@/lib/integrations/oauth-state";
import { exchangeQboCodeForTokens } from "@/lib/integrations/qboClient";
import { assertOrgAccess, requireIntegrationSessionUser } from "@/lib/integrations/scope";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code")?.trim();
  const state = url.searchParams.get("state")?.trim();
  const realmId = url.searchParams.get("realmId")?.trim();
  const oauthError = url.searchParams.get("error")?.trim();

  if (oauthError) {
    return NextResponse.redirect(new URL(`/app/settings/integrations?error=qbo-oauth-${encodeURIComponent(oauthError)}`, url.origin));
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL("/app/settings/integrations?error=qbo-missing-code", url.origin));
  }

  const oauthState = await consumeIntegrationOAuthState({
    provider: "QBO",
    state,
  });

  if (!oauthState) {
    return NextResponse.redirect(new URL("/app/settings/integrations?error=qbo-invalid-state", url.origin));
  }

  try {
    const user = await requireIntegrationSessionUser();
    assertOrgAccess(user, oauthState.orgId);

    const token = await exchangeQboCodeForTokens({
      code,
      redirectUri: oauthState.redirectUri,
    });

    await saveIntegrationAccount({
      orgId: oauthState.orgId,
      provider: "QBO",
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: token.expiresAt,
      realmId: realmId || null,
      scopes: token.scopes,
      status: "CONNECTED",
    });

    return NextResponse.redirect(
      new URL(
        `/app/settings/integrations?orgId=${encodeURIComponent(oauthState.orgId)}&saved=qbo-connected`,
        url.origin,
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "qbo-callback-failed";
    return NextResponse.redirect(
      new URL(
        `/app/settings/integrations?orgId=${encodeURIComponent(oauthState.orgId)}&error=${encodeURIComponent(message)}`,
        url.origin,
      ),
    );
  }
}
