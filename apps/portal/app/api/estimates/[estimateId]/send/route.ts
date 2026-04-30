import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertOrgWriteAccess,
  requireAppApiActor,
} from "@/lib/app-api-permissions";
import { buildEstimateShareEmailDraft } from "@/lib/estimate-share";
import { createEstimateShareLink } from "@/lib/estimate-share-store";
import { getEstimateCustomerFacingIssues } from "@/lib/estimates";
import { markEstimateSent } from "@/lib/estimates-store";
import { getDecryptedAccessToken } from "@/lib/integrations/account-store";
import { refreshOutlookTokens, sendOutlookMail } from "@/lib/integrations/outlookClient";
import { capturePortalError } from "@/lib/telemetry";
import { getBaseUrlFromRequest } from "@/lib/urls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    estimateId: string;
  }>;
};

type SendEstimatePayload = {
  note?: unknown;
  recipientName?: unknown;
  recipientEmail?: unknown;
  recipientPhoneE164?: unknown;
  expiresAt?: unknown;
};

async function getScopedEstimateOrThrow(estimateId: string) {
  const estimate = await prisma.estimate.findUnique({
    where: { id: estimateId },
    select: {
      id: true,
      orgId: true,
      status: true,
      archivedAt: true,
      estimateNumber: true,
      title: true,
      customerName: true,
      siteAddress: true,
      projectType: true,
      total: true,
      validUntil: true,
      lead: {
        select: {
          contactName: true,
          businessName: true,
          phoneE164: true,
        },
      },
      org: {
        select: {
          name: true,
          phone: true,
          email: true,
          website: true,
        },
      },
      _count: {
        select: {
          lineItems: true,
        },
      },
      shareLinks: {
        orderBy: [{ createdAt: "desc" }],
        take: 1,
        select: {
          recipientName: true,
          recipientEmail: true,
          recipientPhoneE164: true,
        },
      },
    },
  });

  if (!estimate) {
    throw new AppApiError("Estimate not found.", 404);
  }

  return estimate;
}

export async function POST(req: Request, props: RouteContext) {
  const params = await props.params;
  try {
    const actor = await requireAppApiActor();
    const scoped = await getScopedEstimateOrThrow(params.estimateId);
    assertOrgWriteAccess(actor, scoped.orgId);

    if (scoped.archivedAt) {
      throw new AppApiError("Archived estimates cannot be sent.", 400);
    }

    if (scoped.status === "CONVERTED" || scoped.status === "APPROVED") {
      throw new AppApiError(
        "This estimate is no longer sendable from the internal portal flow.",
        400,
      );
    }

    const sendIssues = getEstimateCustomerFacingIssues({
      title: scoped.title,
      customerName: scoped.customerName,
      leadLabel: scoped.lead?.contactName || scoped.lead?.businessName || scoped.lead?.phoneE164 || "",
      lineItemCount: scoped._count.lineItems,
      total: Number(scoped.total),
    });
    if (sendIssues.length > 0) {
      throw new AppApiError(`Estimate is not ready to send. ${sendIssues.join(" ")}`, 400);
    }

    const payload = (await req.json().catch(() => null)) as SendEstimatePayload | null;
    const latestShare = scoped.shareLinks[0] || null;
    const recipientName =
      (typeof payload?.recipientName === "string" ? payload.recipientName.trim() : "") ||
      latestShare?.recipientName ||
      scoped.customerName ||
      "";
    const recipientEmail =
      (typeof payload?.recipientEmail === "string" ? payload.recipientEmail.trim() : "") || latestShare?.recipientEmail || "";
    const recipientPhoneE164 =
      (typeof payload?.recipientPhoneE164 === "string" ? payload.recipientPhoneE164.trim() : "") ||
      latestShare?.recipientPhoneE164 ||
      "";
    const note = typeof payload?.note === "string" ? payload.note : null;

    let delivery: "manual-share" | "outlook" = "manual-share";
    let message = "Secure estimate link created. Copy the link and send it manually by email or text.";
    let shareUrl: string | null = null;
    let shareExpiresAt: string | null = null;

    const outlookConnected = await prisma.integrationAccount.findUnique({
      where: {
        orgId_provider: {
          orgId: scoped.orgId,
          provider: "OUTLOOK",
        },
      },
      select: {
        id: true,
        status: true,
        providerEmail: true,
      },
    });

    if (outlookConnected?.status === "CONNECTED") {
      if (!recipientEmail) {
        throw new AppApiError("Add a recipient email in Share & Approval before sending through Outlook.", 400);
      }

      const share = await createEstimateShareLink({
        orgId: scoped.orgId,
        estimateId: scoped.id,
        actorId: actor.id,
        baseUrl: getBaseUrlFromRequest(req),
        payload: {
          recipientName,
          recipientEmail,
          recipientPhoneE164,
          expiresAt: payload?.expiresAt,
        },
      });

      const { accessToken } = await getDecryptedAccessToken({
        orgId: scoped.orgId,
        provider: "OUTLOOK",
        refresh: refreshOutlookTokens,
      });

      const draft = buildEstimateShareEmailDraft({
        estimate: {
          estimateNumber: scoped.estimateNumber,
          title: scoped.title,
          customerName: scoped.customerName || "",
          siteAddress: scoped.siteAddress || "",
          projectType: scoped.projectType || "",
          total: Number(scoped.total),
          validUntil: scoped.validUntil ? scoped.validUntil.toISOString() : null,
        },
        shareUrl: share.shareUrl,
        recipientName,
        senderName: scoped.org.name,
        senderPhone: scoped.org.phone,
        senderEmail: scoped.org.email,
        senderWebsite: scoped.org.website,
      });

      await sendOutlookMail({
        accessToken,
        to: recipientEmail,
        subject: draft.subject,
        bodyText: draft.body,
      });

      delivery = "outlook";
      message = `Estimate emailed from Outlook to ${recipientEmail}.`;
      shareUrl = share.shareUrl;
      shareExpiresAt = share.expiresAt;
    }

    if (delivery === "manual-share") {
      const share = await createEstimateShareLink({
        orgId: scoped.orgId,
        estimateId: scoped.id,
        actorId: actor.id,
        baseUrl: getBaseUrlFromRequest(req),
        payload: {
          recipientName,
          recipientEmail,
          recipientPhoneE164,
          expiresAt: payload?.expiresAt,
        },
      });

      shareUrl = share.shareUrl;
      shareExpiresAt = share.expiresAt;
    }

    const estimate = await markEstimateSent({
      orgId: scoped.orgId,
      estimateId: scoped.id,
      actorId: actor.id,
      note,
    });

    return NextResponse.json({
      ok: true,
      delivery,
      message,
      estimate,
      share: shareUrl
        ? {
            url: shareUrl,
            expiresAt: shareExpiresAt,
          }
        : undefined,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "POST /api/estimates/[estimateId]/send",
      estimateId: params.estimateId,
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to mark estimate as sent.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
