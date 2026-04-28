import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Prisma, type BillingInvoiceStatus } from "@prisma/client";
import SendInvoiceModal from "@/components/invoices/send-invoice-modal";
import { getRequestTranslator } from "@/lib/i18n";
import { sendInvoiceDelivery } from "@/lib/invoice-delivery";
import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/hq";
import {
  billingInvoiceStatusOptions,
  buildInvoiceWorkerLeadAccessWhere,
  formatCurrency,
  formatInvoiceNumber,
  getInvoiceActionContext,
  getInvoiceActionRevalidationPaths,
  getInvoiceReadJobContext,
} from "@/lib/invoices";
import { getConfiguredBaseUrl } from "@/lib/urls";
import {
  canSendInvoiceReminder,
  deriveInvoiceCollectionsAgingBucket,
  deriveInvoiceCollectionsEscalationStage,
  deriveInvoiceCheckoutRecoveryState,
  isInvoiceCollectionsAgingFilter,
  isInvoiceCollectionsQueueFilter,
  summarizeInvoiceCollectionAttempts,
  deriveInvoiceCollectionsQueueState,
  hasInvoiceReminderHistory,
  summarizeInvoiceCollectionsAging,
  summarizeInvoiceCollectionsEscalation,
  summarizeInvoiceCollections,
  summarizeInvoiceCollectionsOwnerReport,
  summarizeInvoiceCollectionsQueue,
} from "@/lib/invoice-collections";
import { isStripeWebhookConfigured } from "@/lib/stripe-client";
import { isInvoiceOnlinePaymentReady } from "@/lib/stripe-invoice-payments";
import {
  getParam,
  requireAppOrgActor,
  resolveAppScope,
  withOrgQuery,
} from "../_lib/portal-scope";
import {
  isWorkerScopedPageViewer,
  requireAppPageViewer,
} from "../_lib/portal-viewer";

export const dynamic = "force-dynamic";

function isBillingStatus(value: string): value is BillingInvoiceStatus {
  return billingInvoiceStatusOptions.some((option) => option === value);
}

const OPEN_INVOICE_STATUSES: BillingInvoiceStatus[] = [
  "DRAFT",
  "SENT",
  "PARTIAL",
  "OVERDUE",
];

const COLLECTION_REPORT_STATUSES: BillingInvoiceStatus[] = [
  "SENT",
  "PARTIAL",
  "OVERDUE",
  "PAID",
];

function appendQuery(path: string, key: string, value: string): string {
  const joiner = path.includes("?") ? "&" : "?";
  return `${path}${joiner}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

function buildInvoiceWorkspacePath(input: {
  status?: string;
  openOnly?: string;
  queue?: string;
  aging?: string;
  orgId: string;
  internalUser: boolean;
}) {
  const params = new URLSearchParams();
  const status = (input.status || "").trim();
  const openOnly = (input.openOnly || "").trim();
  const queue = (input.queue || "").trim().toLowerCase();
  const aging = (input.aging || "").trim().toLowerCase();

  if (status) {
    params.set("status", status);
  }
  if (openOnly === "1") {
    params.set("openOnly", "1");
  }
  if (isInvoiceCollectionsQueueFilter(queue)) {
    params.set("queue", queue);
  }
  if (isInvoiceCollectionsAgingFilter(aging)) {
    params.set("aging", aging);
  }

  const query = params.toString();
  return withOrgQuery(
    `/app/invoices${query ? `?${query}` : ""}`,
    input.orgId,
    input.internalUser,
  );
}

async function getServerActionBaseUrl(): Promise<string> {
  const headerStore = await headers();
  const forwardedProto = headerStore
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const forwardedHost = headerStore
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const host =
    forwardedHost || headerStore.get("host")?.split(",")[0]?.trim() || null;

  if (host) {
    return `${forwardedProto || "https"}://${host}`;
  }

  return getConfiguredBaseUrl() || "http://localhost:3001";
}

async function requireInvoiceListActionAccess(formData: FormData) {
  const invoiceId = String(formData.get("invoiceId") || "").trim();
  const orgId = String(formData.get("orgId") || "").trim();
  const returnPathRaw = String(formData.get("returnPath") || "").trim();
  const fallbackPath = "/app/invoices";

  if (!invoiceId || !orgId) {
    redirect(fallbackPath);
  }

  const actor = await requireAppOrgActor("/app/invoices", orgId);
  if (!actor.internalUser && actor.calendarAccessRole === "READ_ONLY") {
    redirect(appendQuery(returnPathRaw || fallbackPath, "error", "readonly"));
  }

  const invoice = await prisma.invoice.findFirst({
    where: {
      id: invoiceId,
      orgId,
    },
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
    redirect(fallbackPath);
  }

  const invoiceActionContext = getInvoiceActionContext({
    legacyLeadId: invoice.legacyLeadId,
    sourceJobId: invoice.sourceJobId,
    sourceJob: invoice.sourceJob,
  });

  if (!actor.internalUser && actor.calendarAccessRole === "WORKER") {
    if (!invoiceActionContext.leadId) {
      redirect(
        appendQuery(
          returnPathRaw || fallbackPath,
          "error",
          "worker-permission",
        ),
      );
    }

    const workerAllowed = await prisma.lead.findFirst({
      where: {
        id: invoiceActionContext.leadId,
        orgId,
        ...buildInvoiceWorkerLeadAccessWhere({
          actorId: actor.id,
          invoiceId: invoice.id,
        }),
      },
      select: { id: true },
    });

    if (!workerAllowed) {
      redirect(
        appendQuery(
          returnPathRaw || fallbackPath,
          "error",
          "worker-permission",
        ),
      );
    }
  }

  const returnPath = returnPathRaw.startsWith("/app/invoices")
    ? returnPathRaw
    : fallbackPath;

  return {
    invoice,
    invoiceActionContext,
    orgId,
    returnPath,
    actorId: actor.id ?? null,
  };
}

async function sendFreshReminderAction(formData: FormData) {
  "use server";

  const scoped = await requireInvoiceListActionAccess(formData);

  try {
    await sendInvoiceDelivery({
      invoiceId: scoped.invoice.id,
      baseUrl: await getServerActionBaseUrl(),
      sendMode: "reminder",
      refreshPayLink: true,
      actorUserId: scoped.actorId,
      source: "MANUAL",
    });
  } catch {
    redirect(appendQuery(scoped.returnPath, "error", "fresh-link-reminder"));
  }

  for (const path of getInvoiceActionRevalidationPaths({
    invoiceId: scoped.invoice.id,
    leadId: scoped.invoiceActionContext.leadId,
  })) {
    revalidatePath(path);
  }

  redirect(appendQuery(scoped.returnPath, "saved", "fresh-link-reminder"));
}

export default async function InvoicesPage(
  props: {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const searchParams = await props.searchParams;
  const t = await getRequestTranslator();
  const requestedOrgId = getParam(searchParams?.orgId);
  const status = getParam(searchParams?.status).toUpperCase();
  const openOnly = getParam(searchParams?.openOnly) || "0";
  const queue = getParam(searchParams?.queue).toLowerCase();
  const aging = getParam(searchParams?.aging).toLowerCase();
  const saved = getParam(searchParams?.saved);
  const error = getParam(searchParams?.error);

  const scope = await resolveAppScope({
    nextPath: "/app/invoices",
    requestedOrgId,
  });
  if (!scope.onboardingComplete) {
    return (
      <section className="card invoice-card">
        <h2>{t("invoices.title")}</h2>
        <div className="portal-empty-state">
          <strong>{t("invoices.emptyTitle")}</strong>
          <p className="muted">{t("invoices.onboardingBody")}</p>
          <div className="portal-empty-actions">
            <Link
              className="btn secondary"
              href={withOrgQuery(
                "/app/onboarding?step=1",
                scope.orgId,
                scope.internalUser,
              )}
            >
              {t("buttons.finishOnboarding")}
            </Link>
            <Link
              className="btn primary"
              href={withOrgQuery("/app/jobs", scope.orgId, scope.internalUser)}
            >
              {t("jobs.title")}
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const viewer = await requireAppPageViewer({
    nextPath: "/app/invoices",
    orgId: scope.orgId,
  });
  const canTriggerInvoiceQueueActions =
    viewer.internalUser || viewer.calendarAccessRole !== "READ_ONLY";
  const workerScoped = isWorkerScopedPageViewer(viewer);
  const workerId = workerScoped ? viewer.id : null;
  const workerLeadAccessWhere = workerId
    ? buildInvoiceWorkerLeadAccessWhere({ actorId: workerId })
    : null;

  const baseWhere: Prisma.InvoiceWhereInput = {
    orgId: scope.orgId,
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
  const automationLookback = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  if (isBillingStatus(status)) {
    where.status = status;
  }

  if (openOnly === "1") {
    where.status = where.status ? where.status : { in: OPEN_INVOICE_STATUSES };
  }

  const [
    rows,
    statusCounts,
    collectionRows,
    collectionReportRows,
    stripeConnection,
    organization,
    recentCollectionAttempts,
    recentFailedCollectionAttempts,
    latestAutomationRun,
  ] = await Promise.all([
    prisma.invoice.findMany({
      where,
      include: {
        customer: {
          select: {
            id: true,
            email: true,
            name: true,
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
            createdAt: true,
            expiresAt: true,
            lastError: true,
          },
          orderBy: [{ createdAt: "desc" }],
          take: 1,
        },
      },
      orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }],
      take: 500,
    }),
    prisma.invoice.groupBy({
      by: ["status"],
      where: baseWhere,
      _count: {
        _all: true,
      },
    }),
    prisma.invoice.findMany({
      where: {
        ...baseWhere,
        status: { in: OPEN_INVOICE_STATUSES },
      },
      select: {
        lastReminderSentAt: true,
        reminderCount: true,
        sentAt: true,
        status: true,
        balanceDue: true,
        dueDate: true,
      },
    }),
    prisma.invoice.findMany({
      where: {
        ...baseWhere,
        status: { in: COLLECTION_REPORT_STATUSES },
      },
      select: {
        status: true,
        amountPaid: true,
        balanceDue: true,
        dueDate: true,
        payments: {
          select: {
            amount: true,
            date: true,
          },
        },
        collectionAttempts: {
          select: {
            source: true,
            outcome: true,
            createdAt: true,
          },
        },
      },
      orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }],
      take: 500,
    }),
    prisma.organizationStripeConnection.findUnique({
      where: { orgId: scope.orgId },
      select: {
        status: true,
      },
    }),
    prisma.organization.findUnique({
      where: { id: scope.orgId },
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
    prisma.invoiceCollectionAttempt.findMany({
      where: {
        orgId: scope.orgId,
        createdAt: {
          gte: automationLookback,
        },
      },
      select: {
        source: true,
        outcome: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 100,
    }),
    prisma.invoiceCollectionAttempt.findMany({
      where: {
        orgId: scope.orgId,
        outcome: "FAILED",
        createdAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        },
        invoice: {
          is: baseWhere,
        },
      },
      select: {
        id: true,
        source: true,
        reason: true,
        createdAt: true,
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            balanceDue: true,
            customer: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 5,
    }),
    prisma.internalCronRunLog.findFirst({
      where: {
        route: "/api/cron/invoice-collections",
      },
      select: {
        status: true,
        startedAt: true,
        finishedAt: true,
        failureCount: true,
        successCount: true,
        errorMessage: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    }),
  ]);

  const counts = Object.fromEntries(
    statusCounts.map((row) => [row.status, row._count._all]),
  ) as Record<string, number>;
  const totalInvoices = Object.values(counts).reduce(
    (sum, value) => sum + value,
    0,
  );
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
  const collectionsQueueSummary = summarizeInvoiceCollectionsQueue(
    collectionRows,
    collectionsSettings,
  );
  const automationSummary = summarizeInvoiceCollectionAttempts(
    recentCollectionAttempts,
  );
  const agingSummary = summarizeInvoiceCollectionsAging(collectionRows);
  const escalationSummary = summarizeInvoiceCollectionsEscalation(
    collectionRows,
    {
      urgentAfterDays: collectionsSettings.urgentAfterDays,
      finalAfterDays: collectionsSettings.finalAfterDays,
    },
  );
  const ownerCollectionsReport = summarizeInvoiceCollectionsOwnerReport(
    collectionReportRows,
    {
      urgentAfterDays: collectionsSettings.urgentAfterDays,
      finalAfterDays: collectionsSettings.finalAfterDays,
    },
  );
  const decoratedRows = rows.map((row) => {
    const invoiceHref = withOrgQuery(
      `/app/invoices/${row.id}`,
      scope.orgId,
      scope.internalUser,
    );
    const pdfPreviewHref = `/api/invoices/${row.id}/pdf?inline=1`;
    const sendHref = `/api/invoices/${row.id}/send`;
    const jobContext = getInvoiceReadJobContext({
      legacyLeadId: row.legacyLeadId,
      sourceJobId: row.sourceJobId,
      legacyLead: row.legacyLead,
      sourceJob: row.sourceJob,
    });
    const jobHref = jobContext.operationalJobId
      ? withOrgQuery(
          `/app/jobs/records/${jobContext.operationalJobId}`,
          scope.orgId,
          scope.internalUser,
        )
      : jobContext.crmLeadId
        ? withOrgQuery(
            `/app/jobs/${jobContext.crmLeadId}?tab=invoice`,
            scope.orgId,
            scope.internalUser,
          )
        : null;
    const jobLabel = jobContext.primaryLabel || "-";
    const rowOnlinePaymentsReady = isInvoiceOnlinePaymentReady({
      stripeConnectionStatus: stripeConnection?.status || null,
      webhookConfigured: workspaceOnlinePaymentsReady,
      balanceDue: row.balanceDue,
    });
    const latestCheckoutSession = row.checkoutSessions[0] || null;
    const checkoutRecovery = deriveInvoiceCheckoutRecoveryState({
      status: latestCheckoutSession?.status,
      checkoutUrl: latestCheckoutSession?.checkoutUrl || null,
      expiresAt: latestCheckoutSession?.expiresAt || null,
      lastError: latestCheckoutSession?.lastError || null,
    });
    const checkoutIssueLabel =
      checkoutRecovery.issue === "failed"
        ? t("invoices.collections.payLinkFailed")
        : checkoutRecovery.issue === "expired"
          ? t("invoices.collections.payLinkExpired")
          : checkoutRecovery.issue === "replaced"
            ? t("invoices.collections.payLinkReplaced")
            : null;
    const reminderReady = canSendInvoiceReminder({
      status: row.status,
      balanceDue: row.balanceDue,
    });
    const reminderHistoryVisible = hasInvoiceReminderHistory({
      reminderCount: row.reminderCount,
      lastReminderSentAt: row.lastReminderSentAt,
    });
    const sendMode: "invoice" | "reminder" | null = row.status === "DRAFT"
      ? "invoice"
      : reminderReady
        ? "reminder"
        : null;
    const sendButtonLabel =
      sendMode === "invoice"
        ? t("invoices.collections.sendInvoice")
        : reminderHistoryVisible
          ? t("invoices.collections.resendReminder")
          : t("invoices.collections.sendReminder");
    const queueState = deriveInvoiceCollectionsQueueState({
      status: row.status,
      balanceDue: row.balanceDue,
      dueDate: row.dueDate,
      sentAt: row.sentAt,
      lastReminderSentAt: row.lastReminderSentAt,
      reminderCount: row.reminderCount,
      settings: collectionsSettings,
    });
    const queueLabel =
      queueState.stage === "due_now"
        ? t("invoices.collections.queueDueNowLabel")
        : queueState.stage === "upcoming"
          ? t("invoices.collections.queueUpcomingLabel")
          : queueState.stage === "maxed"
            ? t("invoices.collections.queueMaxedLabel")
            : queueState.stage === "disabled"
              ? t("invoices.collections.queueDisabledLabel")
              : null;
    const agingBucket = deriveInvoiceCollectionsAgingBucket({
      status: row.status,
      balanceDue: row.balanceDue,
      dueDate: row.dueDate,
    });
    const agingLabel =
      agingBucket === "current"
        ? t("invoices.collections.agingCurrentLabel")
        : agingBucket === "days_1_30"
          ? t("invoices.collections.aging1to30Label")
          : agingBucket === "days_31_60"
            ? t("invoices.collections.aging31to60Label")
            : agingBucket === "days_61_plus"
              ? t("invoices.collections.aging61PlusLabel")
              : null;
    const escalationStage = deriveInvoiceCollectionsEscalationStage({
      status: row.status,
      balanceDue: row.balanceDue,
      dueDate: row.dueDate,
      settings: {
        urgentAfterDays: collectionsSettings.urgentAfterDays,
        finalAfterDays: collectionsSettings.finalAfterDays,
      },
    });
    const escalationLabel =
      escalationStage === "current"
        ? t("invoices.collections.escalationCurrentLabel")
        : escalationStage === "overdue"
          ? t("invoices.collections.escalationOverdueLabel")
          : escalationStage === "urgent"
            ? t("invoices.collections.escalationUrgentLabel")
            : escalationStage === "final"
              ? t("invoices.collections.escalationFinalLabel")
              : null;

    return {
      ...row,
      agingBucket,
      agingLabel,
      checkoutIssueLabel,
      checkoutRecovery,
      escalationLabel,
      escalationStage,
      invoiceHref,
      jobHref,
      jobLabel,
      pdfPreviewHref,
      queueLabel,
      queueState,
      reminderHistoryVisible,
      reminderReady,
      rowOnlinePaymentsReady,
      sendButtonLabel,
      sendHref,
      sendMode,
    };
  });
  const visibleRows = decoratedRows.filter((row) => {
    if (isInvoiceCollectionsQueueFilter(queue)) {
      if (queue === "due" && row.queueState.stage !== "due_now") return false;
      if (queue === "upcoming" && row.queueState.stage !== "upcoming")
        return false;
      if (queue === "maxed" && row.queueState.stage !== "maxed") return false;
    }

    if (isInvoiceCollectionsAgingFilter(aging)) {
      if (aging === "current" && row.agingBucket !== "current") return false;
      if (aging === "1_30" && row.agingBucket !== "days_1_30") return false;
      if (aging === "31_60" && row.agingBucket !== "days_31_60") return false;
      if (aging === "61_plus" && row.agingBucket !== "days_61_plus")
        return false;
    }

    return true;
  });
  const hasFiltersApplied =
    Boolean(status) ||
    openOnly === "1" ||
    isInvoiceCollectionsQueueFilter(queue) ||
    isInvoiceCollectionsAgingFilter(aging);
  const collectionsSummary = summarizeInvoiceCollections(collectionRows);
  const statusLabel = (value: string) =>
    t(`status.${value.toLowerCase()}` as never);
  const workspacePath = buildInvoiceWorkspacePath({
    status,
    openOnly,
    queue,
    aging,
    orgId: scope.orgId,
    internalUser: scope.internalUser,
  });
  const exportQuery = new URLSearchParams(
    Object.fromEntries(
      Object.entries({
        status: status || "",
        openOnly: openOnly === "1" ? "1" : "",
        queue: isInvoiceCollectionsQueueFilter(queue) ? queue : "",
        aging: isInvoiceCollectionsAgingFilter(aging) ? aging : "",
      }).filter(([, value]) => value),
    ),
  ).toString();
  const exportHref = withOrgQuery(
    `/api/invoices/collections-export${exportQuery ? `?${exportQuery}` : ""}`,
    scope.orgId,
    scope.internalUser,
  );

  return (
    <>
      <section className="card invoice-card">
        <h2>{t("invoices.title")}</h2>
        <p className="muted">{t("invoices.subtitle")}</p>
        <p className="muted" style={{ marginTop: 6 }}>
          {workspaceOnlinePaymentsReady
            ? t("invoices.onlineCollectionReadyNote")
            : t("invoices.manualTrackingNote")}
        </p>
        <div className="dashboard-stats-grid" style={{ marginTop: 16 }}>
          <div className="dashboard-stat-tile">
            <span>{t("invoices.collections.outstandingLabel")}</span>
            <strong>{formatCurrency(collectionsSummary.outstandingTotal)}</strong>
          </div>
          <div className="dashboard-stat-tile">
            <span>{t("invoices.collections.overdueLabel")}</span>
            <strong>{collectionsSummary.overdueCount}</strong>
          </div>
          <div className="dashboard-stat-tile">
            <span>{t("invoices.collections.dueSoonLabel")}</span>
            <strong>{collectionsSummary.dueSoonCount}</strong>
          </div>
          <div className="dashboard-stat-tile">
            <span>{t("invoices.collections.reminderReadyLabel")}</span>
            <strong>{collectionsSummary.reminderReadyCount}</strong>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 12 }}>
          {t("invoices.collections.subtitle", {
            drafts: collectionsSummary.draftCount,
            open: collectionsSummary.totalOpenCount,
          })}
        </p>
        <div style={{ marginTop: 18 }}>
          <h3>{t("invoices.collections.ownerReportTitle")}</h3>
          <p className="muted" style={{ marginTop: 6 }}>
            {t("invoices.collections.ownerReportSubtitle")}
          </p>
        </div>
        <div className="dashboard-stats-grid" style={{ marginTop: 12 }}>
          <div className="dashboard-stat-tile">
            <span>{t("invoices.collections.recoveredAfterCollectionsLabel")}</span>
            <strong>
              {formatCurrency(
                ownerCollectionsReport.recoveredAfterCollectionTotal,
              )}
            </strong>
          </div>
          <div className="dashboard-stat-tile">
            <span>{t("invoices.collections.stillAtRiskLabel")}</span>
            <strong>
              {formatCurrency(ownerCollectionsReport.stillAtRiskTotal)}
            </strong>
          </div>
          <div className="dashboard-stat-tile">
            <span>{t("invoices.collections.highRiskLabel")}</span>
            <strong>{formatCurrency(ownerCollectionsReport.highRiskTotal)}</strong>
          </div>
          <div className="dashboard-stat-tile">
            <span>{t("invoices.collections.failedAttemptsLabel")}</span>
            <strong>{ownerCollectionsReport.performance.failedCount}</strong>
          </div>
        </div>
        <div className="dashboard-stats-grid" style={{ marginTop: 12 }}>
          <div className="dashboard-stat-tile">
            <span>{t("invoices.collections.escalationCurrentLabel")}</span>
            <strong>
              {formatCurrency(
                ownerCollectionsReport.escalation.current.balanceDue,
              )}
            </strong>
            <span>
              {t("invoices.collections.invoiceCountLabel", {
                count: ownerCollectionsReport.escalation.current.count,
              })}
            </span>
          </div>
          <div className="dashboard-stat-tile">
            <span>{t("invoices.collections.escalationOverdueLabel")}</span>
            <strong>
              {formatCurrency(
                ownerCollectionsReport.escalation.overdue.balanceDue,
              )}
            </strong>
            <span>
              {t("invoices.collections.invoiceCountLabel", {
                count: ownerCollectionsReport.escalation.overdue.count,
              })}
            </span>
          </div>
          <div className="dashboard-stat-tile">
            <span>{t("invoices.collections.escalationUrgentLabel")}</span>
            <strong>
              {formatCurrency(
                ownerCollectionsReport.escalation.urgent.balanceDue,
              )}
            </strong>
            <span>
              {t("invoices.collections.invoiceCountLabel", {
                count: ownerCollectionsReport.escalation.urgent.count,
              })}
            </span>
          </div>
          <div className="dashboard-stat-tile">
            <span>{t("invoices.collections.escalationFinalLabel")}</span>
            <strong>
              {formatCurrency(
                ownerCollectionsReport.escalation.final.balanceDue,
              )}
            </strong>
            <span>
              {t("invoices.collections.invoiceCountLabel", {
                count: ownerCollectionsReport.escalation.final.count,
              })}
            </span>
          </div>
        </div>
        <div className="dashboard-stats-grid" style={{ marginTop: 12 }}>
          <div className="dashboard-stat-tile">
            <span>{t("invoices.collections.manualSentLabel")}</span>
            <strong>{ownerCollectionsReport.performance.manual.sentCount}</strong>
          </div>
          <div className="dashboard-stat-tile">
            <span>{t("invoices.collections.manualFailedLabel")}</span>
            <strong>{ownerCollectionsReport.performance.manual.failedCount}</strong>
          </div>
          <div className="dashboard-stat-tile">
            <span>{t("invoices.collections.automationSentLabel")}</span>
            <strong>
              {ownerCollectionsReport.performance.automation.sentCount}
            </strong>
          </div>
          <div className="dashboard-stat-tile">
            <span>{t("invoices.collections.automationFailedLabel")}</span>
            <strong>
              {ownerCollectionsReport.performance.automation.failedCount}
            </strong>
          </div>
        </div>
        {recentFailedCollectionAttempts.length > 0 ? (
          <div style={{ marginTop: 14 }}>
            <strong>{t("invoices.collections.recentFailuresTitle")}</strong>
            <ul className="dashboard-list" style={{ marginTop: 8 }}>
              {recentFailedCollectionAttempts.map((attempt) => (
                <li key={attempt.id} className="dashboard-list-row">
                  <div className="dashboard-list-primary">
                    <Link
                      className="dashboard-list-link"
                      href={withOrgQuery(
                        `/app/invoices/${attempt.invoice.id}`,
                        scope.orgId,
                        scope.internalUser,
                      )}
                    >
                      {formatInvoiceNumber(attempt.invoice.invoiceNumber)}
                    </Link>
                    <div className="dashboard-list-meta">
                      <span>{attempt.invoice.customer.name}</span>
                      <span>{formatCurrency(attempt.invoice.balanceDue)}</span>
                      <span>{attempt.source}</span>
                      {attempt.reason ? <span>{attempt.reason}</span> : null}
                    </div>
                  </div>
                  <span className="dashboard-list-time">
                    {formatDateTime(attempt.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="muted" style={{ marginTop: 12 }}>
            {t("invoices.collections.noRecentFailures")}
          </p>
        )}
        <div className="dashboard-stats-grid" style={{ marginTop: 12 }}>
          <div className="dashboard-stat-tile">
            <span>{t("invoices.collections.queueDueNowLabel")}</span>
            <strong>{collectionsQueueSummary.dueNowCount}</strong>
          </div>
          <div className="dashboard-stat-tile">
            <span>{t("invoices.collections.queueUpcomingLabel")}</span>
            <strong>{collectionsQueueSummary.upcomingCount}</strong>
          </div>
          <div className="dashboard-stat-tile">
            <span>{t("invoices.collections.queueMaxedLabel")}</span>
            <strong>{collectionsQueueSummary.maxedCount}</strong>
          </div>
          <div className="dashboard-stat-tile">
            <span>{t("invoices.collections.queueStatusLabel")}</span>
            <strong>
              {collectionsSettings.enabled
                ? t("invoices.collections.queueStatusOn")
                : t("invoices.collections.queueStatusOff")}
            </strong>
          </div>
        </div>
        <div className="dashboard-stats-grid" style={{ marginTop: 12 }}>
          <div className="dashboard-stat-tile">
            <span>{t("invoices.collections.agingCurrentLabel")}</span>
            <strong>{agingSummary.currentCount}</strong>
          </div>
          <div className="dashboard-stat-tile">
            <span>{t("invoices.collections.aging1to30Label")}</span>
            <strong>{agingSummary.days1to30Count}</strong>
          </div>
          <div className="dashboard-stat-tile">
            <span>{t("invoices.collections.aging31to60Label")}</span>
            <strong>{agingSummary.days31to60Count}</strong>
          </div>
          <div className="dashboard-stat-tile">
            <span>{t("invoices.collections.aging61PlusLabel")}</span>
            <strong>{agingSummary.days61PlusCount}</strong>
          </div>
        </div>
        <div className="dashboard-stats-grid" style={{ marginTop: 12 }}>
          <div className="dashboard-stat-tile">
            <span>{t("invoices.collections.autoSendStatusLabel")}</span>
            <strong>
              {collectionsSettings.autoSendEnabled
                ? t("invoices.collections.queueStatusOn")
                : t("invoices.collections.queueStatusOff")}
            </strong>
          </div>
          <div className="dashboard-stat-tile">
            <span>{t("invoices.collections.autoSent7dLabel")}</span>
            <strong>{automationSummary.automatedSentCount}</strong>
          </div>
          <div className="dashboard-stat-tile">
            <span>{t("invoices.collections.autoFailed7dLabel")}</span>
            <strong>{automationSummary.automatedFailedCount}</strong>
          </div>
          <div className="dashboard-stat-tile">
            <span>{t("invoices.collections.lastAutomationRunLabel")}</span>
            <strong>
              {latestAutomationRun?.finishedAt
                ? formatDateTime(latestAutomationRun.finishedAt)
                : latestAutomationRun?.startedAt
                  ? formatDateTime(latestAutomationRun.startedAt)
                  : t("invoices.collections.neverLabel")}
            </strong>
          </div>
        </div>
        <div className="dashboard-stats-grid" style={{ marginTop: 12 }}>
          <div className="dashboard-stat-tile">
            <span>{t("invoices.collections.escalationCurrentLabel")}</span>
            <strong>{escalationSummary.currentCount}</strong>
          </div>
          <div className="dashboard-stat-tile">
            <span>{t("invoices.collections.escalationOverdueLabel")}</span>
            <strong>{escalationSummary.overdueCount}</strong>
          </div>
          <div className="dashboard-stat-tile">
            <span>{t("invoices.collections.escalationUrgentLabel")}</span>
            <strong>{escalationSummary.urgentCount}</strong>
          </div>
          <div className="dashboard-stat-tile">
            <span>{t("invoices.collections.escalationFinalLabel")}</span>
            <strong>{escalationSummary.finalCount}</strong>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 12 }}>
          {t("invoices.collections.queueRulesNote", {
            cadence: collectionsSettings.overdueReminderCadenceDays,
            lead: collectionsSettings.firstReminderLeadDays,
            max: collectionsSettings.maxReminders,
          })}
        </p>
        <p className="muted" style={{ marginTop: 6 }}>
          {t("invoices.collections.escalationRulesNote", {
            urgent: collectionsSettings.urgentAfterDays,
            final: collectionsSettings.finalAfterDays,
          })}
        </p>
        <p className="muted" style={{ marginTop: 6 }}>
          {latestAutomationRun
            ? latestAutomationRun.status === "ERROR"
              ? t("invoices.collections.automationHealthError", {
                  failures: latestAutomationRun.failureCount,
                })
              : t("invoices.collections.automationHealthOk", {
                  sent: latestAutomationRun.successCount,
                })
            : t("invoices.collections.automationHealthIdle")}
        </p>
        {latestAutomationRun?.errorMessage ? (
          <p className="form-status" style={{ marginTop: 10 }}>
            {latestAutomationRun.errorMessage}
          </p>
        ) : null}
        {saved === "fresh-link-reminder" ? (
          <p className="form-status" style={{ marginTop: 10 }}>
            {t("invoices.collections.freshLinkReminderSent")}
          </p>
        ) : null}
        {error === "fresh-link-reminder" ? (
          <p className="form-status" style={{ marginTop: 10 }}>
            {t("invoices.collections.freshLinkReminderError")}
          </p>
        ) : null}
        {error === "readonly" ? (
          <p className="form-status" style={{ marginTop: 10 }}>
            {t("invoices.collections.readOnlyError")}
          </p>
        ) : null}
        {error === "worker-permission" ? (
          <p className="form-status" style={{ marginTop: 10 }}>
            {t("invoices.collections.workerPermissionError")}
          </p>
        ) : null}
        <div className="quick-links" style={{ marginTop: 12 }}>
          <Link
            className="btn secondary"
            href={withOrgQuery(
              "/app/invoices/recurring",
              scope.orgId,
              scope.internalUser,
            )}
          >
            Recurring Billing
          </Link>
          <Link
            className="btn secondary"
            href={withOrgQuery(
              "/app/settings/invoice",
              scope.orgId,
              scope.internalUser,
            )}
          >
            {t("invoices.collections.manageRules")}
          </Link>
          <Link
            className="btn secondary"
            href={withOrgQuery(
              "/app/invoices?status=OVERDUE",
              scope.orgId,
              scope.internalUser,
            )}
            scroll={false}
          >
            {t("invoices.collections.viewOverdue")}
          </Link>
          <Link
            className="btn secondary"
            href={withOrgQuery(
              "/app/invoices?openOnly=1",
              scope.orgId,
              scope.internalUser,
            )}
            scroll={false}
          >
            {t("invoices.collections.viewOpen")}
          </Link>
          <Link
            className="btn secondary"
            href={withOrgQuery(
              "/app/invoices?status=DRAFT",
              scope.orgId,
              scope.internalUser,
            )}
            scroll={false}
          >
            {t("invoices.collections.viewDrafts")}
          </Link>
          <a className="btn secondary" href={exportHref}>
            {t("invoices.collections.exportCsv")}
          </a>
        </div>

        <div className="quick-meta" style={{ marginTop: 12 }}>
          <span className="badge status-draft">
            {statusLabel("DRAFT")}: {counts.DRAFT || 0}
          </span>
          <span className="badge status-sent">
            {statusLabel("SENT")}: {counts.SENT || 0}
          </span>
          <span className="badge status-partial">
            {statusLabel("PARTIAL")}: {counts.PARTIAL || 0}
          </span>
          <span className="badge status-paid">
            {statusLabel("PAID")}: {counts.PAID || 0}
          </span>
          <span className="badge status-overdue">
            {statusLabel("OVERDUE")}: {counts.OVERDUE || 0}
          </span>
        </div>

        <form className="filters" method="get" style={{ marginTop: 12 }}>
          {scope.internalUser ? (
            <input type="hidden" name="orgId" value={scope.orgId} />
          ) : null}

          <label>
            {t("invoices.statusLabel")}
            <select name="status" defaultValue={status}>
              <option value="">{t("invoices.all")}</option>
              {billingInvoiceStatusOptions.map((option) => (
                <option key={option} value={option}>
                  {statusLabel(option)}
                </option>
              ))}
            </select>
          </label>

          <label>
            {t("invoices.openOnlyLabel")}
            <select name="openOnly" defaultValue={openOnly}>
              <option value="1">{t("invoices.yes")}</option>
              <option value="0">{t("invoices.no")}</option>
            </select>
          </label>

          <label>
            {t("invoices.collections.filterLabel")}
            <select
              name="queue"
              defaultValue={isInvoiceCollectionsQueueFilter(queue) ? queue : ""}
            >
              <option value="">{t("invoices.all")}</option>
              <option value="due">{t("invoices.collections.queueDueNowLabel")}</option>
              <option value="upcoming">{t("invoices.collections.queueUpcomingLabel")}</option>
              <option value="maxed">{t("invoices.collections.queueMaxedLabel")}</option>
            </select>
          </label>

          <label>
            {t("invoices.collections.agingFilterLabel")}
            <select
              name="aging"
              defaultValue={isInvoiceCollectionsAgingFilter(aging) ? aging : ""}
            >
              <option value="">{t("invoices.all")}</option>
              <option value="current">{t("invoices.collections.agingCurrentLabel")}</option>
              <option value="1_30">{t("invoices.collections.aging1to30Label")}</option>
              <option value="31_60">{t("invoices.collections.aging31to60Label")}</option>
              <option value="61_plus">{t("invoices.collections.aging61PlusLabel")}</option>
            </select>
          </label>

          <button className="btn primary" type="submit">
            {t("invoices.apply")}
          </button>
          <Link
            className="btn secondary"
            href={withOrgQuery(
              "/app/invoices",
              scope.orgId,
              scope.internalUser,
            )}
            scroll={false}
          >
            {t("invoices.reset")}
          </Link>
        </form>
      </section>

      <section className="card invoice-card">
        {visibleRows.length === 0 ? (
          <div className="portal-empty-state">
            <strong>
              {totalInvoices > 0
                ? t("invoices.emptyFilteredTitle")
                : t("invoices.emptyTitle")}
            </strong>
            <p className="muted">
              {totalInvoices > 0
                ? openOnly === "1"
                  ? t("invoices.emptyOpenOnlyBody")
                  : hasFiltersApplied
                    ? t("invoices.emptyFilteredBody")
                    : t("invoices.emptyHiddenBody")
                : t("invoices.emptyCreateBody")}
            </p>
            <div className="portal-empty-actions">
              <Link
                className="btn primary"
                href={withOrgQuery(
                  "/app/jobs",
                  scope.orgId,
                  scope.internalUser,
                )}
              >
                {t("jobs.title")}
              </Link>
              <Link
                className="btn secondary"
                href={withOrgQuery(
                  "/app/jobs/records",
                  scope.orgId,
                  scope.internalUser,
                )}
              >
                {t("jobs.openStructuredRecords")}
              </Link>
            </div>
          </div>
        ) : (
          <>
            <ul className="mobile-list-cards" style={{ marginTop: 12 }}>
            {visibleRows.map((row) => {
                const needsFreshLinkRecovery =
                  row.sendMode === "reminder" &&
                  row.rowOnlinePaymentsReady &&
                  row.checkoutRecovery.issue !== null;
                return (
                  <li key={row.id} className="mobile-list-card">
                    <div className="stack-cell">
                      <Link className="table-link" href={row.invoiceHref}>
                        {formatInvoiceNumber(row.invoiceNumber)}
                      </Link>
                      <span className="muted">{row.customer.name}</span>
                    </div>
                    <div className="quick-meta">
                      <span
                        className={`badge status-${row.status.toLowerCase()}`}
                      >
                        {statusLabel(row.status)}
                      </span>
                      <span className="badge">
                        {t("invoices.balanceShort", {
                          amount: formatCurrency(row.balanceDue),
                        })}
                      </span>
                      {row.checkoutIssueLabel ? (
                        <span className="badge status-overdue">
                          {row.checkoutIssueLabel}
                        </span>
                      ) : null}
                      {row.queueLabel ? (
                        <span
                          className={`badge ${row.queueState.stage === "due_now" ? "status-overdue" : row.queueState.stage === "upcoming" ? "status-sent" : row.queueState.stage === "maxed" ? "status-partial" : ""}`}
                        >
                          {row.queueLabel}
                        </span>
                      ) : null}
                      {row.escalationLabel ? (
                        <span
                          className={`badge ${
                            row.escalationStage === "final"
                              ? "status-overdue"
                              : row.escalationStage === "urgent"
                                ? "status-partial"
                                : row.escalationStage === "overdue"
                                  ? "status-sent"
                                  : ""
                          }`}
                        >
                          {row.escalationLabel}
                        </span>
                      ) : null}
                    </div>
                    <div className="stack-cell">
                      <span className="muted">
                        {t("invoices.totalLabel", {
                          amount: formatCurrency(row.total),
                        })}
                      </span>
                      <span className="muted">
                        {t("invoices.paidLabel", {
                          amount: formatCurrency(row.amountPaid),
                        })}
                      </span>
                      <span className="muted">
                        {t("invoices.dueLabel", {
                          value: formatDateTime(row.dueDate),
                        })}
                      </span>
                      <span className="muted">
                        {t("invoices.updatedLabel", {
                          value: formatDateTime(row.updatedAt),
                        })}
                      </span>
                      {row.queueState.nextReminderAt ? (
                        <span className="muted">
                          {t("invoices.collections.nextReminderLabel", {
                            value: formatDateTime(row.queueState.nextReminderAt),
                          })}
                        </span>
                      ) : null}
                      {row.agingLabel ? (
                        <span className="muted">
                          {t("invoices.collections.agingLabel", {
                            value: row.agingLabel,
                          })}
                        </span>
                      ) : null}
                      {row.reminderHistoryVisible && row.lastReminderSentAt ? (
                        <span className="muted">
                          {t("invoices.collections.lastReminderLabel", {
                            value: formatDateTime(row.lastReminderSentAt),
                          })}
                        </span>
                      ) : row.reminderReady ? (
                        <span className="muted">
                          {t("invoices.collections.reminderNeverSent")}
                        </span>
                      ) : null}
                      {row.reminderCount > 0 ? (
                        <span className="muted">
                          {t("invoices.collections.reminderCountLabel", {
                            count: row.reminderCount,
                          })}
                        </span>
                      ) : null}
                      {row.jobHref ? (
                        <Link className="table-link" href={row.jobHref}>
                          {t("invoices.jobLabel", { value: row.jobLabel })}
                        </Link>
                      ) : (
                        <span className="muted">
                          {t("invoices.jobLabel", { value: row.jobLabel })}
                        </span>
                      )}
                    </div>
                    <div
                      className="mobile-list-card-actions"
                      style={{ justifyContent: "flex-start", flexWrap: "wrap", gap: 8 }}
                    >
                      <Link className="btn secondary" href={row.invoiceHref}>
                        {t("invoices.openInvoice")}
                      </Link>
                      {row.checkoutRecovery.activeCheckoutUrl ? (
                        <a
                          className="btn secondary"
                          href={row.checkoutRecovery.activeCheckoutUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t("invoices.collections.openPayLink")}
                        </a>
                      ) : null}
                      {canTriggerInvoiceQueueActions && needsFreshLinkRecovery ? (
                        <form action={sendFreshReminderAction}>
                          <input type="hidden" name="invoiceId" value={row.id} />
                          <input type="hidden" name="orgId" value={scope.orgId} />
                          <input
                            type="hidden"
                            name="returnPath"
                            value={workspacePath}
                          />
                          <button className="btn secondary" type="submit">
                            {t("invoices.collections.sendFreshReminder")}
                          </button>
                        </form>
                      ) : null}
                      {canTriggerInvoiceQueueActions && row.sendMode ? (
                        <SendInvoiceModal
                          businessName={scope.orgName}
                          buttonClassName="btn secondary"
                          buttonLabel={row.sendButtonLabel}
                          customerEmail={row.customer.email}
                          customerName={row.customer.name}
                          defaultRefreshPayLink={
                            row.sendMode === "reminder" &&
                            row.rowOnlinePaymentsReady &&
                            row.checkoutRecovery.issue !== null
                          }
                          invoiceNumber={formatInvoiceNumber(row.invoiceNumber)}
                          mode={row.sendMode}
                          onlinePaymentsAvailable={row.rowOnlinePaymentsReady}
                          previewHref={row.pdfPreviewHref}
                          sendHref={row.sendHref}
                        />
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="table-wrap desktop-table-only">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t("invoices.table.invoice")}</th>
                    <th>{t("invoices.table.customer")}</th>
                    <th>{t("invoices.table.job")}</th>
                    <th>{t("invoices.table.status")}</th>
                    <th>{t("invoices.table.total")}</th>
                    <th>{t("invoices.table.paid")}</th>
                    <th>{t("invoices.table.balance")}</th>
                    <th>{t("invoices.table.due")}</th>
                    <th>{t("invoices.table.updated")}</th>
                    <th>{t("invoices.table.collections")}</th>
                    <th>{t("invoices.table.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => {
                    const needsFreshLinkRecovery =
                      row.sendMode === "reminder" &&
                      row.rowOnlinePaymentsReady &&
                      row.checkoutRecovery.issue !== null;
                    return (
                      <tr key={row.id}>
                        <td>
                          <Link className="table-link" href={row.invoiceHref}>
                            {formatInvoiceNumber(row.invoiceNumber)}
                          </Link>
                        </td>
                        <td>{row.customer.name}</td>
                        <td>
                          {row.jobHref ? (
                            <Link className="table-link" href={row.jobHref}>
                              {row.jobLabel}
                            </Link>
                          ) : (
                            row.jobLabel
                          )}
                        </td>
                        <td>
                          <span
                            className={`badge status-${row.status.toLowerCase()}`}
                          >
                            {statusLabel(row.status)}
                          </span>
                        </td>
                        <td>{formatCurrency(row.total)}</td>
                        <td>{formatCurrency(row.amountPaid)}</td>
                        <td>{formatCurrency(row.balanceDue)}</td>
                        <td>{formatDateTime(row.dueDate)}</td>
                        <td>{formatDateTime(row.updatedAt)}</td>
                        <td>
                          <div className="stack-cell">
                            {row.checkoutIssueLabel ? (
                              <span className="badge status-overdue">
                                {row.checkoutIssueLabel}
                              </span>
                            ) : row.checkoutRecovery.activeCheckoutUrl ? (
                              <span className="badge status-paid">
                                {t("invoices.collections.payLinkReady")}
                              </span>
                            ) : null}
                            {row.queueLabel ? (
                              <span
                                className={`badge ${row.queueState.stage === "due_now" ? "status-overdue" : row.queueState.stage === "upcoming" ? "status-sent" : row.queueState.stage === "maxed" ? "status-partial" : ""}`}
                              >
                                {row.queueLabel}
                              </span>
                            ) : null}
                            {row.escalationLabel ? (
                              <span
                                className={`badge ${
                                  row.escalationStage === "final"
                                    ? "status-overdue"
                                    : row.escalationStage === "urgent"
                                      ? "status-partial"
                                      : row.escalationStage === "overdue"
                                        ? "status-sent"
                                        : ""
                                }`}
                              >
                                {row.escalationLabel}
                              </span>
                            ) : null}
                            {row.agingLabel ? (
                              <span className="muted">
                                {t("invoices.collections.agingLabel", {
                                  value: row.agingLabel,
                                })}
                              </span>
                            ) : null}
                            {row.queueState.nextReminderAt ? (
                              <span className="muted">
                                {t("invoices.collections.nextReminderLabel", {
                                  value: formatDateTime(row.queueState.nextReminderAt),
                                })}
                              </span>
                            ) : null}
                            {row.reminderHistoryVisible && row.lastReminderSentAt ? (
                              <span className="muted">
                                {t("invoices.collections.lastReminderLabel", {
                                  value: formatDateTime(row.lastReminderSentAt),
                                })}
                              </span>
                            ) : row.reminderReady ? (
                              <span className="muted">
                                {t("invoices.collections.reminderNeverSent")}
                              </span>
                            ) : null}
                            {row.reminderCount > 0 ? (
                              <span className="muted">
                                {t("invoices.collections.reminderCountLabel", {
                                  count: row.reminderCount,
                                })}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          <div
                            className="quick-links"
                            style={{ gap: 8, flexWrap: "wrap" }}
                          >
                            <Link className="btn secondary" href={row.invoiceHref}>
                              {t("invoices.openInvoice")}
                            </Link>
                            {row.checkoutRecovery.activeCheckoutUrl ? (
                              <a
                                className="btn secondary"
                                href={row.checkoutRecovery.activeCheckoutUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {t("invoices.collections.openPayLink")}
                              </a>
                            ) : null}
                            {canTriggerInvoiceQueueActions &&
                            needsFreshLinkRecovery ? (
                              <form action={sendFreshReminderAction}>
                                <input type="hidden" name="invoiceId" value={row.id} />
                                <input type="hidden" name="orgId" value={scope.orgId} />
                                <input
                                  type="hidden"
                                  name="returnPath"
                                  value={workspacePath}
                                />
                                <button className="btn secondary" type="submit">
                                  {t("invoices.collections.sendFreshReminder")}
                                </button>
                              </form>
                            ) : null}
                            {canTriggerInvoiceQueueActions && row.sendMode ? (
                              <SendInvoiceModal
                                businessName={scope.orgName}
                                buttonClassName="btn secondary"
                                buttonLabel={row.sendButtonLabel}
                                customerEmail={row.customer.email}
                                customerName={row.customer.name}
                                defaultRefreshPayLink={
                                  row.sendMode === "reminder" &&
                                  row.rowOnlinePaymentsReady &&
                                  row.checkoutRecovery.issue !== null
                                }
                                invoiceNumber={formatInvoiceNumber(row.invoiceNumber)}
                                mode={row.sendMode}
                                onlinePaymentsAvailable={row.rowOnlinePaymentsReady}
                                previewHref={row.pdfPreviewHref}
                                sendHref={row.sendHref}
                              />
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </>
  );
}
