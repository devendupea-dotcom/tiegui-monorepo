import Link from "next/link";
import { Prisma } from "@prisma/client";
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
  const t = await getRequestTranslator();
  const requestedOrgId = getParam(searchParams?.orgId);
  const scope = await resolveAppScope({ nextPath: "/app", requestedOrgId });
  const sessionUser = await requireSessionUser("/app");
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

  const [followUps, events, jobs, nextEvent, weeklyRevenue, jobsBookedCount, leadsWaitingCount, overdueFollowUpCount] = await Promise.all([
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
  const weeklyRevenueCents = weeklyRevenue._sum.estimatedRevenueCents ?? 0;

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
                    <a className="btn secondary" href={`tel:${nextJobPhone}`}>
                      {t("buttons.call")}
                    </a>
                    <a className="btn secondary" href={`sms:${nextJobPhone}`}>
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
                  >
                    {t("buttons.maps")}
                  </a>
                ) : null}
                <Link className="btn primary" href={nextJobOpenHref}>
                  {t("buttons.openJob")}
                </Link>
              </div>
            </>
          ) : (
            <p className="muted">{t("today.noUpcomingJobs")}</p>
          )}
        </article>

        {todayItems.length === 0 ? (
          <p className="muted" style={{ marginTop: 12 }}>
            {t("today.nothingScheduledToday")}
          </p>
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
          <p className="muted" style={{ marginTop: 12 }}>
            {t("today.noFollowUps")}
          </p>
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
          <p className="muted" style={{ marginTop: 12 }}>
            {t("today.noOpenJobs")}
          </p>
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
}
