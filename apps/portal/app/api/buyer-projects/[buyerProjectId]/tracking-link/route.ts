import { NextResponse } from "next/server";
import {
  AppApiError,
  assertOrgWriteAccess,
  requireAppApiActor,
} from "@/lib/app-api-permissions";
import { createBuyerProjectShareToken } from "@/lib/buyer-projects";
import { prisma } from "@/lib/prisma";
import { capturePortalError } from "@/lib/telemetry";
import { getBaseUrlFromRequest } from "@/lib/urls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    buyerProjectId: string;
  }>;
};

function buildTrackingSmsDraft(input: {
  orgName: string;
  buyerName: string;
  selectedHomeTitle: string | null;
  trackingUrl: string;
}): string {
  const homeLine = input.selectedHomeTitle
    ? ` for ${input.selectedHomeTitle}`
    : "";
  return `Hi ${input.buyerName}, here is your private ${input.orgName} project room${homeLine}: ${input.trackingUrl}. Reply here with any questions.`;
}

export async function POST(req: Request, props: RouteContext) {
  const params = await props.params;
  try {
    const actor = await requireAppApiActor();
    const buyerProject = await prisma.buyerProject.findUnique({
      where: { id: params.buyerProjectId },
      select: {
        id: true,
        orgId: true,
        buyerName: true,
        selectedHomeTitle: true,
        org: {
          select: {
            name: true,
            portalVertical: true,
          },
        },
      },
    });

    if (!buyerProject) {
      throw new AppApiError("Buyer project not found.", 404);
    }

    assertOrgWriteAccess(actor, buyerProject.orgId);

    if (buyerProject.org.portalVertical !== "HOMEBUILDER") {
      throw new AppApiError("Buyer project tracking links are only available for homebuilder workspaces.", 403);
    }

    const { token, tokenHash } = createBuyerProjectShareToken();
    await prisma.buyerProjectShareLink.create({
      data: {
        orgId: buyerProject.orgId,
        buyerProjectId: buyerProject.id,
        createdByUserId: actor.id,
        tokenHash,
      },
    });

    const trackingUrl = `${getBaseUrlFromRequest(req).replace(/\/$/, "")}/buyer-project/${token}`;
    return NextResponse.json({
      ok: true,
      tracking: {
        url: trackingUrl,
        smsDraft: buildTrackingSmsDraft({
          orgName: buyerProject.org.name,
          buyerName: buyerProject.buyerName,
          selectedHomeTitle: buyerProject.selectedHomeTitle,
          trackingUrl,
        }),
      },
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "POST /api/buyer-projects/[buyerProjectId]/tracking-link",
      buyerProjectId: params.buyerProjectId,
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to create buyer project tracking link.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
