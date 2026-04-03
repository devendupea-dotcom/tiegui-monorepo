import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertOrgWriteAccess,
  requireAppApiActor,
} from "@/lib/app-api-permissions";
import { buildPurchaseOrderSendDraft } from "@/lib/purchase-orders-store";
import { canTransitionPurchaseOrderStatus } from "@/lib/purchase-orders";
import { getDecryptedAccessToken } from "@/lib/integrations/account-store";
import { refreshOutlookTokens, sendOutlookMail } from "@/lib/integrations/outlookClient";
import { capturePortalError } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: { poId: string };
};

export async function POST(_req: Request, { params }: RouteContext) {
  try {
    const actor = await requireAppApiActor();

    const scoped = await prisma.purchaseOrder.findUnique({
      where: { id: params.poId },
      select: { orgId: true },
    });

    if (!scoped) {
      throw new AppApiError("Purchase order not found.", 404);
    }

    assertOrgWriteAccess(actor, scoped.orgId);

    const draft = await buildPurchaseOrderSendDraft({
      orgId: scoped.orgId,
      purchaseOrderId: params.poId,
    });

    const outlookConnected = await prisma.integrationAccount.findUnique({
      where: {
        orgId_provider: {
          orgId: scoped.orgId,
          provider: "OUTLOOK",
        },
      },
      select: {
        status: true,
      },
    });

    if (outlookConnected?.status === "CONNECTED" && draft.recipientEmail) {
      const { accessToken } = await getDecryptedAccessToken({
        orgId: scoped.orgId,
        provider: "OUTLOOK",
        refresh: refreshOutlookTokens,
      });

      await sendOutlookMail({
        accessToken,
        to: draft.recipientEmail,
        subject: draft.subject,
        bodyText: draft.body,
      });

      if (canTransitionPurchaseOrderStatus(draft.purchaseOrder.status, "SENT")) {
        await prisma.purchaseOrder.update({
          where: { id: draft.purchaseOrder.id },
          data: {
            status: "SENT",
          },
        });
      }

      const refreshedOrder = await buildPurchaseOrderSendDraft({
        orgId: scoped.orgId,
        purchaseOrderId: params.poId,
      });

      return NextResponse.json({
        ok: true,
        delivery: "outlook",
        recipientEmail: refreshedOrder.recipientEmail,
        subject: refreshedOrder.subject,
        body: refreshedOrder.body,
        mailtoUrl: refreshedOrder.mailtoUrl,
        message: `Purchase order sent from Outlook to ${refreshedOrder.recipientEmail}.`,
        purchaseOrder: refreshedOrder.purchaseOrder,
      });
    }

    return NextResponse.json({
      ok: true,
      delivery: "manual-draft",
      recipientEmail: draft.recipientEmail,
      subject: draft.subject,
      body: draft.body,
      mailtoUrl: draft.mailtoUrl,
      message: "Email draft prepared. Send it from your mail app or connect Outlook for one-click send.",
      purchaseOrder: draft.purchaseOrder,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "POST /api/purchase-orders/[poId]/send",
      purchaseOrderId: params.poId,
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to prepare purchase order email.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
