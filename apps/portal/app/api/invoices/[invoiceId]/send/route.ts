import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertOrgWriteAccess,
  canManageAnyOrgJobs,
  requireAppApiActor,
} from "@/lib/app-api-permissions";
import {
  assertWorkerCanViewInvoice,
  recordInvoiceCollectionAttempt,
  sendInvoiceDelivery,
} from "@/lib/invoice-delivery";
import { getInvoiceActionContext } from "@/lib/invoices";
import {
  buildScopedClientMutationIdempotencyKey,
  claimClientMutationReceipt,
  normalizeClientMutationIdempotencyKey,
  releaseClientMutationReceipt,
  storeClientMutationReceiptResponse,
} from "@/lib/client-mutation-receipts";
import { capturePortalError } from "@/lib/telemetry";
import { getBaseUrlFromRequest } from "@/lib/urls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "POST /api/invoices/[invoiceId]/send";

type RouteContext = {
  params: Promise<{
    invoiceId: string;
  }>;
};

type SendInvoicePayload = {
  message?: unknown;
  mode?: unknown;
  refreshPayLink?: unknown;
};

type SendInvoiceResponse = {
  error?: string;
  ok?: boolean;
  reminderCount?: number;
  reminderSentAt?: string;
  sentAt?: string;
  status?: string;
  success?: boolean;
};

export async function POST(req: Request, props: RouteContext) {
  const params = await props.params;
  let claimedReceiptId: string | null = null;
  let sendMode: "invoice" | "reminder" = "invoice";
  let actorId: string | null = null;
  let reminderAttemptContext: { invoiceId: string; orgId: string } | null = null;
  let canRecordReminderAttempt = false;

  try {
    const actor = await requireAppApiActor();
    actorId = actor.id;

    const payload = (await req.json().catch(() => null)) as SendInvoicePayload | null;
    const customMessage =
      typeof payload?.message === "string" ? payload.message.trim() : "";
    sendMode = payload?.mode === "reminder" ? "reminder" : "invoice";
    const refreshPayLink = payload?.refreshPayLink === true;

    if (customMessage.length > 4000) {
      throw new AppApiError("Custom invoice message is too long.", 400);
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id: params.invoiceId },
      select: {
        id: true,
        orgId: true,
        legacyLeadId: true,
        sourceJobId: true,
        sourceJob: {
          select: {
            id: true,
            leadId: true,
          },
        },
      },
    });

    if (!invoice) {
      throw new AppApiError("Invoice not found.", 404);
    }

    reminderAttemptContext = {
      invoiceId: invoice.id,
      orgId: invoice.orgId,
    };

    assertOrgWriteAccess(actor, invoice.orgId);

    const invoiceActionContext = getInvoiceActionContext({
      legacyLeadId: invoice.legacyLeadId,
      sourceJobId: invoice.sourceJobId,
      sourceJob: invoice.sourceJob,
    });

    if (
      !actor.internalUser &&
      !canManageAnyOrgJobs(actor) &&
      actor.calendarAccessRole === "WORKER"
    ) {
      await assertWorkerCanViewInvoice({
        actorId: actor.id,
        orgId: invoice.orgId,
        invoiceId: invoice.id,
        leadId: invoiceActionContext.leadId,
      });
    }

    canRecordReminderAttempt = true;

    const requestIdempotencyKey = normalizeClientMutationIdempotencyKey(
      req.headers.get("Idempotency-Key"),
    );
    if (requestIdempotencyKey) {
      const claim = await prisma.$transaction((tx) =>
        claimClientMutationReceipt(tx, {
          orgId: invoice.orgId,
          route: ROUTE,
          idempotencyKey: buildScopedClientMutationIdempotencyKey(
            "invoice-send",
            requestIdempotencyKey,
          ),
        }),
      );

      if (claim.status === "completed") {
        return NextResponse.json(claim.responseJson as SendInvoiceResponse);
      }

      if (claim.status === "in_flight") {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Invoice send is already in progress. Refresh the invoice in a moment.",
          },
          { status: 409 },
        );
      }

      claimedReceiptId = claim.receiptId;
    }

    const responsePayload = await sendInvoiceDelivery({
      invoiceId: invoice.id,
      baseUrl: getBaseUrlFromRequest(req),
      customMessage,
      sendMode,
      refreshPayLink,
      actorUserId: actor.id,
      source: "MANUAL",
    });

    if (claimedReceiptId) {
      await prisma.$transaction((tx) =>
        storeClientMutationReceiptResponse(tx, {
          receiptId: claimedReceiptId!,
          responseJson: responsePayload as Prisma.InputJsonValue,
        }),
      );
    }

    return NextResponse.json(responsePayload);
  } catch (error) {
    if (
      sendMode === "reminder" &&
      canRecordReminderAttempt &&
      reminderAttemptContext
    ) {
      await recordInvoiceCollectionAttempt({
        orgId: reminderAttemptContext.orgId,
        invoiceId: reminderAttemptContext.invoiceId,
        actorUserId: actorId,
        source: "MANUAL",
        outcome: "FAILED",
        reason:
          error instanceof Error ? error.message : "Failed to send invoice reminder.",
        dedupeWindowMinutes: 15,
      }).catch(() => undefined);
    }

    if (claimedReceiptId) {
      const responseJson =
        error &&
        typeof error === "object" &&
        "emailPossiblySent" in error &&
        Reflect.get(error, "emailPossiblySent") === true
          ? ({
              ok: false,
              error:
                "Invoice email may already have been sent. Refresh the invoice before retrying.",
            } satisfies Prisma.InputJsonValue)
          : null;

      if (responseJson) {
        await prisma
          .$transaction((tx) =>
            storeClientMutationReceiptResponse(tx, {
              receiptId: claimedReceiptId!,
              responseJson,
            }),
          )
          .catch(() => undefined);
      } else {
        await prisma
          .$transaction((tx) =>
            releaseClientMutationReceipt(tx, {
              receiptId: claimedReceiptId!,
            }),
          )
          .catch(() => undefined);
      }
    }

    await capturePortalError(error, {
      route: ROUTE,
      invoiceId: params.invoiceId,
    });

    if (error instanceof AppApiError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: error.status },
      );
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return NextResponse.json(
        { ok: false, error: "Failed to update invoice send status." },
        { status: 500 },
      );
    }

    const message =
      error instanceof Error ? error.message : "Failed to send invoice.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
