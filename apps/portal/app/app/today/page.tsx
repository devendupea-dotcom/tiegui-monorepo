import Link from "next/link";
import { Prisma, type LeadStatus } from "@prisma/client";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { endOfToday, formatDateTime, isOverdueFollowUp, startOfToday } from "@/lib/hq";
import { requireSessionUser } from "@/lib/session";
import { getParam, resolveAppScope, withOrgQuery } from "../_lib/portal-scope";

export const dynamic = "force-dynamic";

function formatTimeOnly(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function toMapsHref(value: string | null | undefined): string | null {
  if (!value || !value.trim()) {
    return null;
  }
  return `https://maps.google.com/?q=${encodeURIComponent(value)}`;
}

const HOT_LEAD_STATUSES: LeadStatus[] = ["NEW", "CALLED_NO_ANSWER", "VOICEMAIL", "INTERESTED", "FOLLOW_UP"];

export default async function AppTodayMobilePage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const requestedOrgId = getParam(searchParams?.orgId);
  const scope = await resolveAppScope({ nextPath: "/app/today", requestedOrgId });
  const mobileMode = getParam(searchParams?.mobile) === "1";

  if (!mobileMode) {
    redirect(withOrgQuery("/app", scope.orgId, scope.internalUser));
  }

  if (scope.internalUser) {
    redirect(withOrgQuery("/app/calendar", scope.orgId, true));
  }

  const sessionUser = await requireSessionUser("/app/today");
  const currentUser =
    sessionUser.id && !scope.internalUser
      ? await prisma.user.findUnique({
          where: { id: sessionUser.id },
          select: { id: true, calendarAccessRole: true },
        })
      : null;

  const workerScoped = !scope.internalUser && currentUser?.calendarAccessRole === "WORKER";
  const workerId = workerScoped ? currentUser!.id : null;
  const now = new Date();
  const todayStart = startOfToday(now);
  const todayEnd = endOfToday(now);

  const leadWhere: Prisma.LeadWhereInput = {
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

  const eventWhere: Prisma.EventWhereInput = {
    orgId: scope.orgId,
    ...(workerScoped
      ? {
          OR: [
            { assignedToUserId: workerId! },
            { workerAssignments: { some: { workerUserId: workerId! } } },
          ],
        }
      : {}),
  };

  const [nextActions, todaysJobs, hotLeads] = await Promise.all([
    prisma.lead.findMany({
      where: {
        ...leadWhere,
        status: {
          in: HOT_LEAD_STATUSES,
        },
        nextFollowUpAt: {
          not: null,
          lte: todayEnd,
        },
      },
      orderBy: [{ nextFollowUpAt: "asc" }, { updatedAt: "desc" }],
      take: 12,
      select: {
        id: true,
        contactName: true,
        businessName: true,
        phoneE164: true,
        status: true,
        priority: true,
        nextFollowUpAt: true,
      },
    }),
    prisma.event.findMany({
      where: {
        ...eventWhere,
        type: {
          in: ["JOB", "ESTIMATE", "CALL"],
        },
        startAt: {
          gte: todayStart,
          lte: todayEnd,
        },
      },
      orderBy: [{ startAt: "asc" }],
      take: 16,
      select: {
        id: true,
        type: true,
        title: true,
        startAt: true,
        leadId: true,
        customerName: true,
        addressLine: true,
        lead: {
          select: {
            id: true,
            contactName: true,
            businessName: true,
            phoneE164: true,
            city: true,
            status: true,
            priority: true,
          },
        },
      },
    }),
    prisma.lead.findMany({
      where: {
        ...leadWhere,
        status: {
          in: HOT_LEAD_STATUSES,
        },
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 12,
      select: {
        id: true,
        contactName: true,
        businessName: true,
        phoneE164: true,
        city: true,
        status: true,
        priority: true,
        updatedAt: true,
      },
    }),
  ]);

  return (
    <section className="today-mobile-shell">
      <article className="card today-mobile-section">
        <header className="today-mobile-section-head">
          <h2>Next Actions</h2>
          <p className="muted">Follow-ups that should be handled first.</p>
        </header>

        {nextActions.length === 0 ? (
          <div className="portal-empty-state">
            <strong>No urgent follow-ups right now.</strong>
            <div className="portal-empty-actions">
              <Link className="btn primary" href={withOrgQuery("/app?quickAdd=1", scope.orgId, scope.internalUser)}>
                Add Lead
              </Link>
            </div>
          </div>
        ) : (
          <ul className="today-mobile-list">
            {nextActions.map((lead) => {
              const openHref = withOrgQuery(`/app/jobs/${lead.id}`, scope.orgId, scope.internalUser);
              const label = lead.contactName || lead.businessName || lead.phoneE164;
              return (
                <li key={`action-${lead.id}`} className="today-mobile-card">
                  <div className="stack-cell">
                    <strong>{label}</strong>
                    <div className="quick-meta">
                      <span className={`badge status-${lead.status.toLowerCase()}`}>{lead.status.replaceAll("_", " ")}</span>
                      <span className={`badge priority-${lead.priority.toLowerCase()}`}>{lead.priority}</span>
                      {lead.nextFollowUpAt && isOverdueFollowUp(lead.nextFollowUpAt) ? (
                        <span className="overdue-chip">Overdue</span>
                      ) : null}
                    </div>
                    <span className="muted">
                      Follow-up: {lead.nextFollowUpAt ? formatDateTime(lead.nextFollowUpAt) : "-"}
                    </span>
                  </div>
                  <div className="today-mobile-card-actions">
                    <a className="btn secondary" href={`tel:${lead.phoneE164}`} aria-label={`Call ${label}`}>
                      Call
                    </a>
                    <a className="btn secondary" href={`sms:${lead.phoneE164}`} aria-label={`Text ${label}`}>
                      Text
                    </a>
                    <Link className="btn primary" href={openHref}>
                      Open
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </article>

      <article className="card today-mobile-section">
        <header className="today-mobile-section-head">
          <h2>Today&apos;s Jobs</h2>
          <p className="muted">Timeline-ready jobs and estimates for today.</p>
        </header>

        {todaysJobs.length === 0 ? (
          <div className="portal-empty-state">
            <strong>No jobs scheduled for today yet.</strong>
            <div className="portal-empty-actions">
              <Link className="btn primary" href={withOrgQuery("/app/calendar", scope.orgId, scope.internalUser)}>
                Open Calendar
              </Link>
            </div>
          </div>
        ) : (
          <ul className="today-mobile-list">
            {todaysJobs.map((job) => {
              const label = job.customerName || job.lead?.contactName || job.lead?.businessName || job.title;
              const phone = job.lead?.phoneE164 || null;
              const mapsHref = toMapsHref(job.addressLine || job.lead?.city || null);
              const openHref = job.leadId
                ? withOrgQuery(`/app/jobs/${job.leadId}`, scope.orgId, scope.internalUser)
                : withOrgQuery("/app/calendar", scope.orgId, scope.internalUser);

              return (
                <li key={`job-${job.id}`} className="today-mobile-card">
                  <div className="stack-cell">
                    <strong>{label}</strong>
                    <span className="muted">
                      {formatTimeOnly(job.startAt)} • {job.type.replaceAll("_", " ")}
                    </span>
                    {mapsHref ? (
                      <a className="table-link" href={mapsHref} target="_blank" rel="noopener noreferrer">
                        Open address
                      </a>
                    ) : null}
                  </div>
                  <div className="today-mobile-card-actions">
                    {phone ? (
                      <>
                        <a className="btn secondary" href={`tel:${phone}`} aria-label={`Call ${label}`}>
                          Call
                        </a>
                        <a className="btn secondary" href={`sms:${phone}`} aria-label={`Text ${label}`}>
                          Text
                        </a>
                      </>
                    ) : (
                      <>
                        <span className="btn secondary" aria-hidden="true">
                          Call
                        </span>
                        <span className="btn secondary" aria-hidden="true">
                          Text
                        </span>
                      </>
                    )}
                    <Link className="btn primary" href={openHref}>
                      Open
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </article>

      <article className="card today-mobile-section">
        <header className="today-mobile-section-head">
          <h2>Hot Leads</h2>
          <p className="muted">Recent leads most likely to convert now.</p>
        </header>

        {hotLeads.length === 0 ? (
          <div className="portal-empty-state">
            <strong>No hot leads yet.</strong>
            <div className="portal-empty-actions">
              <Link className="btn primary" href={withOrgQuery("/app?quickAdd=1", scope.orgId, scope.internalUser)}>
                Add Lead
              </Link>
            </div>
          </div>
        ) : (
          <ul className="today-mobile-list">
            {hotLeads.map((lead) => {
              const label = lead.contactName || lead.businessName || lead.phoneE164;
              const openHref = withOrgQuery(`/app/jobs/${lead.id}`, scope.orgId, scope.internalUser);
              return (
                <li key={`hot-${lead.id}`} className="today-mobile-card">
                  <div className="stack-cell">
                    <strong>{label}</strong>
                    <div className="quick-meta">
                      <span className={`badge status-${lead.status.toLowerCase()}`}>{lead.status.replaceAll("_", " ")}</span>
                      <span className={`badge priority-${lead.priority.toLowerCase()}`}>{lead.priority}</span>
                    </div>
                    <span className="muted">
                      Updated: {formatDateTime(lead.updatedAt)}
                      {lead.city ? ` • ${lead.city}` : ""}
                    </span>
                  </div>
                  <div className="today-mobile-card-actions">
                    <a className="btn secondary" href={`tel:${lead.phoneE164}`} aria-label={`Call ${label}`}>
                      Call
                    </a>
                    <a className="btn secondary" href={`sms:${lead.phoneE164}`} aria-label={`Text ${label}`}>
                      Text
                    </a>
                    <Link className="btn primary" href={openHref}>
                      Open
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </article>
    </section>
  );
}
