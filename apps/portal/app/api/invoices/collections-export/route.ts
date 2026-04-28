import { NextResponse } from "next/server";
import { Prisma, type BillingInvoiceStatus } from "@prisma/client";
import {
  AppApiError,
  requireAppApiActor,
  resolveActorOrgId,
} from "@/lib/app-api-permissions";
import { toCsvRows } from "@/lib/integrations/csv";
import {
  buildInvoiceWorkerLeadAccessWhere,
  formatInvoiceNumber,
  getInvoiceReadJobContext,
  toMoneyDecimal,
} from "@/lib/invoices";
import {
  canSendInvoiceReminder,
  deriveInvoiceCollectionsAgingBucket,
  deriveInvoiceCollectionsEscalationStage,
  deriveInvoiceCollectionsQueueState,
  deriveInvoiceCheckoutRecoveryState,
  isInvoiceCollectionsAgingFilter,
  isInvoiceCollectionsQueueFilter,
  readInvoiceCollectionAttemptMetadata,
} from "@/lib/invoice-collections";
import { prisma } from "@/lib/prisma";
import { isStripeWebhookConfigured } from "@/lib/stripe-client";
import { isInvoiceOnlinePaymentReady } from "@/lib/stripe-invoice-payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPEN_INVOICE_STATUSES: BillingInvoiceStatus[] = [
  "DRAFT",
  "SENT",
  "PARTIAL",
  "OVERDUE",
];

function isBillingStatus(value: string): value is BillingInvoiceStatus {
  return (
    value === "DRAFT" ||
    value === "SENT" ||
    value === "PARTIAL" ||
    value === "PAID" ||
    value === "OVERDUE"
  );
}

function formatCsvMoney(
  value: Prisma.Decimal | number | string | null | undefined,
) {
  return toMoneyDecimal(value).toFixed(2);
}

function formatCsvDate(value: Date | null | undefined) {
  return value ? value.toISOString() : "";
}

export async function GET(req: Request) {
  try {
    const actor = await requireAppApiActor();
    const url = new URL(req.url);
    const orgId = await resolveActorOrgId({
      actor,
      requestedOrgId: url.searchParams.get("orgId"),
    });
    const status = (url.searchParams.get("status") || "").trim().toUpperCase();
    const openOnly = (url.searchParams.get("openOnly") || "").trim();
    const queue = (url.searchParams.get("queue") || "").trim().toLowerCase();
    const aging = (url.searchParams.get("aging") || "").trim().toLowerCase();

    const workerLeadAccessWhere =
      !actor.internalUser && actor.calendarAccessRole === "WORKER"
        ? buildInvoiceWorkerLeadAccessWhere({ actorId: actor.id })
        : null;

    const baseWhere: Prisma.InvoiceWhereInput = {
      orgId,
      ...(workerLeadAccessWhere
        ? {
            OR: [
              {
                sourceJob: {
                  is: {
                    lead: {
                      is: workerLeadAccessWhere,
                    },
                  },
                },
              },
              {
                legacyLead: {
                  is: workerLeadAccessWhere,
                },
              },
            ],
          }
        : {}),
    };

    const where: Prisma.InvoiceWhereInput = {
      ...baseWhere,
    };

    if (isBillingStatus(status)) {
      where.status = status;
    }

    if (openOnly === "1") {
      where.status = where.status ? where.status : { in: OPEN_INVOICE_STATUSES };
    }

    const [rows, stripeConnection, organization] = await Promise.all([
      prisma.invoice.findMany({
        where,
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          total: true,
          amountPaid: true,
          balanceDue: true,
          dueDate: true,
          updatedAt: true,
          sentAt: true,
          lastReminderSentAt: true,
          reminderCount: true,
          customer: {
            select: {
              name: true,
              email: true,
            },
          },
          legacyLead: {
            select: {
              id: true,
              contactName: true,
              businessName: true,
              phoneE164: true,
            },
          },
          sourceJob: {
            select: {
              id: true,
              leadId: true,
              customerName: true,
              serviceType: true,
              projectType: true,
            },
          },
          checkoutSessions: {
            select: {
              status: true,
              checkoutUrl: true,
              expiresAt: true,
              lastError: true,
              createdAt: true,
            },
            orderBy: [{ createdAt: "desc" }],
            take: 1,
          },
          collectionAttempts: {
            select: {
              source: true,
              outcome: true,
              reason: true,
              createdAt: true,
              metadataJson: true,
            },
            orderBy: [{ createdAt: "desc" }],
            take: 1,
          },
        },
        orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }],
        take: 500,
      }),
      prisma.organizationStripeConnection.findUnique({
        where: { orgId },
        select: {
          status: true,
        },
      }),
      prisma.organization.findUnique({
        where: { id: orgId },
        select: {
          invoiceCollectionsEnabled: true,
          invoiceCollectionsAutoSendEnabled: true,
          invoiceFirstReminderLeadDays: true,
          invoiceOverdueReminderCadenceDays: true,
          invoiceCollectionsMaxReminders: true,
          invoiceCollectionsUrgentAfterDays: true,
          invoiceCollectionsFinalAfterDays: true,
        },
      }),
    ]);

    const collectionsSettings = {
      enabled: organization?.invoiceCollectionsEnabled ?? true,
      autoSendEnabled: organization?.invoiceCollectionsAutoSendEnabled ?? false,
      firstReminderLeadDays: organization?.invoiceFirstReminderLeadDays ?? 2,
      overdueReminderCadenceDays:
        organization?.invoiceOverdueReminderCadenceDays ?? 7,
      maxReminders: organization?.invoiceCollectionsMaxReminders ?? 2,
      urgentAfterDays: organization?.invoiceCollectionsUrgentAfterDays ?? 7,
      finalAfterDays: organization?.invoiceCollectionsFinalAfterDays ?? 21,
    };
    const workspaceOnlinePaymentsReady =
      stripeConnection?.status === "ACTIVE" && isStripeWebhookConfigured();

    const exportRows = rows
      .map((row) => {
        const latestCheckoutSession = row.checkoutSessions[0] || null;
        const latestCollectionAttempt = row.collectionAttempts[0] || null;
        const latestCollectionAttemptMetadata =
          readInvoiceCollectionAttemptMetadata(
            latestCollectionAttempt?.metadataJson || null,
          );
        const checkoutRecovery = deriveInvoiceCheckoutRecoveryState({
          status: latestCheckoutSession?.status,
          checkoutUrl: latestCheckoutSession?.checkoutUrl || null,
          expiresAt: latestCheckoutSession?.expiresAt || null,
          lastError: latestCheckoutSession?.lastError || null,
        });
        const queueState = deriveInvoiceCollectionsQueueState({
          status: row.status,
          balanceDue: row.balanceDue,
          dueDate: row.dueDate,
          sentAt: row.sentAt,
          lastReminderSentAt: row.lastReminderSentAt,
          reminderCount: row.reminderCount,
          settings: collectionsSettings,
        });
        const agingBucket = deriveInvoiceCollectionsAgingBucket({
          status: row.status,
          balanceDue: row.balanceDue,
          dueDate: row.dueDate,
        });
        const escalationStage = deriveInvoiceCollectionsEscalationStage({
          status: row.status,
          balanceDue: row.balanceDue,
          dueDate: row.dueDate,
          settings: {
            urgentAfterDays: collectionsSettings.urgentAfterDays,
            finalAfterDays: collectionsSettings.finalAfterDays,
          },
        });
        const jobContext = getInvoiceReadJobContext({
          legacyLeadId: row.legacyLead?.id || null,
          sourceJobId: row.sourceJob?.id || null,
          legacyLead: row.legacyLead,
          sourceJob: row.sourceJob,
        });

        return {
          invoiceNumber: formatInvoiceNumber(row.invoiceNumber),
          customerName: row.customer.name,
          customerEmail: row.customer.email || "",
          status: row.status,
          total: formatCsvMoney(row.total),
          amountPaid: formatCsvMoney(row.amountPaid),
          balanceDue: formatCsvMoney(row.balanceDue),
          dueDate: formatCsvDate(row.dueDate),
          updatedAt: formatCsvDate(row.updatedAt),
          reminderReady: canSendInvoiceReminder({
            status: row.status,
            balanceDue: row.balanceDue,
          })
            ? "yes"
            : "no",
          reminderCount: String(row.reminderCount),
          lastReminderSentAt: formatCsvDate(row.lastReminderSentAt),
          lastCollectionAttemptAt: formatCsvDate(
            latestCollectionAttempt?.createdAt,
          ),
          lastCollectionAttemptSource: latestCollectionAttempt?.source || "",
          lastCollectionAttemptOutcome: latestCollectionAttempt?.outcome || "",
          lastCollectionAttemptReason: latestCollectionAttempt?.reason || "",
          lastCollectionAttemptQueueStage:
            latestCollectionAttemptMetadata.queueStage || "",
          lastCollectionAttemptReminderCount:
            latestCollectionAttemptMetadata.reminderCount === null
              ? ""
              : String(latestCollectionAttemptMetadata.reminderCount),
          queueStage: queueState.stage,
          nextReminderAt: formatCsvDate(queueState.nextReminderAt),
          remindersRemaining: String(queueState.remindersRemaining),
          agingBucket,
          escalationStage,
          payLinkIssue: checkoutRecovery.issue || "",
          activePayLinkUrl: checkoutRecovery.activeCheckoutUrl || "",
          onlinePaymentsReady: isInvoiceOnlinePaymentReady({
            stripeConnectionStatus: stripeConnection?.status || null,
            webhookConfigured: workspaceOnlinePaymentsReady,
            balanceDue: row.balanceDue,
          })
            ? "yes"
            : "no",
          jobLabel: jobContext.primaryLabel || "",
        };
      })
      .filter((row) => {
        if (isInvoiceCollectionsQueueFilter(queue)) {
          if (queue === "due" && row.queueStage !== "due_now") return false;
          if (queue === "upcoming" && row.queueStage !== "upcoming")
            return false;
          if (queue === "maxed" && row.queueStage !== "maxed") return false;
        }

        if (isInvoiceCollectionsAgingFilter(aging)) {
          if (aging === "current" && row.agingBucket !== "current") return false;
          if (aging === "1_30" && row.agingBucket !== "days_1_30") return false;
          if (aging === "31_60" && row.agingBucket !== "days_31_60")
            return false;
          if (aging === "61_plus" && row.agingBucket !== "days_61_plus")
            return false;
        }

        return true;
      });

    const csv = toCsvRows(exportRows, [
      "invoiceNumber",
      "customerName",
      "customerEmail",
      "status",
      "total",
      "amountPaid",
      "balanceDue",
      "dueDate",
      "updatedAt",
      "reminderReady",
      "reminderCount",
      "lastReminderSentAt",
      "lastCollectionAttemptAt",
      "lastCollectionAttemptSource",
      "lastCollectionAttemptOutcome",
      "lastCollectionAttemptReason",
      "lastCollectionAttemptQueueStage",
      "lastCollectionAttemptReminderCount",
      "queueStage",
      "nextReminderAt",
      "remindersRemaining",
      "agingBucket",
      "escalationStage",
      "payLinkIssue",
      "activePayLinkUrl",
      "onlinePaymentsReady",
      "jobLabel",
    ]);
    const fileName = `tiegui-collections-${new Date().toISOString().slice(0, 10)}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${fileName}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof AppApiError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: error.status },
      );
    }

    const message =
      error instanceof Error ? error.message : "Failed to export collections.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
