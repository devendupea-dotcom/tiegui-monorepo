import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertOrgReadAccess,
  requireAppApiActor,
  resolveActorOrgId,
} from "@/lib/app-api-permissions";
import { resolveOrganizationLogoUrl } from "@/lib/organization-logo";
import { checkSlidingWindowLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const actor = await requireAppApiActor();

    const rate = await checkSlidingWindowLimit({
      identifier: actor.id,
      prefix: "rl:branding:logo:signed-url",
      limit: 120,
      windowSeconds: 60,
    });

    if (!rate.ok) {
      return NextResponse.json(
        { ok: false, error: "Too many requests. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
      );
    }

    const requestUrl = new URL(req.url);
    const requestedOrgId = requestUrl.searchParams.get("orgId");
    const orgId = await resolveActorOrgId({ actor, requestedOrgId });
    assertOrgReadAccess(actor, orgId);

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        logoPhotoId: true,
      },
    });

    if (!org) {
      throw new AppApiError("Organization not found.", 404);
    }

    if (!org.logoPhotoId) {
      return NextResponse.json({ ok: true, url: null });
    }

    const signedUrl = await resolveOrganizationLogoUrl({
      orgId,
      logoPhotoId: org.logoPhotoId,
    });

    return NextResponse.json({ ok: true, url: signedUrl });
  } catch (error) {
    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to sign logo URL.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
