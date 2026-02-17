import Link from "next/link";
import { Prisma, type BillingInvoiceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatDateTime, formatLabel } from "@/lib/hq";
import { billingInvoiceStatusOptions, formatCurrency, formatInvoiceNumber } from "@/lib/invoices";
import { requireSessionUser } from "@/lib/session";
import { getParam, resolveAppScope, withOrgQuery } from "../_lib/portal-scope";

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
  const requestedOrgId = getParam(searchParams?.orgId);
  const status = getParam(searchParams?.status).toUpperCase();
  const openOnly = getParam(searchParams?.openOnly) || "1";

  const scope = await resolveAppScope({ nextPath: "/app/invoices", requestedOrgId });
  if (!scope.onboardingComplete) {
    return (
      <section className="card invoice-card">
        <h2>Invoices</h2>
        <div className="portal-empty-state">
          <strong>No invoices yet.</strong>
          <p className="muted">Finish onboarding, then open a job folder and create your first invoice.</p>
          <div className="portal-empty-actions">
            <Link className="btn secondary" href={withOrgQuery("/app/onboarding?step=1", scope.orgId, scope.internalUser)}>
              Finish Onboarding
            </Link>
            <Link className="btn primary" href={withOrgQuery("/app/jobs", scope.orgId, scope.internalUser)}>
              Open Jobs
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const sessionUser = await requireSessionUser("/app/invoices");
  const currentUser =
    sessionUser.id && !scope.internalUser
      ? await prisma.user.findUnique({
          where: { id: sessionUser.id },
          select: { id: true, calendarAccessRole: true },
        })
      : null;
  const workerScoped = !scope.internalUser && currentUser?.calendarAccessRole === "WORKER";
  const workerId = workerScoped ? currentUser!.id : null;

  const where: Prisma.InvoiceWhereInput = {
    orgId: scope.orgId,
    ...(workerScoped
      ? {
          job: {
            OR: [
              { assignedToUserId: workerId! },
              { createdByUserId: workerId! },
              { events: { some: { assignedToUserId: workerId! } } },
              { events: { some: { workerAssignments: { some: { workerUserId: workerId! } } } } },
            ],
          },
        }
      : {}),
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
        job: {
          select: {
            id: true,
            contactName: true,
            businessName: true,
            phoneE164: true,
          },
        },
      },
      orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }],
      take: 500,
    }),
    prisma.invoice.groupBy({
      by: ["status"],
      where: {
        orgId: scope.orgId,
      },
      _count: {
        _all: true,
      },
    }),
  ]);

  const counts = Object.fromEntries(statusCounts.map((row) => [row.status, row._count._all])) as Record<string, number>;

  return (
    <>
      <section className="card invoice-card">
        <h2>Invoices</h2>
        <p className="muted">Create, send, and track manual payments with client-ready PDFs.</p>

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
            Invoice status
            <select name="status" defaultValue={status}>
              <option value="">All</option>
              {billingInvoiceStatusOptions.map((option) => (
                <option key={option} value={option}>
                  {formatLabel(option)}
                </option>
              ))}
            </select>
          </label>

          <label>
            Open only
            <select name="openOnly" defaultValue={openOnly}>
              <option value="1">Yes</option>
              <option value="0">No</option>
            </select>
          </label>

          <button className="btn primary" type="submit">
            Apply
          </button>
          <Link className="btn secondary" href={withOrgQuery("/app/invoices?openOnly=1", scope.orgId, scope.internalUser)}>
            Reset
          </Link>
        </form>
      </section>

      <section className="card invoice-card">
        {rows.length === 0 ? (
          <div className="portal-empty-state">
            <strong>No invoices yet.</strong>
            <p className="muted">Open a job folder and click Create Invoice.</p>
            <div className="portal-empty-actions">
              <Link className="btn primary" href={withOrgQuery("/app/jobs", scope.orgId, scope.internalUser)}>
                Open Jobs
              </Link>
            </div>
          </div>
        ) : (
          <>
            <ul className="mobile-list-cards" style={{ marginTop: 12 }}>
              {rows.map((row) => {
                const invoiceHref = withOrgQuery(`/app/invoices/${row.id}`, scope.orgId, scope.internalUser);
                const jobHref = row.jobId
                  ? withOrgQuery(`/app/jobs/${row.jobId}?tab=invoice`, scope.orgId, scope.internalUser)
                  : null;
                const jobLabel = row.job
                  ? row.job.contactName || row.job.businessName || row.job.phoneE164
                  : "-";

                return (
                  <li key={row.id} className="mobile-list-card">
                    <div className="stack-cell">
                      <Link className="table-link" href={invoiceHref}>
                        {formatInvoiceNumber(row.invoiceNumber)}
                      </Link>
                      <span className="muted">{row.customer.name}</span>
                    </div>
                    <div className="quick-meta">
                      <span className={`badge status-${row.status.toLowerCase()}`}>{formatLabel(row.status)}</span>
                      <span className="badge">Bal {formatCurrency(row.balanceDue)}</span>
                    </div>
                    <div className="stack-cell">
                      <span className="muted">Total: {formatCurrency(row.total)}</span>
                      <span className="muted">Paid: {formatCurrency(row.amountPaid)}</span>
                      <span className="muted">Due: {formatDateTime(row.dueDate)}</span>
                      <span className="muted">Updated: {formatDateTime(row.updatedAt)}</span>
                      {jobHref ? (
                        <Link className="table-link" href={jobHref}>
                          Job: {jobLabel}
                        </Link>
                      ) : (
                        <span className="muted">Job: {jobLabel}</span>
                      )}
                    </div>
                    <div className="mobile-list-card-actions">
                      <Link className="btn secondary" href={invoiceHref}>
                        Open Invoice
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
                    <th>Invoice</th>
                    <th>Customer</th>
                    <th>Job</th>
                    <th>Status</th>
                    <th>Total</th>
                    <th>Paid</th>
                    <th>Balance</th>
                    <th>Due</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const invoiceHref = withOrgQuery(`/app/invoices/${row.id}`, scope.orgId, scope.internalUser);
                    const jobHref = row.jobId
                      ? withOrgQuery(`/app/jobs/${row.jobId}?tab=invoice`, scope.orgId, scope.internalUser)
                      : null;
                    const jobLabel = row.job
                      ? row.job.contactName || row.job.businessName || row.job.phoneE164
                      : "-";

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
                          <span className={`badge status-${row.status.toLowerCase()}`}>{formatLabel(row.status)}</span>
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
