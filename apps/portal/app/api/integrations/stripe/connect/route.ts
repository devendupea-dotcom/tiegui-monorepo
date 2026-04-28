import { NextResponse } from "next/server";
import { isStripeConfigured } from "@/lib/integrations/provider-config";
import {
  createStripeOnboardingUrl,
} from "@/lib/integrations/stripe-connect";
import {
  IntegrationScopeError,
  resolveIntegrationAdminScope,
} from "@/lib/integrations/scope";
import { getBaseUrlFromRequest } from "@/lib/urls";

export const dynamic = "force-dynamic";

function buildSettingsUrl(req: Request, input: { orgId: string; internalUser: boolean; error?: string }) {
  const target = new URL("/app/settings/integrations", getBaseUrlFromRequest(req));
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
    if (!isStripeConfigured()) {
      return NextResponse.redirect(buildSettingsUrl(req, { ...scope, error: "stripe_not_configured" }));
    }

    const onboardingUrl = await createStripeOnboardingUrl({
      orgId: scope.orgId,
      origin: getBaseUrlFromRequest(req),
    });

    return NextResponse.redirect(onboardingUrl);
  } catch (error) {
    if (error instanceof IntegrationScopeError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to start Stripe connect.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
