import Link from "next/link";
import { Prisma, type BillingInvoiceStatus } from "@prisma/client";
import { getRequestTranslator } from "@/lib/i18n";
import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/hq";
import {
  billingInvoiceStatusOptions,
  buildInvoiceWorkerLeadAccessWhere,
  formatCurrency,
  formatInvoiceNumber,
  getInvoiceReadJobContext,
} from "@/lib/invoices";
import { getParam, resolveAppScope, withOrgQuery } from "../_lib/portal-scope";
import { isWorkerScopedPageViewer, requireAppPageViewer } from "../_lib/portal-viewer";

export const dynamic = "force-dynamic";

function isBillingStatus(value: string): value is BillingInvoiceStatus {
  return billingInvoiceStatusOptions.some((option) => option === value);
}

const OPEN_INVOICE_STATUSES: BillingInvoiceStatus[] = ["DRAFT", "SENT", "PARTIAL", "OVERDUE"];

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const t = await getRequestTranslator();
  const requestedOrgId = getParam(searchParams?.orgId);
  const status = getParam(searchParams?.status).toUpperCase();
  const openOnly = getParam(searchParams?.openOnly) || "0";

  const scope = await resolveAppScope({ nextPath: "/app/invoices", requestedOrgId });
  if (!scope.onboardingComplete) {
    return (
      <section className="card invoice-card">
        <h2>{t("invoices.title")}</h2>
        <div className="portal-empty-state">
          <strong>{t("invoices.emptyTitle")}</strong>
          <p className="muted">{t("invoices.onboardingBody")}</p>
          <div className="portal-empty-actions">
            <Link className="btn secondary" href={withOrgQuery("/app/onboarding?step=1", scope.orgId, scope.internalUser)}>
              {t("buttons.finishOnboarding")}
            </Link>
            <Link className="btn primary" href={withOrgQuery("/app/jobs", scope.orgId, scope.internalUser)}>
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
  const workerScoped = isWorkerScopedPageViewer(viewer);
  const workerId = workerScoped ? viewer.id : null;
  const workerLeadAccessWhere = workerId ? buildInvoiceWorkerLeadAccessWhere({ actorId: workerId }) : null;

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

  if (isBillingStatus(status)) {
    where.status = status;
  }

  if (openOnly === "1") {
    where.status = where.status ? where.status : { in: OPEN_INVOICE_STATUSES };
  }

  const [rows, statusCounts] = await Promise.all([
    prisma.invoice.findMany({
      where,
      include: {
        customer: {
          select: {
            id: true,
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
  ]);

  const counts = Object.fromEntries(statusCounts.map((row) => [row.status, row._count._all])) as Record<string, number>;
  const totalInvoices = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const hasFiltersApplied = Boolean(status) || openOnly === "1";
  const statusLabel = (value: string) => t(`status.${value.toLowerCase()}` as never);

  return (
    <>
      <section className="card invoice-card">
        <h2>{t("invoices.title")}</h2>
        <p className="muted">{t("invoices.subtitle")}</p>

        <div className="quick-meta" style={{ marginTop: 12 }}>
          <span className="badge status-draft">Draft: {counts.DRAFT || 0}</span>
          <span className="badge status-sent">Sent: {counts.SENT || 0}</span>
          <span className="badge status-partial">Partial: {counts.PARTIAL || 0}</span>
          <span className="badge status-paid">Paid: {counts.PAID || 0}</span>
          <span className="badge status-overdue">Overdue: {counts.OVERDUE || 0}</span>
        </div>

        <form className="filters" method="get" style={{ marginTop: 12 }}>
          {scope.internalUser ? <input type="hidden" name="orgId" value={scope.orgId} /> : null}

          <label>
            {t("invoices.statusLabel")}
            <select name="status" defaultValue={status}>
              <option value="">All</option>
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

          <button className="btn primary" type="submit">
            {t("invoices.apply")}
          </button>
          <Link className="btn secondary" href={withOrgQuery("/app/invoices", scope.orgId, scope.internalUser)}>
            {t("invoices.reset")}
          </Link>
        </form>
      </section>

      <section className="card invoice-card">
        {rows.length === 0 ? (
          <div className="portal-empty-state">
            <strong>{totalInvoices > 0 ? t("invoices.emptyFilteredTitle") : t("invoices.emptyTitle")}</strong>
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
              <Link className="btn primary" href={withOrgQuery("/app/jobs", scope.orgId, scope.internalUser)}>
                {t("jobs.title")}
              </Link>
            </div>
          </div>
        ) : (
          <>
            <ul className="mobile-list-cards" style={{ marginTop: 12 }}>
              {rows.map((row) => {
                const invoiceHref = withOrgQuery(`/app/invoices/${row.id}`, scope.orgId, scope.internalUser);
                const jobContext = getInvoiceReadJobContext({
                  legacyLeadId: row.legacyLeadId,
                  sourceJobId: row.sourceJobId,
                  legacyLead: row.legacyLead,
                  sourceJob: row.sourceJob,
                });
                const jobHref = jobContext.operationalJobId
                  ? withOrgQuery(`/app/jobs/records/${jobContext.operationalJobId}`, scope.orgId, scope.internalUser)
                  : jobContext.crmLeadId
                    ? withOrgQuery(`/app/jobs/${jobContext.crmLeadId}?tab=invoice`, scope.orgId, scope.internalUser)
                    : null;
                const jobLabel = jobContext.primaryLabel || "-";

                return (
                  <li key={row.id} className="mobile-list-card">
                    <div className="stack-cell">
                      <Link className="table-link" href={invoiceHref}>
                        {formatInvoiceNumber(row.invoiceNumber)}
                      </Link>
                      <span className="muted">{row.customer.name}</span>
                    </div>
                    <div className="quick-meta">
                      <span className={`badge status-${row.status.toLowerCase()}`}>{statusLabel(row.status)}</span>
                      <span className="badge">{t("invoices.balanceShort", { amount: formatCurrency(row.balanceDue) })}</span>
                    </div>
                    <div className="stack-cell">
                      <span className="muted">{t("invoices.totalLabel", { amount: formatCurrency(row.total) })}</span>
                      <span className="muted">{t("invoices.paidLabel", { amount: formatCurrency(row.amountPaid) })}</span>
                      <span className="muted">{t("invoices.dueLabel", { value: formatDateTime(row.dueDate) })}</span>
                      <span className="muted">{t("invoices.updatedLabel", { value: formatDateTime(row.updatedAt) })}</span>
                      {jobHref ? (
                        <Link className="table-link" href={jobHref}>
                          {t("invoices.jobLabel", { value: jobLabel })}
                        </Link>
                      ) : (
                        <span className="muted">{t("invoices.jobLabel", { value: jobLabel })}</span>
                      )}
                    </div>
                    <div className="mobile-list-card-actions">
                      <Link className="btn secondary" href={invoiceHref}>
                        {t("invoices.openInvoice")}
                      </Link>
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
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const invoiceHref = withOrgQuery(`/app/invoices/${row.id}`, scope.orgId, scope.internalUser);
                    const jobContext = getInvoiceReadJobContext({
                      legacyLeadId: row.legacyLeadId,
                      sourceJobId: row.sourceJobId,
                      legacyLead: row.legacyLead,
                      sourceJob: row.sourceJob,
                    });
                    const jobHref = jobContext.operationalJobId
                      ? withOrgQuery(`/app/jobs/records/${jobContext.operationalJobId}`, scope.orgId, scope.internalUser)
                      : jobContext.crmLeadId
                        ? withOrgQuery(`/app/jobs/${jobContext.crmLeadId}?tab=invoice`, scope.orgId, scope.internalUser)
                        : null;
                    const jobLabel = jobContext.primaryLabel || "-";

                    return (
                      <tr key={row.id}>
                        <td>
                          <Link className="table-link" href={invoiceHref}>
                            {formatInvoiceNumber(row.invoiceNumber)}
                          </Link>
                        </td>
                        <td>{row.customer.name}</td>
                        <td>
                          {jobHref ? (
                            <Link className="table-link" href={jobHref}>
                              {jobLabel}
                            </Link>
                          ) : (
                            jobLabel
                          )}
                        </td>
                        <td>
                          <span className={`badge status-${row.status.toLowerCase()}`}>{statusLabel(row.status)}</span>
                        </td>
                        <td>{formatCurrency(row.total)}</td>
                        <td>{formatCurrency(row.amountPaid)}</td>
                        <td>{formatCurrency(row.balanceDue)}</td>
                        <td>{formatDateTime(row.dueDate)}</td>
                        <td>{formatDateTime(row.updatedAt)}</td>
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
