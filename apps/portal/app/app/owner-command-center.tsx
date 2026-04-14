import Link from "next/link";
import { addDays, startOfDay } from "date-fns";
import type { LeadSourceChannel } from "@prisma/client";
import type { AnalyticsViewer } from "@/lib/portal-analytics";
import { getRequestLocale, getRequestTranslator } from "@/lib/i18n";
import { translateStatusLabel } from "@/lib/i18n-labels";
import { getPortalSummaryMetrics } from "@/lib/portal-analytics";
import { prisma } from "@/lib/prisma";
import type { AppScope } from "./_lib/portal-scope";
import { withOrgQuery } from "./_lib/portal-scope";
import { KpiCard, PanelCard, StatusPill } from "./dashboard-ui";
import WorkflowGuidanceCard from "./workflow-guidance-card";

type OwnerCommandCenterProps = {
  scope: AppScope;
  viewer: AnalyticsViewer;
};

type DashboardTranslator = Awaited<ReturnType<typeof getRequestTranslator>>;

function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

function formatMetricValue(value: number, locale: string, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits,
  }).format(value);
}

function sourceLabel(channel: LeadSourceChannel, t: DashboardTranslator): string {
  switch (channel) {
    case "GOOGLE_ADS":
      return t("dashboard.owner.sources.google");
    case "META_ADS":
      return t("dashboard.owner.sources.meta");
    case "ORGANIC":
    case "REFERRAL":
      return t("dashboard.owner.sources.direct");
    case "OTHER":
    default:
      return t("dashboard.owner.sources.other");
  }
}

function formatResponseTime(value: number | null, locale: string, t: DashboardTranslator): string {
  if (value === null) return t("dashboard.common.emptyValue");
  if (value < 1) return t("dashboard.common.lessThanMinute");
  if (value >= 60) {
    const hours = value / 60;
    return t("dashboard.common.hoursShort", {
      value: formatMetricValue(hours, locale, hours >= 10 ? 0 : 1),
    });
  }
  return t("dashboard.common.minutesShort", {
    value: formatMetricValue(value, locale, value >= 10 ? 0 : 1),
  });
}

function formatDateLabel(value: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function formatTimeLabel(value: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function sourceTone(channel: LeadSourceChannel) {
  switch (channel) {
    case "GOOGLE_ADS":
      return "accent" as const;
    case "META_ADS":
      return "good" as const;
    case "REFERRAL":
      return "good" as const;
    case "ORGANIC":
      return "neutral" as const;
    case "OTHER":
    default:
      return "warn" as const;
  }
}

function statusTone(status: "ACTIVE" | "NEEDS_SETUP" | "CONNECTED" | "CONFIGURED" | "NOT_CONFIGURED") {
  return status === "ACTIVE" || status === "CONNECTED" || status === "CONFIGURED" ? "good" : "warn";
}

export default async function OwnerCommandCenter({ scope, viewer }: OwnerCommandCenterProps) {
  const t = await getRequestTranslator();
  const locale = getRequestLocale();
  const now = new Date();
  const nextWeek = addDays(startOfDay(now), 7);
  const summaryMonthPromise = getPortalSummaryMetrics({ viewer, range: "month" });
  const summaryWeekPromise = getPortalSummaryMetrics({ viewer, range: "7d" });

  const [summaryMonth, summaryWeek, newestLeads, upcomingJobs] = await Promise.all([
    summaryMonthPromise,
    summaryWeekPromise,
    prisma.lead.findMany({
      where: {
        orgId: scope.orgId,
      },
      orderBy: [{ createdAt: "desc" }],
      take: 5,
      select: {
        id: true,
        contactName: true,
        businessName: true,
        phoneE164: true,
        city: true,
        createdAt: true,
        sourceChannel: true,
      },
    }),
    prisma.event.findMany({
      where: {
        orgId: scope.orgId,
        type: "JOB",
        status: { not: "CANCELLED" },
        startAt: {
          gte: now,
          lt: nextWeek,
        },
      },
      orderBy: [{ startAt: "asc" }],
      take: 5,
      select: {
        id: true,
        startAt: true,
        status: true,
        addressLine: true,
        customerName: true,
        leadId: true,
        lead: {
          select: {
            contactName: true,
            businessName: true,
            phoneE164: true,
          },
        },
      },
    }),
  ]);

  const inboxHref = withOrgQuery("/app/inbox", scope.orgId, scope.internalUser);
  const quickLeadHref = withOrgQuery("/app?quickAdd=1", scope.orgId, scope.internalUser);
  const addJobHref = withOrgQuery("/app/calendar?quickAction=schedule", scope.orgId, scope.internalUser);
  const calendarHref = withOrgQuery("/app/calendar", scope.orgId, scope.internalUser);
  const settingsHref = withOrgQuery("/app/settings", scope.orgId, scope.internalUser);
  const allSystemsReady =
    summaryMonth.systemHealth.messaging === "ACTIVE" &&
    summaryMonth.systemHealth.calendar === "CONNECTED" &&
    summaryMonth.systemHealth.integrations === "CONFIGURED";
  const missedCallRecoveryCount = summaryWeek.missedCallsRecoveredCount || 0;
  const todayLabel = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);
  const leadsWaitingCount = summaryWeek.newLeadsCount;
  const activeJobsCount = summaryMonth.jobsThisWeekCount;
  const queueSummary =
    leadsWaitingCount === 0 && activeJobsCount === 0
      ? t("dashboard.owner.queueSummaryClear")
      : t("dashboard.owner.queueSummary", {
          leadsCount: leadsWaitingCount,
          jobsCount: activeJobsCount,
        });

  return (
    <div className="dashboard-shell">
      <section className="card dashboard-header">
        <div className="dashboard-header-main">
          <div className="dashboard-header-copy">
            <h1>{todayLabel}</h1>
            <p className="muted">{queueSummary}</p>
          </div>
          <div className="dashboard-actions">
            <Link className="btn primary" href={quickLeadHref} prefetch={false}>
              {t("dashboard.common.newLead")}
            </Link>
            <Link className="btn secondary" href={addJobHref} prefetch={false}>
              {t("dashboard.common.addJob")}
            </Link>
            <Link className="btn secondary" href={inboxHref} prefetch={false}>
              {t("dashboard.common.inbox")}
            </Link>
          </div>
        </div>
      </section>

      <section className="dashboard-main-grid">
        <div className="dashboard-stack">
          <WorkflowGuidanceCard orgId={scope.orgId} internalUser={scope.internalUser} />

          <PanelCard
            eyebrow={t("dashboard.owner.leadEngine.eyebrow")}
            title={t("dashboard.owner.leadEngine.title")}
            subtitle={t("dashboard.owner.leadEngine.subtitle")}
            actionHref={inboxHref}
            actionLabel={t("dashboard.owner.leadEngine.action")}
          >
            <section className="dashboard-kpi-grid" style={{ gridTemplateColumns: missedCallRecoveryCount ? "repeat(3, minmax(0, 1fr))" : "repeat(2, minmax(0, 1fr))" }}>
              <KpiCard
                label={t("dashboard.owner.leadEngine.newLeadsLabel")}
                value={formatNumber(summaryWeek.newLeadsCount, locale)}
                hint={t("dashboard.owner.leadEngine.newLeadsHint")}
                href={inboxHref}
              />
              <KpiCard
                label={t("dashboard.owner.leadEngine.responseTimeLabel")}
                value={formatResponseTime(summaryWeek.avgResponseTimeMinutes, locale, t)}
                hint={t("dashboard.owner.leadEngine.responseTimeHint")}
                href={inboxHref}
              />
              {missedCallRecoveryCount ? (
                <KpiCard
                  label={t("dashboard.owner.leadEngine.recoveredCallsLabel")}
                  value={formatNumber(missedCallRecoveryCount, locale)}
                  hint={t("dashboard.owner.leadEngine.recoveredCallsHint")}
                  href={inboxHref}
                />
              ) : null}
            </section>

            {newestLeads.length === 0 ? (
              <div className="dashboard-empty-state">
                <strong>{t("dashboard.owner.leadEngine.emptyTitle")}</strong>
                <p className="muted">{t("dashboard.owner.leadEngine.emptyBody")}</p>
                <div className="portal-empty-actions">
                  <Link className="btn primary" href={quickLeadHref}>
                    {t("dashboard.owner.leadEngine.emptyAction")}
                  </Link>
                </div>
              </div>
            ) : (
              <ul className="dashboard-list">
                {newestLeads.map((lead) => {
                  const leadLabel = lead.contactName || lead.businessName || lead.phoneE164;
                  return (
                    <li key={lead.id} className="dashboard-list-row">
                      <div className="dashboard-list-primary">
                        <Link className="dashboard-list-link" href={withOrgQuery(`/app/jobs/${lead.id}?tab=messages`, scope.orgId, scope.internalUser)}>
                          {leadLabel}
                        </Link>
                        <div className="dashboard-list-meta">
                          <StatusPill tone={sourceTone(lead.sourceChannel)}>{sourceLabel(lead.sourceChannel, t)}</StatusPill>
                          <span>{lead.city || lead.phoneE164}</span>
                        </div>
                      </div>
                      <span className="dashboard-list-time">{formatDateLabel(lead.createdAt, locale)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </PanelCard>

          <PanelCard
            eyebrow={t("dashboard.owner.jobsThisWeek.eyebrow")}
            title={t("dashboard.owner.jobsThisWeek.title", { count: summaryMonth.jobsThisWeekCount })}
            subtitle={t("dashboard.owner.jobsThisWeek.subtitle")}
            actionHref={calendarHref}
            actionLabel={t("dashboard.owner.jobsThisWeek.action")}
          >
            {upcomingJobs.length === 0 ? (
              <div className="dashboard-empty-state">
                <strong>{t("dashboard.owner.jobsThisWeek.emptyTitle")}</strong>
                <p className="muted">{t("dashboard.owner.jobsThisWeek.emptyBody")}</p>
                <div className="portal-empty-actions">
                  <Link className="btn primary" href={addJobHref}>
                    {t("dashboard.owner.jobsThisWeek.emptyAction")}
                  </Link>
                </div>
              </div>
            ) : (
              <ul className="dashboard-list">
                {upcomingJobs.map((job) => {
                  const jobLabel =
                    job.customerName
                    || job.lead?.contactName
                    || job.lead?.businessName
                    || job.lead?.phoneE164
                    || t("dashboard.common.scheduledJob");
                  const targetHref = job.leadId
                    ? withOrgQuery(`/app/jobs/${job.leadId}`, scope.orgId, scope.internalUser)
                    : calendarHref;
                  return (
                    <li key={job.id} className="dashboard-list-row">
                      <div className="dashboard-list-primary">
                        <Link className="dashboard-list-link" href={targetHref}>
                          {jobLabel}
                        </Link>
                        <div className="dashboard-list-meta">
                          <StatusPill tone="neutral">{translateStatusLabel(job.status, t)}</StatusPill>
                          <span>{job.addressLine || t("dashboard.common.addressMissing")}</span>
                        </div>
                      </div>
                      <span className="dashboard-list-time">{formatTimeLabel(job.startAt, locale)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </PanelCard>
        </div>

        <div className="dashboard-stack">
          {!allSystemsReady ? (
            <PanelCard
              eyebrow={t("dashboard.owner.setup.eyebrow")}
              title={t("dashboard.owner.setup.title")}
              subtitle={t("dashboard.owner.setup.subtitle")}
              actionHref={settingsHref}
              actionLabel={t("dashboard.owner.setup.action")}
            >
              <div className="dashboard-status-list">
                <div className="dashboard-status-row">
                  <span>{t("dashboard.owner.setup.messaging")}</span>
                  <StatusPill tone={statusTone(summaryMonth.systemHealth.messaging)}>
                    {summaryMonth.systemHealth.messaging === "ACTIVE"
                      ? t("dashboard.owner.setup.active")
                      : t("dashboard.owner.setup.needsSetup")}
                  </StatusPill>
                </div>
                <div className="dashboard-status-row">
                  <span>{t("dashboard.owner.setup.calendar")}</span>
                  <StatusPill tone={statusTone(summaryMonth.systemHealth.calendar)}>
                    {summaryMonth.systemHealth.calendar === "CONNECTED"
                      ? t("dashboard.owner.setup.connected")
                      : t("dashboard.owner.setup.needsSetup")}
                  </StatusPill>
                </div>
                <div className="dashboard-status-row">
                  <span>{t("dashboard.owner.setup.integrations")}</span>
                  <StatusPill tone={statusTone(summaryMonth.systemHealth.integrations)}>
                    {summaryMonth.systemHealth.integrations === "CONFIGURED"
                      ? t("dashboard.owner.setup.configured")
                      : t("dashboard.owner.setup.needsSetup")}
                  </StatusPill>
                </div>
              </div>
            </PanelCard>
          ) : null}
        </div>
      </section>
    </div>
  );
}
