import Link from "next/link";
import { Prisma } from "@prisma/client";
import { getRequestTranslator } from "@/lib/i18n";
import { sanitizeLeadBusinessTypeLabel } from "@/lib/lead-display";
import { normalizeLeadCity, resolveLeadLocationLabel } from "@/lib/lead-location";
import { prisma } from "@/lib/prisma";
import { formatDateTime, isOverdueFollowUp, leadPriorityOptions, leadStatusOptions } from "@/lib/hq";
import { requireSessionUser } from "@/lib/session";
import { getParam, isOpenJobStatus, resolveAppScope, withOrgQuery } from "../_lib/portal-scope";

export const dynamic = "force-dynamic";

const ACTIVE_BOOKED_EVENT_STATUSES = ["SCHEDULED", "CONFIRMED", "EN_ROUTE", "ON_SITE", "IN_PROGRESS"] as const;

function isLeadStatus(value: string): value is (typeof leadStatusOptions)[number] {
  return leadStatusOptions.some((option) => option === value);
}

function isLeadPriority(value: string): value is (typeof leadPriorityOptions)[number] {
  return leadPriorityOptions.some((option) => option === value);
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const t = await getRequestTranslator();
  const requestedOrgId = getParam(searchParams?.orgId);
  const status = getParam(searchParams?.status);
  const priority = getParam(searchParams?.priority);
  const openOnly = getParam(searchParams?.openOnly) || "1";

  const scope = await resolveAppScope({ nextPath: "/app/jobs", requestedOrgId });
  if (!scope.onboardingComplete) {
    return (
      <section className="card">
        <h2>{t("jobs.title")}</h2>
        <div className="portal-empty-state">
          <strong>{t("jobs.onboardingEmptyTitle")}</strong>
          <p className="muted">{t("jobs.onboardingEmptyBody")}</p>
          <div className="portal-empty-actions">
            <Link className="btn primary" href={withOrgQuery("/app?quickAdd=1", scope.orgId, scope.internalUser)}>
              {t("buttons.addLead")}
            </Link>
            <Link className="btn secondary" href={withOrgQuery("/app/onboarding?step=1", scope.orgId, scope.internalUser)}>
              {t("buttons.finishOnboarding")}
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const sessionUser = await requireSessionUser("/app/jobs");
  const currentUser =
    sessionUser.id && !scope.internalUser
      ? await prisma.user.findUnique({
          where: { id: sessionUser.id },
          select: { id: true, calendarAccessRole: true },
        })
      : null;
  const workerScoped = !scope.internalUser && currentUser?.calendarAccessRole === "WORKER";
  const workerId = workerScoped ? currentUser!.id : null;

  const where: Prisma.LeadWhereInput = {
    orgId: scope.orgId,
    ...(workerScoped
      ? {
          OR: [
            { assignedToUserId: workerId! },
            { createdByUserId: workerId! },
            { events: { some: { assignedToUserId: workerId! } } },
            { events: { some: { workerAssignments: { some: { workerUserId: workerId! } } } } },
          ],
        }
      : {}),
  };

  if (isLeadStatus(status)) {
    where.status = status;
  }

  if (isLeadPriority(priority)) {
    where.priority = priority;
  }

  const jobs = await prisma.lead.findMany({
    where,
    select: {
      id: true,
      status: true,
      priority: true,
      contactName: true,
      businessName: true,
      phoneE164: true,
      city: true,
      intakeLocationText: true,
      businessType: true,
      nextFollowUpAt: true,
      updatedAt: true,
      customer: {
        select: {
          addressLine: true,
        },
      },
      events: {
        where: {
          type: {
            in: ["JOB", "ESTIMATE"],
          },
          status: {
            in: [...ACTIVE_BOOKED_EVENT_STATUSES],
          },
        },
        select: {
          id: true,
          addressLine: true,
        },
        orderBy: [{ startAt: "asc" }, { createdAt: "asc" }],
        take: 1,
      },
      invoices: {
        select: {
          id: true,
          status: true,
          balanceDue: true,
        },
        orderBy: [{ createdAt: "desc" }],
        take: 1,
      },
      _count: {
        select: {
          leadNotes: true,
          leadPhotos: true,
          measurements: true,
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 500,
  });
  const hydratedJobs = jobs.map((job) => {
    const hasActiveBookedJob = job.events.length > 0;
    const effectiveStatus = job.status === "DNC" ? job.status : hasActiveBookedJob ? "BOOKED" : job.status;
    const locationLabel =
      resolveLeadLocationLabel({
        eventAddressLine: job.events[0]?.addressLine,
        customerAddressLine: job.customer?.addressLine,
        intakeLocationText: job.intakeLocationText,
        city: job.city,
      }) ||
      normalizeLeadCity(job.city) ||
      "-";
    const workTypeLabel = sanitizeLeadBusinessTypeLabel(job.businessType);

    return {
      ...job,
      status: effectiveStatus,
      nextFollowUpAt: hasActiveBookedJob ? null : job.nextFollowUpAt,
      locationLabel,
      workTypeLabel,
    };
  });

  const visibleJobs = hydratedJobs.filter((job) => {
    if (isLeadStatus(status) && job.status !== status) {
      return false;
    }
    if (openOnly === "1" && !isOpenJobStatus(job.status)) {
      return false;
    }
    return true;
  });

  const statusLabel = (value: string) => t(`status.${value.toLowerCase()}` as never);
  const priorityLabel = (value: string) => t(`priority.${value.toLowerCase()}` as never);

  return (
    <>
      <section className="card">
        <h2>{t("jobs.title")}</h2>
        <p className="muted">{t("jobs.subtitle")}</p>
        <div className="portal-empty-actions" style={{ marginTop: 12 }}>
          <Link className="btn secondary" href={withOrgQuery("/app/jobs/records", scope.orgId, scope.internalUser)}>
            {t("jobs.openStructuredRecords")}
          </Link>
          <Link className="btn secondary" href={withOrgQuery("/app/jobs/records/costing", scope.orgId, scope.internalUser)}>
            {t("jobs.openJobCosting")}
          </Link>
        </div>

        <form className="filters" method="get" style={{ marginTop: 12 }}>
          {scope.internalUser ? <input type="hidden" name="orgId" value={scope.orgId} /> : null}
          <label>
            {t("jobs.statusLabel")}
            <select name="status" defaultValue={status}>
              <option value="">All</option>
              {leadStatusOptions.map((option) => (
                <option key={option} value={option}>
                  {statusLabel(option)}
                </option>
              ))}
            </select>
          </label>

          <label>
            {t("jobs.priorityLabel")}
            <select name="priority" defaultValue={priority}>
              <option value="">All</option>
              {leadPriorityOptions.map((option) => (
                <option key={option} value={option}>
                  {priorityLabel(option)}
                </option>
              ))}
            </select>
          </label>

          <label>
            {t("jobs.openOnlyLabel")}
            <select name="openOnly" defaultValue={openOnly}>
              <option value="1">{t("jobs.yes")}</option>
              <option value="0">{t("jobs.no")}</option>
            </select>
          </label>

          <button className="btn primary" type="submit">
            {t("jobs.apply")}
          </button>
          <Link className="btn secondary" href={withOrgQuery("/app/jobs?openOnly=1", scope.orgId, scope.internalUser)}>
            {t("jobs.reset")}
          </Link>
        </form>
      </section>

      <section className="card">
        {visibleJobs.length === 0 ? (
          <div className="portal-empty-state">
            <strong>{t("jobs.onboardingEmptyTitle")}</strong>
            <p className="muted">{t("jobs.onboardingEmptyBody")}</p>
            <div className="portal-empty-actions">
              <Link className="btn primary" href={withOrgQuery("/app?quickAdd=1", scope.orgId, scope.internalUser)}>
                {t("buttons.addLead")}
              </Link>
              <Link className="btn secondary" href={withOrgQuery("/app/inbox", scope.orgId, scope.internalUser)}>
                {t("jobs.openInbox")}
              </Link>
            </div>
          </div>
        ) : (
          <>
            <ul className="mobile-list-cards" style={{ marginTop: 12 }}>
              {visibleJobs.map((job) => (
                <li key={job.id} className="mobile-list-card">
                  <div className="stack-cell">
                    <Link className="table-link" href={withOrgQuery(`/app/jobs/${job.id}`, scope.orgId, scope.internalUser)}>
                      {job.contactName || job.businessName || job.phoneE164}
                    </Link>
                    <span className="muted">{job.phoneE164}</span>
                  </div>
                  <div className="quick-meta">
                    <span className={`badge status-${job.status.toLowerCase()}`}>{statusLabel(job.status)}</span>
                    <span className={`badge priority-${job.priority.toLowerCase()}`}>
                      {priorityLabel(job.priority)}
                    </span>
                    {job.invoices[0] ? (
                      <span className={`badge status-${job.invoices[0].status.toLowerCase()}`}>
                        {statusLabel(job.invoices[0].status)}
                      </span>
                    ) : (
                      <span className="badge">{t("jobs.noInvoice")}</span>
                    )}
                  </div>
                  <div className="stack-cell">
                    <span className="muted">
                      {t("jobs.notesCount", { count: job._count.leadNotes })} • {t("jobs.photosCount", { count: job._count.leadPhotos })} •{" "}
                      {t("jobs.measurementsCount", { count: job._count.measurements })}
                    </span>
                    <span className="muted">
                      {job.locationLabel} • {job.workTypeLabel || "-"}
                    </span>
                    <span className="muted">{t("jobs.updatedLabel", { value: formatDateTime(job.updatedAt) })}</span>
                    {job.nextFollowUpAt ? (
                      <>
                        <span className="muted">{t("jobs.followUpLabel", { value: formatDateTime(job.nextFollowUpAt) })}</span>
                        {isOverdueFollowUp(job.nextFollowUpAt) ? <span className="overdue-chip">{t("jobs.overdue")}</span> : null}
                      </>
                    ) : null}
                  </div>
                  <div className="mobile-list-card-actions">
                    <Link className="btn secondary" href={withOrgQuery(`/app/jobs/${job.id}`, scope.orgId, scope.internalUser)}>
                      {t("buttons.openJob")}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>

            <div className="table-wrap desktop-table-only">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t("jobs.table.job")}</th>
                    <th>{t("jobs.table.status")}</th>
                    <th>{t("jobs.table.priority")}</th>
                    <th>{t("jobs.table.invoice")}</th>
                    <th>{t("jobs.table.folderData")}</th>
                    <th>{t("jobs.table.city")}</th>
                    <th>{t("jobs.table.type")}</th>
                    <th>{t("jobs.table.followUp")}</th>
                    <th>{t("jobs.table.updated")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleJobs.map((job) => (
                    <tr key={job.id}>
                      <td>
                        <Link className="table-link" href={withOrgQuery(`/app/jobs/${job.id}`, scope.orgId, scope.internalUser)}>
                          {job.contactName || job.businessName || job.phoneE164}
                        </Link>
                      </td>
                      <td>
                        <span className={`badge status-${job.status.toLowerCase()}`}>{statusLabel(job.status)}</span>
                      </td>
                      <td>
                        <span className={`badge priority-${job.priority.toLowerCase()}`}>
                          {priorityLabel(job.priority)}
                        </span>
                      </td>
                      <td>
                        {job.invoices[0] ? (
                          <span className={`badge status-${job.invoices[0].status.toLowerCase()}`}>
                            {statusLabel(job.invoices[0].status)}
                          </span>
                        ) : (
                          <span className="badge">{t("jobs.noInvoice")}</span>
                        )}
                      </td>
                      <td>
                        <div className="stack-cell">
                          <span className="muted">{t("jobs.notesCount", { count: job._count.leadNotes })}</span>
                          <span className="muted">{t("jobs.photosCount", { count: job._count.leadPhotos })}</span>
                          <span className="muted">{t("jobs.measurementsCount", { count: job._count.measurements })}</span>
                        </div>
                      </td>
                      <td>{job.locationLabel}</td>
                      <td>{job.workTypeLabel || "-"}</td>
                      <td>
                        {job.nextFollowUpAt ? (
                          <div className="stack-cell">
                            <span>{formatDateTime(job.nextFollowUpAt)}</span>
                            {isOverdueFollowUp(job.nextFollowUpAt) ? <span className="overdue-chip">{t("jobs.overdue")}</span> : null}
                          </div>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td>{formatDateTime(job.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </>
  );
}
