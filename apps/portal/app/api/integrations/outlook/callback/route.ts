import { NextResponse } from "next/server";
import { saveIntegrationAccount } from "@/lib/integrations/account-store";
import { consumeIntegrationOAuthState } from "@/lib/integrations/oauth-state";
import {
  exchangeOutlookCodeForTokens,
  getOutlookProfile,
} from "@/lib/integrations/outlookClient";
import { assertOrgAccess, requireIntegrationSessionUser } from "@/lib/integrations/scope";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code")?.trim();
  const state = url.searchParams.get("state")?.trim();
  const oauthError = url.searchParams.get("error")?.trim();

  if (oauthError) {
    return NextResponse.redirect(
      new URL(`/app/settings/integrations?error=outlook-oauth-${encodeURIComponent(oauthError)}`, url.origin),
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL("/app/settings/integrations?error=outlook-missing-code", url.origin));
  }

  const oauthState = await consumeIntegrationOAuthState({
    provider: "OUTLOOK",
    state,
  });

  if (!oauthState) {
    return NextResponse.redirect(new URL("/app/settings/integrations?error=outlook-invalid-state", url.origin));
  }

  try {
    const user = await requireIntegrationSessionUser();
    assertOrgAccess(user, oauthState.orgId);

    const token = await exchangeOutlookCodeForTokens({
      code,
      redirectUri: oauthState.redirectUri,
    });
    const profile = await getOutlookProfile(token.accessToken);

    await saveIntegrationAccount({
      orgId: oauthState.orgId,
      provider: "OUTLOOK",
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: token.expiresAt,
      scopes: token.scopes,
      providerAccountId: profile.id,
      providerEmail: profile.email,
      providerDisplayName: profile.displayName,
      status: "CONNECTED",
    });

    return NextResponse.redirect(
      new URL(
        `/app/settings/integrations?orgId=${encodeURIComponent(oauthState.orgId)}&saved=outlook-connected`,
        url.origin,
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "outlook-callback-failed";
    return NextResponse.redirect(
      new URL(
        `/app/settings/integrations?orgId=${encodeURIComponent(oauthState.orgId)}&error=${encodeURIComponent(message)}`,
        url.origin,
      ),
    );
  }
}
