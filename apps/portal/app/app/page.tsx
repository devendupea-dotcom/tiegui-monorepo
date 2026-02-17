import Link from "next/link";
import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { endOfToday, formatDateTime, isOverdueFollowUp, startOfToday } from "@/lib/hq";
import { getRequestTranslator } from "@/lib/i18n";
import { translatePriorityLabel, translateStatusLabel } from "@/lib/i18n-labels";
import { requireSessionUser } from "@/lib/session";
import { getParam, isOpenJobStatus, resolveAppScope, withOrgQuery } from "./_lib/portal-scope";

export const dynamic = "force-dynamic";

type TodayItem = {
  id: string;
  type: string;
  title: string;
  when: Date;
  leadId: string | null;
};

function toMapsHref(value: string) {
  return `https://maps.google.com/?q=${encodeURIComponent(value)}`;
}

function formatTimeOnly(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function formatUsdCents(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value / 100);
}

export default async function AppHomePage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  try {
    const t = await getRequestTranslator();
    const requestedOrgId = getParam(searchParams?.orgId);
    const scope = await resolveAppScope({ nextPath: "/app", requestedOrgId });
    if (scope.internalUser) {
      redirect(withOrgQuery("/app/calendar", scope.orgId, true));
    }
    const sessionUser = await requireSessionUser("/app");
    let currentUser:
      | {
          id: string;
          calendarAccessRole: string;
        }
      | null = null;
    if (sessionUser.id && !scope.internalUser) {
      try {
        currentUser = await prisma.user.findUnique({
          where: { id: sessionUser.id },
          select: { id: true, calendarAccessRole: true },
        });
      } catch (error) {
        // Keep /app available even when runtime schema drifts behind deployed code.
        console.error("AppHomePage failed to load calendar access role. Falling back to org-scoped defaults.", error);
      }
    }
    const workerScoped = !scope.internalUser && currentUser?.calendarAccessRole === "WORKER";
    const workerId = workerScoped ? currentUser!.id : null;

  const now = new Date();
  const todayStart = startOfToday(now);
  const todayEnd = endOfToday(now);
  const weekStart = startOfToday(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000));

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

  let followUps: Array<{
    id: string;
    contactName: string | null;
    businessName: string | null;
    phoneE164: string;
    nextFollowUpAt: Date | null;
  }> = [];
  let events: Array<{
    id: string;
    type: string;
    title: string;
    startAt: Date;
    leadId: string | null;
  }> = [];
  let jobs: Array<{
    id: string;
    contactName: string | null;
    businessName: string | null;
    phoneE164: string;
    status: string;
    priority: string;
    nextFollowUpAt: Date | null;
    updatedAt: Date;
  }> = [];
  let nextEvent: {
    id: string;
    type: string;
    title: string;
    startAt: Date;
    leadId: string | null;
    customerName: string | null;
    addressLine: string | null;
    lead: {
      id: string;
      status: string;
      priority: string;
      contactName: string | null;
      businessName: string | null;
      city: string | null;
      phoneE164: string;
    } | null;
  } | null = null;
  let weeklyRevenueCents = 0;
  let jobsBookedCount = 0;
  let leadsWaitingCount = 0;
  let overdueFollowUpCount = 0;

  try {
    const [primaryFollowUps, primaryEvents, primaryJobs, primaryNextEvent, weeklyRevenue, bookedCount, waitingCount, overdueCount] =
      await Promise.all([
        prisma.lead.findMany({
          where: {
            ...leadWhere,
            nextFollowUpAt: {
              gte: todayStart,
              lte: todayEnd,
            },
          },
          orderBy: [{ nextFollowUpAt: "asc" }],
          take: 20,
          select: {
            id: true,
            contactName: true,
            businessName: true,
            phoneE164: true,
            nextFollowUpAt: true,
          },
        }),
        prisma.event.findMany({
          where: {
            ...eventWhere,
            startAt: {
              gte: todayStart,
              lte: todayEnd,
            },
          },
          orderBy: [{ startAt: "asc" }],
          take: 20,
          select: {
            id: true,
            type: true,
            title: true,
            startAt: true,
            leadId: true,
          },
        }),
        prisma.lead.findMany({
          where: {
            ...leadWhere,
            status: {
              notIn: ["NOT_INTERESTED", "DNC"],
            },
          },
          orderBy: [{ updatedAt: "desc" }],
          take: 20,
          select: {
            id: true,
            contactName: true,
            businessName: true,
            phoneE164: true,
            status: true,
            priority: true,
            nextFollowUpAt: true,
            updatedAt: true,
          },
        }),
        prisma.event.findFirst({
          where: {
            ...eventWhere,
            type: { in: ["JOB", "ESTIMATE", "CALL"] },
            startAt: { gte: now },
          },
          orderBy: [{ startAt: "asc" }],
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
                status: true,
                priority: true,
                contactName: true,
                businessName: true,
                city: true,
                phoneE164: true,
              },
            },
          },
        }),
        prisma.lead.aggregate({
          where: {
            ...leadWhere,
            status: "BOOKED",
            updatedAt: {
              gte: weekStart,
              lte: now,
            },
          },
          _sum: {
            estimatedRevenueCents: true,
          },
        }),
        prisma.lead.count({
          where: {
            ...leadWhere,
            status: "BOOKED",
            updatedAt: {
              gte: weekStart,
              lte: now,
            },
          },
        }),
        prisma.lead.count({
          where: {
            ...leadWhere,
            status: {
              in: ["NEW", "CALLED_NO_ANSWER", "VOICEMAIL", "INTERESTED", "FOLLOW_UP"],
            },
          },
        }),
        prisma.lead.count({
          where: {
            ...leadWhere,
            status: {
              notIn: ["BOOKED", "NOT_INTERESTED", "DNC"],
            },
            nextFollowUpAt: {
              lt: now,
            },
          },
        }),
      ]);

    followUps = primaryFollowUps;
    events = primaryEvents;
    jobs = primaryJobs;
    nextEvent = primaryNextEvent;
    weeklyRevenueCents = weeklyRevenue._sum.estimatedRevenueCents ?? 0;
    jobsBookedCount = bookedCount;
    leadsWaitingCount = waitingCount;
    overdueFollowUpCount = overdueCount;
  } catch (error) {
    console.error("AppHomePage failed to load full data set. Serving fallback view.", error);
    const [fallbackFollowUps, fallbackEvents, fallbackJobs, fallbackNextEvent, bookedCount, waitingCount, overdueCount] =
      await Promise.all([
        prisma.lead.findMany({
          where: {
            ...leadWhere,
            nextFollowUpAt: {
              gte: todayStart,
              lte: todayEnd,
            },
          },
          orderBy: [{ nextFollowUpAt: "asc" }],
          take: 20,
          select: {
            id: true,
            contactName: true,
            businessName: true,
            phoneE164: true,
            nextFollowUpAt: true,
          },
        }),
        prisma.event.findMany({
          where: {
            ...eventWhere,
            startAt: {
              gte: todayStart,
              lte: todayEnd,
            },
          },
          orderBy: [{ startAt: "asc" }],
          take: 20,
          select: {
            id: true,
            type: true,
            title: true,
            startAt: true,
            leadId: true,
          },
        }),
        prisma.lead.findMany({
          where: {
            ...leadWhere,
            status: {
              notIn: ["NOT_INTERESTED", "DNC"],
            },
          },
          orderBy: [{ updatedAt: "desc" }],
          take: 20,
          select: {
            id: true,
            contactName: true,
            businessName: true,
            phoneE164: true,
            status: true,
            priority: true,
            nextFollowUpAt: true,
            updatedAt: true,
          },
        }),
        prisma.event.findFirst({
          where: {
            ...eventWhere,
            type: { in: ["JOB", "ESTIMATE", "CALL"] },
            startAt: { gte: now },
          },
          orderBy: [{ startAt: "asc" }],
          select: {
            id: true,
            type: true,
            title: true,
            startAt: true,
            leadId: true,
            lead: {
              select: {
                id: true,
                status: true,
                priority: true,
                contactName: true,
                businessName: true,
                city: true,
                phoneE164: true,
              },
            },
          },
        }),
        prisma.lead.count({
          where: {
            ...leadWhere,
            status: "BOOKED",
            updatedAt: {
              gte: weekStart,
              lte: now,
            },
          },
        }),
        prisma.lead.count({
          where: {
            ...leadWhere,
            status: {
              in: ["NEW", "CALLED_NO_ANSWER", "VOICEMAIL", "INTERESTED", "FOLLOW_UP"],
            },
          },
        }),
        prisma.lead.count({
          where: {
            ...leadWhere,
            status: {
              notIn: ["BOOKED", "NOT_INTERESTED", "DNC"],
            },
            nextFollowUpAt: {
              lt: now,
            },
          },
        }),
      ]);

    followUps = fallbackFollowUps;
    events = fallbackEvents;
    jobs = fallbackJobs;
    nextEvent = fallbackNextEvent
      ? {
          ...fallbackNextEvent,
          customerName: null,
          addressLine: null,
        }
      : null;
    weeklyRevenueCents = 0;
    jobsBookedCount = bookedCount;
    leadsWaitingCount = waitingCount;
    overdueFollowUpCount = overdueCount;
  }

  const todayItems: TodayItem[] = [
    ...followUps
      .filter((lead): lead is typeof lead & { nextFollowUpAt: Date } => Boolean(lead.nextFollowUpAt))
      .map((lead) => ({
        id: `followup-${lead.id}`,
        type: "FOLLOW_UP",
        title: lead.contactName || lead.businessName || lead.phoneE164,
        when: lead.nextFollowUpAt,
        leadId: lead.id,
      })),
    ...events.map((event) => ({
      id: event.id,
      type: event.type,
      title: event.title,
      when: event.startAt,
      leadId: event.leadId,
    })),
  ].sort((a, b) => a.when.getTime() - b.when.getTime());

  const followUpsAll = jobs
    .filter((job) => Boolean(job.nextFollowUpAt))
    .sort((a, b) => {
      const aTime = a.nextFollowUpAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bTime = b.nextFollowUpAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    })
    .slice(0, 20);

  const openJobs = jobs.filter((job) => isOpenJobStatus(job.status)).slice(0, 20);
  const nextJobLabel = nextEvent
    ? nextEvent.customerName || nextEvent.lead?.contactName || nextEvent.lead?.businessName || nextEvent.title
    : null;
  const nextJobPhone = nextEvent?.lead?.phoneE164 || null;
  const nextJobAddress = nextEvent?.addressLine || nextEvent?.lead?.city || null;
  const nextJobOpenHref = nextEvent?.leadId
    ? withOrgQuery(`/app/jobs/${nextEvent.leadId}`, scope.orgId, scope.internalUser)
    : withOrgQuery("/app/calendar", scope.orgId, scope.internalUser);
  const nextJobMapsHref = nextJobAddress ? toMapsHref(nextJobAddress) : null;

    return (
      <>
        <section className="command-strip">
        <article className="command-strip-card">
          <span>{t("today.commandStrip.revenueThisWeek")}</span>
          <strong>{formatUsdCents(weeklyRevenueCents)}</strong>
        </article>
        <article className="command-strip-card">
          <span>{t("today.commandStrip.jobsBooked")}</span>
          <strong>{jobsBookedCount.toLocaleString("en-US")}</strong>
        </article>
        <article className="command-strip-card">
          <span>{t("today.commandStrip.leadsWaiting")}</span>
          <strong>{leadsWaitingCount.toLocaleString("en-US")}</strong>
        </article>
        <article className="command-strip-card">
          <span>{t("today.commandStrip.overdueFollowUps")}</span>
          <strong>{overdueFollowUpCount.toLocaleString("en-US")}</strong>
        </article>
      </section>

      <section className="card app-today-card">
        <h2>{t("today.title")}</h2>
        <p className="muted">{t("today.subtitle")}</p>

        <article className="next-job-card" style={{ marginTop: 12 }}>
          <p className="next-job-kicker">{t("today.nextJob")}</p>
          {nextEvent && nextJobLabel ? (
            <>
              <h3>{nextJobLabel}</h3>
              <p className="next-job-time">{formatDateTime(nextEvent.startAt)}</p>
              <div className="quick-meta" style={{ marginTop: 8 }}>
                <span className={`badge status-${nextEvent.type.toLowerCase()}`}>{translateStatusLabel(nextEvent.type, t)}</span>
                {nextEvent.lead ? (
                  <>
                    <span className={`badge status-${nextEvent.lead.status.toLowerCase()}`}>
                      {translateStatusLabel(nextEvent.lead.status, t)}
                    </span>
                    <span className={`badge priority-${nextEvent.lead.priority.toLowerCase()}`}>
                      {translatePriorityLabel(nextEvent.lead.priority, t)}
                    </span>
                  </>
                ) : null}
              </div>
              <div className="next-job-actions">
                {nextJobPhone ? (
                  <>
                    <a className="btn secondary" href={`tel:${nextJobPhone}`} aria-label={`Call ${nextJobLabel || "customer"}`}>
                      {t("buttons.call")}
                    </a>
                    <a className="btn secondary" href={`sms:${nextJobPhone}`} aria-label={`Text ${nextJobLabel || "customer"}`}>
                      {t("buttons.text")}
                    </a>
                  </>
                ) : null}
                {nextJobMapsHref ? (
                  <a
                    className="btn secondary"
                    href={nextJobMapsHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Open maps for ${nextJobLabel || "job"}`}
                  >
                    {t("buttons.maps")}
                  </a>
                ) : null}
                <Link className="btn primary" href={nextJobOpenHref} aria-label={`Open ${nextJobLabel || "job"} details`}>
                  {t("buttons.openJob")}
                </Link>
              </div>
            </>
          ) : (
            <p className="muted">{t("today.noUpcomingJobs")}</p>
          )}
        </article>

        {todayItems.length === 0 ? (
          <div className="portal-empty-state">
            <strong>{t("today.activityEmptyTitle")}</strong>
            <ul className="portal-empty-list">
              <li>{t("today.activityEmptyBulletOne")}</li>
              <li>{t("today.activityEmptyBulletTwo")}</li>
              <li>{t("today.activityEmptyBulletThree")}</li>
            </ul>
            <div className="portal-empty-actions">
              <Link className="btn primary" href={withOrgQuery("/app?quickAdd=1", scope.orgId, scope.internalUser)}>
                {t("buttons.addLead")}
              </Link>
              <Link className="btn secondary" href={withOrgQuery("/app/calendar", scope.orgId, scope.internalUser)}>
                {t("appNav.calendar")}
              </Link>
            </div>
          </div>
        ) : (
          <div className="today-timeline-scroll" style={{ marginTop: 12 }}>
            <ul className="today-timeline">
              {todayItems.map((item) => (
                <li key={item.id} className="today-timeline-item">
                  <time className="today-time-block">{formatTimeOnly(item.when)}</time>
                  {item.leadId ? (
                    <Link
                      className="today-timeline-link"
                      href={withOrgQuery(`/app/jobs/${item.leadId}`, scope.orgId, scope.internalUser)}
                    >
                      <article className="today-timeline-card">
                        <div className="stack-cell">
                          <span className={`badge status-${item.type.toLowerCase()}`}>{translateStatusLabel(item.type, t)}</span>
                          <strong>{item.title}</strong>
                        </div>
                        <span className="table-link">{t("buttons.openJob")}</span>
                      </article>
                    </Link>
                  ) : (
                    <article className="today-timeline-card">
                      <div className="stack-cell">
                        <span className={`badge status-${item.type.toLowerCase()}`}>{translateStatusLabel(item.type, t)}</span>
                        <strong>{item.title}</strong>
                      </div>
                      <span className="muted">{t("today.noLinkedJob")}</span>
                    </article>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="card">
        <h2>{t("today.followUpsTitle")}</h2>
        <p className="muted">{t("today.followUpsSubtitle")}</p>
        {followUpsAll.length === 0 ? (
          <div className="portal-empty-state">
            <strong>{t("today.noFollowUps")}</strong>
            <p className="muted">{t("today.activityEmptyBulletTwo")}.</p>
            <div className="portal-empty-actions">
              <Link className="btn primary" href={withOrgQuery("/app?quickAdd=1", scope.orgId, scope.internalUser)}>
                {t("buttons.addLead")}
              </Link>
            </div>
          </div>
        ) : (
          <>
            <ul className="mobile-list-cards" style={{ marginTop: 12 }}>
              {followUpsAll.map((job) => (
                <li key={`fu-mobile-${job.id}`} className="mobile-list-card">
                  <div className="stack-cell">
                    <strong>{job.contactName || job.businessName || job.phoneE164}</strong>
                    <span className={`badge status-${job.status.toLowerCase()}`}>{translateStatusLabel(job.status, t)}</span>
                    <span className="muted">
                      {job.nextFollowUpAt ? formatDateTime(job.nextFollowUpAt) : "-"}
                    </span>
                    {job.nextFollowUpAt && isOverdueFollowUp(job.nextFollowUpAt) ? (
                      <span className="overdue-chip">{t("today.overdue")}</span>
                    ) : null}
                  </div>
                  <div className="mobile-list-card-actions">
                    <Link
                      className="table-link"
                      href={withOrgQuery(`/app/jobs/${job.id}?tab=messages`, scope.orgId, scope.internalUser)}
                    >
                      {t("buttons.openThread")}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>

            <div className="table-wrap desktop-table-only" style={{ marginTop: 12 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t("today.table.job")}</th>
                    <th>{t("today.table.status")}</th>
                    <th>{t("today.table.followUp")}</th>
                    <th>{t("today.table.thread")}</th>
                  </tr>
                </thead>
                <tbody>
                  {followUpsAll.map((job) => (
                    <tr key={job.id}>
                      <td>{job.contactName || job.businessName || job.phoneE164}</td>
                      <td>
                        <span className={`badge status-${job.status.toLowerCase()}`}>{translateStatusLabel(job.status, t)}</span>
                      </td>
                      <td>
                        {job.nextFollowUpAt ? (
                          <div className="stack-cell">
                            <span>{formatDateTime(job.nextFollowUpAt)}</span>
                            {isOverdueFollowUp(job.nextFollowUpAt) ? <span className="overdue-chip">{t("today.overdue")}</span> : null}
                          </div>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td>
                        <Link
                          className="table-link"
                          href={withOrgQuery(`/app/jobs/${job.id}?tab=messages`, scope.orgId, scope.internalUser)}
                        >
                          {t("buttons.open")}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="card">
        <h2>{t("today.openJobsTitle")}</h2>
        <p className="muted">{t("today.openJobsSubtitle")}</p>
        {openJobs.length === 0 ? (
          <div className="portal-empty-state">
            <strong>{t("today.noOpenJobs")}</strong>
            <p className="muted">Add a lead or convert a thread into a scheduled job.</p>
            <div className="portal-empty-actions">
              <Link className="btn primary" href={withOrgQuery("/app?quickAdd=1", scope.orgId, scope.internalUser)}>
                {t("buttons.addLead")}
              </Link>
            </div>
          </div>
        ) : (
          <>
            <ul className="mobile-list-cards" style={{ marginTop: 12 }}>
              {openJobs.map((job) => (
                <li key={`oj-mobile-${job.id}`} className="mobile-list-card">
                  <div className="stack-cell">
                    <strong>{job.contactName || job.businessName || job.phoneE164}</strong>
                    <div className="quick-meta">
                      <span className={`badge status-${job.status.toLowerCase()}`}>{translateStatusLabel(job.status, t)}</span>
                      <span className={`badge priority-${job.priority.toLowerCase()}`}>{translatePriorityLabel(job.priority, t)}</span>
                    </div>
                    <span className="muted">{t("today.updatedPrefix", { value: formatDateTime(job.updatedAt) })}</span>
                  </div>
                  <div className="mobile-list-card-actions">
                    <Link className="table-link" href={withOrgQuery(`/app/jobs/${job.id}`, scope.orgId, scope.internalUser)}>
                      {t("buttons.openJob")}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>

            <div className="table-wrap desktop-table-only" style={{ marginTop: 12 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t("today.table.job")}</th>
                    <th>{t("today.table.status")}</th>
                    <th>{t("today.table.priority")}</th>
                    <th>{t("today.table.updated")}</th>
                  </tr>
                </thead>
                <tbody>
                  {openJobs.map((job) => (
                    <tr key={job.id}>
                      <td>
                        <Link className="table-link" href={withOrgQuery(`/app/jobs/${job.id}`, scope.orgId, scope.internalUser)}>
                          {job.contactName || job.businessName || job.phoneE164}
                        </Link>
                      </td>
                      <td>
                        <span className={`badge status-${job.status.toLowerCase()}`}>{translateStatusLabel(job.status, t)}</span>
                      </td>
                      <td>
                        <span className={`badge priority-${job.priority.toLowerCase()}`}>{translatePriorityLabel(job.priority, t)}</span>
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
  } catch (error) {
    console.error("AppHomePage hard failure.", error);
    return (
      <section className="card">
        <h2>Today view is temporarily unavailable</h2>
        <p className="muted">
          We hit a server issue loading today&apos;s jobs. Use calendar or inbox while we recover this view.
        </p>
        <div className="quick-actions" style={{ marginTop: 12 }}>
          <Link className="btn secondary" href="/app/calendar">
            Open Calendar
          </Link>
          <Link className="btn secondary" href="/app/inbox">
            Open Inbox
          </Link>
        </div>
      </section>
    );
  }
}
