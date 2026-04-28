import { NextResponse } from "next/server";
import {
  fetchStripeAccountSummary,
  setStripeConnectionLastError,
  saveOrganizationStripeConnection,
} from "@/lib/integrations/stripe-connect";
import { assertIntegrationAdminAccess, requireIntegrationSessionUser } from "@/lib/integrations/scope";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const orgId = url.searchParams.get("orgId")?.trim();
  if (!orgId) {
    return NextResponse.redirect(new URL("/app/settings/integrations?error=stripe-missing-org", url.origin));
  }

  try {
    const user = await requireIntegrationSessionUser();
    await assertIntegrationAdminAccess(user, orgId);

    const existing = await prisma.organizationStripeConnection.findUnique({
      where: { orgId },
      select: {
        stripeAccountId: true,
      },
    });

    if (!existing?.stripeAccountId) {
      throw new Error("stripe-connection-not-started");
    }

    const accountSummary = await fetchStripeAccountSummary({
      stripeAccountId: existing.stripeAccountId,
    });

    await saveOrganizationStripeConnection({
      orgId,
      summary: accountSummary,
      connectedAt: new Date(),
    });

    return NextResponse.redirect(
      new URL(
        `/app/settings/integrations?orgId=${encodeURIComponent(orgId)}&saved=stripe-connected`,
        url.origin,
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "stripe-callback-failed";
    await setStripeConnectionLastError({
      orgId,
      error: message,
    });
    return NextResponse.redirect(
      new URL(
        `/app/settings/integrations?orgId=${encodeURIComponent(orgId)}&error=${encodeURIComponent(message)}`,
        url.origin,
      ),
    );
  }
}
