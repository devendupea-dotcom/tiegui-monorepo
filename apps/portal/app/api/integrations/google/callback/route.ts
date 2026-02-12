import { NextResponse } from "next/server";
import { enqueueGoogleSyncJob } from "@/lib/integrations/google-sync";
import { saveGoogleAccount } from "@/lib/integrations/google-account-store";
import { consumeGoogleOAuthState } from "@/lib/integrations/google-oauth-state";
import { exchangeGoogleCodeForTokens, listGoogleCalendars } from "@/lib/integrations/googleClient";
import { assertOrgAccess, requireIntegrationSessionUser } from "@/lib/integrations/scope";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code")?.trim();
  const state = url.searchParams.get("state")?.trim();
  const oauthError = url.searchParams.get("error")?.trim();

  if (oauthError) {
    return NextResponse.redirect(
      new URL(`/app/settings/integrations?error=google-oauth-${encodeURIComponent(oauthError)}`, url.origin),
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL("/app/settings/integrations?error=google-missing-code", url.origin));
  }

  const oauthState = await consumeGoogleOAuthState(state);
  if (!oauthState) {
    return NextResponse.redirect(new URL("/app/settings/integrations?error=google-invalid-state", url.origin));
  }

  try {
    const user = await requireIntegrationSessionUser();
    if (!user.id || oauthState.userId !== user.id) {
      return NextResponse.redirect(new URL("/app/settings/integrations?error=google-invalid-user", url.origin));
    }

    assertOrgAccess(user, oauthState.orgId);

    const token = await exchangeGoogleCodeForTokens({
      code,
      redirectUri: oauthState.redirectUri,
    });

    const calendars = await listGoogleCalendars({
      accessToken: token.accessToken,
    });
    const primaryCalendar = calendars.find((item) => item.primary) || calendars[0];
    const primaryCalendarId = primaryCalendar?.id || "primary";
    const primaryEmail =
      primaryCalendar && primaryCalendar.id.includes("@") ? primaryCalendar.id : user.email || null;
    const writeScopeGranted = token.scopes.includes("https://www.googleapis.com/auth/calendar.events");
    const readCalendarIds = [primaryCalendarId];
    const blockRules = {
      [primaryCalendarId]: {
        blockIfBusyOnly: true,
        blockAllDay: true,
      },
    };

    await saveGoogleAccount({
      orgId: oauthState.orgId,
      userId: oauthState.userId,
      googleEmail: primaryEmail,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: token.expiresAt,
      scopes: token.scopes,
      isEnabled: true,
      writeCalendarId: writeScopeGranted ? primaryCalendarId : null,
      readCalendarIds,
      blockAvailabilityRules: blockRules,
    });

    await enqueueGoogleSyncJob({
      orgId: oauthState.orgId,
      userId: oauthState.userId,
      action: "PULL_CALENDARS",
    });

    return NextResponse.redirect(
      new URL(
        `/app/settings/integrations?orgId=${encodeURIComponent(oauthState.orgId)}&saved=google-connected`,
        url.origin,
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "google-callback-failed";
    return NextResponse.redirect(
      new URL(
        `/app/settings/integrations?orgId=${encodeURIComponent(oauthState.orgId)}&error=${encodeURIComponent(message)}`,
        url.origin,
      ),
    );
  }
}
