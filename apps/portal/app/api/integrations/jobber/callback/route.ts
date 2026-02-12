import { NextResponse } from "next/server";
import { saveIntegrationAccount } from "@/lib/integrations/account-store";
import { exchangeJobberCodeForTokens } from "@/lib/integrations/jobberClient";
import { consumeIntegrationOAuthState } from "@/lib/integrations/oauth-state";
import { assertOrgAccess, requireIntegrationSessionUser } from "@/lib/integrations/scope";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code")?.trim();
  const state = url.searchParams.get("state")?.trim();
  const oauthError = url.searchParams.get("error")?.trim();

  if (oauthError) {
    return NextResponse.redirect(new URL(`/app/settings/integrations?error=jobber-oauth-${encodeURIComponent(oauthError)}`, url.origin));
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL("/app/settings/integrations?error=jobber-missing-code", url.origin));
  }

  const oauthState = await consumeIntegrationOAuthState({
    provider: "JOBBER",
    state,
  });

  if (!oauthState) {
    return NextResponse.redirect(new URL("/app/settings/integrations?error=jobber-invalid-state", url.origin));
  }

  try {
    const user = await requireIntegrationSessionUser();
    assertOrgAccess(user, oauthState.orgId);

    const token = await exchangeJobberCodeForTokens({
      code,
      redirectUri: oauthState.redirectUri,
    });

    await saveIntegrationAccount({
      orgId: oauthState.orgId,
      provider: "JOBBER",
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: token.expiresAt,
      scopes: token.scopes,
      status: "CONNECTED",
    });

    return NextResponse.redirect(
      new URL(
        `/app/settings/integrations?orgId=${encodeURIComponent(oauthState.orgId)}&saved=jobber-connected`,
        url.origin,
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "jobber-callback-failed";
    return NextResponse.redirect(
      new URL(
        `/app/settings/integrations?orgId=${encodeURIComponent(oauthState.orgId)}&error=${encodeURIComponent(message)}`,
        url.origin,
      ),
    );
  }
}
