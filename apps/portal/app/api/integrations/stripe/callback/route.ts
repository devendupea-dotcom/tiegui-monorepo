import { NextResponse } from "next/server";
import { consumeIntegrationOAuthState } from "@/lib/integrations/oauth-state";
import {
  exchangeStripeCodeForConnection,
  fetchStripeAccountSummary,
  saveOrganizationStripeConnection,
  setStripeConnectionLastError,
} from "@/lib/integrations/stripe-connect";
import { assertOrgAccess, requireIntegrationSessionUser } from "@/lib/integrations/scope";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code")?.trim();
  const state = url.searchParams.get("state")?.trim();
  const oauthError = url.searchParams.get("error")?.trim();

  if (oauthError) {
    return NextResponse.redirect(
      new URL(`/app/settings/integrations?error=stripe-oauth-${encodeURIComponent(oauthError)}`, url.origin),
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL("/app/settings/integrations?error=stripe-missing-code", url.origin));
  }

  const oauthState = await consumeIntegrationOAuthState({
    provider: "STRIPE",
    state,
  });

  if (!oauthState) {
    return NextResponse.redirect(new URL("/app/settings/integrations?error=stripe-invalid-state", url.origin));
  }

  try {
    const user = await requireIntegrationSessionUser();
    await assertOrgAccess(user, oauthState.orgId);

    const connection = await exchangeStripeCodeForConnection({ code });
    const accountSummary = await fetchStripeAccountSummary({
      stripeAccountId: connection.stripeAccountId,
    });

    await saveOrganizationStripeConnection({
      orgId: oauthState.orgId,
      summary: {
        ...accountSummary,
        livemode: connection.livemode,
      },
      connectedAt: new Date(),
    });

    return NextResponse.redirect(
      new URL(
        `/app/settings/integrations?orgId=${encodeURIComponent(oauthState.orgId)}&saved=stripe-connected`,
        url.origin,
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "stripe-callback-failed";
    await setStripeConnectionLastError({
      orgId: oauthState.orgId,
      error: message,
    });
    return NextResponse.redirect(
      new URL(
        `/app/settings/integrations?orgId=${encodeURIComponent(oauthState.orgId)}&error=${encodeURIComponent(message)}`,
        url.origin,
      ),
    );
  }
}
