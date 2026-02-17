import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatDateTime, formatLabel, isOverdueFollowUp, leadPriorityOptions, leadStatusOptions } from "@/lib/hq";
import { requireSessionUser } from "@/lib/session";
import { getParam, isOpenJobStatus, resolveAppScope, withOrgQuery } from "../_lib/portal-scope";

export const dynamic = "force-dynamic";

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
  const requestedOrgId = getParam(searchParams?.orgId);
  const status = getParam(searchParams?.status);
  const priority = getParam(searchParams?.priority);
  const openOnly = getParam(searchParams?.openOnly) || "1";

  const scope = await resolveAppScope({ nextPath: "/app/jobs", requestedOrgId });
  if (!scope.onboardingComplete) {
    return (
      <section className="card">
        <h2>Jobs</h2>
        <div className="portal-empty-state">
          <strong>No jobs scheduled yet.</strong>
          <p className="muted">Start by adding a lead or converting a message to a job.</p>
          <div className="portal-empty-actions">
            <Link className="btn primary" href={withOrgQuery("/app?quickAdd=1", scope.orgId, scope.internalUser)}>
              Add Lead
            </Link>
            <Link className="btn secondary" href={withOrgQuery("/app/onboarding?step=1", scope.orgId, scope.internalUser)}>
              Finish Onboarding
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

  if (openOnly === "1") {
    where.status = {
      notIn: ["NOT_INTERESTED", "DNC"],
    };
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
      businessType: true,
      nextFollowUpAt: true,
      updatedAt: true,
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
  const visibleJobs = jobs.filter((job) => (openOnly === "1" ? isOpenJobStatus(job.status) : true));

  return (
    <>
      <section className="card">
        <h2>Jobs</h2>
        <p className="muted">Jobs for this workspace.</p>

        <form className="filters" method="get" style={{ marginTop: 12 }}>
          {scope.internalUser ? <input type="hidden" name="orgId" value={scope.orgId} /> : null}
          <label>
            Status
            <select name="status" defaultValue={status}>
              <option value="">All</option>
              {leadStatusOptions.map((option) => (
                <option key={option} value={option}>
                  {formatLabel(option)}
                </option>
              ))}
            </select>
          </label>

          <label>
            Priority
            <select name="priority" defaultValue={priority}>
              <option value="">All</option>
              {leadPriorityOptions.map((option) => (
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
          <Link className="btn secondary" href={withOrgQuery("/app/jobs?openOnly=1", scope.orgId, scope.internalUser)}>
            Reset
          </Link>
        </form>
      </section>

      <section className="card">
        {visibleJobs.length === 0 ? (
          <div className="portal-empty-state">
            <strong>No jobs scheduled yet.</strong>
            <p className="muted">Start by adding a lead or converting a message to a job.</p>
            <div className="portal-empty-actions">
              <Link className="btn primary" href={withOrgQuery("/app?quickAdd=1", scope.orgId, scope.internalUser)}>
                Add Lead
              </Link>
              <Link className="btn secondary" href={withOrgQuery("/app/inbox", scope.orgId, scope.internalUser)}>
                Open Inbox
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
                    <span className={`badge status-${job.status.toLowerCase()}`}>{formatLabel(job.status)}</span>
                    <span className={`badge priority-${job.priority.toLowerCase()}`}>
                      {formatLabel(job.priority)}
                    </span>
                    {job.invoices[0] ? (
                      <span className={`badge status-${job.invoices[0].status.toLowerCase()}`}>
                        {formatLabel(job.invoices[0].status)}
                      </span>
                    ) : (
                      <span className="badge">No Invoice</span>
                    )}
                  </div>
                  <div className="stack-cell">
                    <span className="muted">
                      {job._count.leadNotes} notes • {job._count.leadPhotos} photos • {job._count.measurements} measurements
                    </span>
                    <span className="muted">
                      {job.city || "-"} • {job.businessType || "-"}
                    </span>
                    <span className="muted">Updated: {formatDateTime(job.updatedAt)}</span>
                    {job.nextFollowUpAt ? (
                      <>
                        <span className="muted">Follow-up: {formatDateTime(job.nextFollowUpAt)}</span>
                        {isOverdueFollowUp(job.nextFollowUpAt) ? <span className="overdue-chip">Overdue</span> : null}
                      </>
                    ) : null}
                  </div>
                  <div className="mobile-list-card-actions">
                    <Link className="btn secondary" href={withOrgQuery(`/app/jobs/${job.id}`, scope.orgId, scope.internalUser)}>
                      Open Job
                    </Link>
                  </div>
                </li>
              ))}
            </ul>

            <div className="table-wrap desktop-table-only">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Status</th>
                    <th>Priority</th>
                    <th>Invoice</th>
                    <th>Folder Data</th>
                    <th>City</th>
                    <th>Type</th>
                    <th>Follow-up</th>
                    <th>Updated</th>
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
                        <span className={`badge status-${job.status.toLowerCase()}`}>{formatLabel(job.status)}</span>
                      </td>
                      <td>
                        <span className={`badge priority-${job.priority.toLowerCase()}`}>
                          {formatLabel(job.priority)}
                        </span>
                      </td>
                      <td>
                        {job.invoices[0] ? (
                          <span className={`badge status-${job.invoices[0].status.toLowerCase()}`}>
                            {formatLabel(job.invoices[0].status)}
                          </span>
                        ) : (
                          <span className="badge">No Invoice</span>
                        )}
                      </td>
                      <td>
                        <div className="stack-cell">
                          <span className="muted">{job._count.leadNotes} notes</span>
                          <span className="muted">{job._count.leadPhotos} photos</span>
                          <span className="muted">{job._count.measurements} measurements</span>
                        </div>
                      </td>
                      <td>{job.city || "-"}</td>
                      <td>{job.businessType || "-"}</td>
                      <td>
                        {job.nextFollowUpAt ? (
                          <div className="stack-cell">
                            <span>{formatDateTime(job.nextFollowUpAt)}</span>
                            {isOverdueFollowUp(job.nextFollowUpAt) ? <span className="overdue-chip">Overdue</span> : null}
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
