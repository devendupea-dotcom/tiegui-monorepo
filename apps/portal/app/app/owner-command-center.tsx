import Link from "next/link";
import { addDays, startOfDay } from "date-fns";
import type { LeadSourceChannel } from "@prisma/client";
import type { AnalyticsRange, AnalyticsViewer } from "@/lib/portal-analytics";
import { getPortalAdsMetrics, getPortalSummaryMetrics } from "@/lib/portal-analytics";
import { prisma } from "@/lib/prisma";
import type { AppScope } from "./_lib/portal-scope";
import { withOrgQuery } from "./_lib/portal-scope";
import { KpiCard, PanelCard, StatusPill } from "./dashboard-ui";
import RevenueKpiCard from "./revenue-kpi-card";

type OwnerCommandCenterProps = {
  scope: AppScope;
  viewer: AnalyticsViewer;
  range: AnalyticsRange;
};

const RANGE_OPTIONS: Array<{ value: AnalyticsRange; label: string }> = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

const SOURCE_LABELS: Record<LeadSourceChannel, string> = {
  GOOGLE_ADS: "Google",
  META_ADS: "Meta",
  ORGANIC: "Direct",
  REFERRAL: "Direct",
  OTHER: "Other",
};

function formatUsdCents(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value / 100);
}

function formatResponseTime(value: number | null): string {
  if (value === null) return "—";
  if (value < 1) return "<1m";
  if (value >= 60) {
    const hours = value / 60;
    return `${hours.toFixed(hours >= 10 ? 0 : 1)}h`;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)}m`;
}

function formatDateLabel(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function formatTimeLabel(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
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

function buildRangeHref(range: AnalyticsRange, scope: AppScope): string {
  return withOrgQuery(`/app?range=${encodeURIComponent(range)}`, scope.orgId, scope.internalUser);
}

export default async function OwnerCommandCenter({ scope, viewer, range }: OwnerCommandCenterProps) {
  const now = new Date();
  const nextWeek = addDays(startOfDay(now), 7);
  const summaryMonthPromise = getPortalSummaryMetrics({ viewer, range: "month" });
  const summaryWeekPromise = getPortalSummaryMetrics({ viewer, range: "7d" });
  const rangeSummaryPromise = range === "7d" ? Promise.resolve(null) : getPortalSummaryMetrics({ viewer, range });

  const [summaryMonth, summaryWeek, rangeSummary, ads, newestLeads, upcomingJobs] = await Promise.all([
    summaryMonthPromise,
    summaryWeekPromise,
    rangeSummaryPromise,
    getPortalAdsMetrics({ viewer }),
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
  const leadSummary = range === "7d" ? summaryWeek : rangeSummary!;

  const inboxHref = withOrgQuery("/app/inbox", scope.orgId, scope.internalUser);
  const quickLeadHref = withOrgQuery("/app?quickAdd=1", scope.orgId, scope.internalUser);
  const addJobHref = withOrgQuery("/app/calendar?quickAction=schedule", scope.orgId, scope.internalUser);
  const calendarHref = withOrgQuery("/app/calendar", scope.orgId, scope.internalUser);
  const adsHref = withOrgQuery("/app/analytics/ads", scope.orgId, scope.internalUser);
  const settingsHref = withOrgQuery("/app/settings", scope.orgId, scope.internalUser);
  const invoiceHref = withOrgQuery("/app/invoices", scope.orgId, scope.internalUser);
  const paidChannels = ads.channels.filter((channel) => channel.key === "GOOGLE_ADS" || channel.key === "META_ADS");
  const allSystemsReady =
    summaryMonth.systemHealth.messaging === "ACTIVE" &&
    summaryMonth.systemHealth.calendar === "CONNECTED" &&
    summaryMonth.systemHealth.integrations === "CONFIGURED";
  const systemStatusTitle = allSystemsReady ? "Everything connected" : "System status";
  const systemStatusSubtitle = allSystemsReady
    ? "A clean read on the tools the team depends on every day."
    : "See what still needs setup across messaging, calendar, and connected integrations.";

  const marketingKpiValue = ads.totals.spendCents > 0 && ads.totals.roas !== null ? `${ads.totals.roas.toFixed(1)}x` : "Setup required";
  const marketingKpiHint =
    ads.totals.spendCents > 0
      ? "Return on ad spend"
      : "Add ad spend to track ROI";

  return (
    <div className="dashboard-shell">
      <section className="card dashboard-header">
        <div className="dashboard-header-main">
          <div className="dashboard-header-copy">
            <span className="dashboard-header-eyebrow">Owner view</span>
            <h1>Command Center</h1>
            <p className="muted">Cash flow, lead response, jobs on deck, and marketing performance for {scope.orgName}.</p>
          </div>
          <div className="dashboard-actions">
            <Link className="btn primary" href={quickLeadHref} prefetch={false}>
              + New Lead
            </Link>
            <Link className="btn secondary" href={addJobHref} prefetch={false}>
              + Add Job
            </Link>
            <Link className="btn secondary" href={inboxHref} prefetch={false}>
              Inbox
            </Link>
          </div>
        </div>
        <div className="dashboard-header-band">
          <article className="dashboard-header-stat">
            <span>Collected this month</span>
            <strong>{formatUsdCents(summaryMonth.collectedRevenueThisMonthCents)}</strong>
            <small>Cash already recorded</small>
          </article>
          <article className="dashboard-header-stat">
            <span>New leads</span>
            <strong>{summaryWeek.newLeadsCount.toLocaleString("en-US")}</strong>
            <small>Last 7 days</small>
          </article>
          <article className="dashboard-header-stat">
            <span>Avg first reply</span>
            <strong>{formatResponseTime(summaryWeek.avgResponseTimeMinutes)}</strong>
            <small>Response speed this week</small>
          </article>
          <article className="dashboard-header-stat">
            <span>Jobs on deck</span>
            <strong>{summaryMonth.jobsThisWeekCount.toLocaleString("en-US")}</strong>
            <small>Scheduled in the next 7 days</small>
          </article>
        </div>
      </section>

      <section className="dashboard-kpi-grid">
        <RevenueKpiCard
          href={invoiceHref}
          userId={viewer.id}
          grossRevenueThisMonthCents={summaryMonth.grossRevenueThisMonthCents}
          collectedRevenueThisMonthCents={summaryMonth.collectedRevenueThisMonthCents}
        />
        <KpiCard
          label="New leads"
          value={summaryWeek.newLeadsCount.toLocaleString("en-US")}
          hint="Last 7 days"
          href={inboxHref}
        />
        <KpiCard
          label="Response time"
          value={formatResponseTime(summaryWeek.avgResponseTimeMinutes)}
          hint="Avg first reply"
          href={inboxHref}
        />
        <KpiCard
          label="Marketing"
          value={marketingKpiValue}
          hint={marketingKpiHint}
          href={adsHref}
        />
      </section>

      <section className="dashboard-main-grid">
        <div className="dashboard-stack">
          <PanelCard
            eyebrow="Lead Engine"
            title="Leads coming in"
            subtitle="New leads and first replies, without the clutter."
            actionHref={inboxHref}
            actionLabel="Go to Inbox"
          >
            <div className="dashboard-inline-toolbar">
              <div className="dashboard-inline-pills">
                {RANGE_OPTIONS.map((option) => (
                  <Link
                    key={option.value}
                    className={`command-pill ${range === option.value ? "active" : ""}`}
                    href={buildRangeHref(option.value, scope)}
                  >
                    {option.label}
                  </Link>
                ))}
              </div>
              <div className="dashboard-inline-stats">
                <div>
                  <span className="dashboard-inline-label">New leads</span>
                  <strong>{leadSummary.newLeadsCount.toLocaleString("en-US")}</strong>
                </div>
                <div>
                  <span className="dashboard-inline-label">Response time</span>
                  <strong>{formatResponseTime(leadSummary.avgResponseTimeMinutes)}</strong>
                </div>
                {leadSummary.missedCallsRecoveredCount ? (
                  <div>
                    <span className="dashboard-inline-label">Recovered missed calls</span>
                    <strong>{leadSummary.missedCallsRecoveredCount.toLocaleString("en-US")}</strong>
                  </div>
                ) : null}
              </div>
            </div>

            {newestLeads.length === 0 ? (
              <div className="dashboard-empty-state">
                <strong>No leads yet.</strong>
                <p className="muted">Leads will appear here when customers reach out.</p>
                <div className="portal-empty-actions">
                  <Link className="btn primary" href={quickLeadHref}>
                    Add your first lead
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
                          <StatusPill tone={sourceTone(lead.sourceChannel)}>{SOURCE_LABELS[lead.sourceChannel]}</StatusPill>
                          <span>{lead.city || lead.phoneE164}</span>
                        </div>
                      </div>
                      <span className="dashboard-list-time">{formatDateLabel(lead.createdAt)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </PanelCard>

          <PanelCard
            eyebrow="Jobs This Week"
            title={`${summaryMonth.jobsThisWeekCount.toLocaleString("en-US")} jobs on deck`}
            subtitle="Upcoming work for the next 7 days."
            actionHref={calendarHref}
            actionLabel="Open Calendar"
          >
            {upcomingJobs.length === 0 ? (
              <div className="dashboard-empty-state">
                <strong>No jobs scheduled.</strong>
                <p className="muted">Add your first job to get started.</p>
                <div className="portal-empty-actions">
                  <Link className="btn primary" href={addJobHref}>
                    Add your first job
                  </Link>
                </div>
              </div>
            ) : (
              <ul className="dashboard-list">
                {upcomingJobs.map((job) => {
                  const jobLabel = job.customerName || job.lead?.contactName || job.lead?.businessName || job.lead?.phoneE164 || "Scheduled job";
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
                          <StatusPill tone="neutral">{job.status.replaceAll("_", " ").toLowerCase()}</StatusPill>
                          <span>{job.addressLine || "Address not added yet"}</span>
                        </div>
                      </div>
                      <span className="dashboard-list-time">{formatTimeLabel(job.startAt)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </PanelCard>
        </div>

        <div className="dashboard-stack">
          <PanelCard
            eyebrow="Marketing Performance"
            title="Marketing Performance"
            subtitle={
              ads.totals.spendCents > 0
                ? "Spend, leads, booked jobs, and revenue at a glance."
                : "Add ad spend to start tracking ROI inside the portal."
            }
            actionHref={adsHref}
            actionLabel={ads.totals.spendCents > 0 ? "View" : "Add Spend"}
          >
            {ads.totals.spendCents > 0 ? (
              <div className="dashboard-marketing-grid">
                {paidChannels.map((channel) => (
                  <article key={channel.key} className="dashboard-marketing-card">
                    <header className="dashboard-marketing-head">
                      <strong>{channel.key === "GOOGLE_ADS" ? "Google" : "Meta"}</strong>
                      <StatusPill tone={channel.spendCents > 0 ? "good" : "neutral"}>
                        {channel.spendCents > 0 ? "Tracking" : "Ready"}
                      </StatusPill>
                    </header>
                    <div className="dashboard-marketing-stats">
                      <div>
                        <span>Spend</span>
                        <strong>{formatUsdCents(channel.spendCents)}</strong>
                      </div>
                      <div>
                        <span>Leads</span>
                        <strong>{channel.leads.toLocaleString("en-US")}</strong>
                      </div>
                      <div>
                        <span>Booked</span>
                        <strong>{channel.bookedJobs.toLocaleString("en-US")}</strong>
                      </div>
                      <div>
                        <span>Revenue</span>
                        <strong>{formatUsdCents(channel.revenueCents)}</strong>
                      </div>
                      <div>
                        <span>ROAS</span>
                        <strong>{channel.roas === null ? "—" : `${channel.roas.toFixed(2)}x`}</strong>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="dashboard-setup-state">
                <StatusPill tone="accent">Setup required</StatusPill>
                <strong>Add ad spend to start tracking ROI.</strong>
                <div className="portal-empty-actions">
                  <Link className="btn primary" href={adsHref}>
                    Add Spend
                  </Link>
                </div>
              </div>
            )}
          </PanelCard>

          <PanelCard
            eyebrow="System Status"
            title={systemStatusTitle}
            subtitle={systemStatusSubtitle}
            actionHref={settingsHref}
            actionLabel="Open Settings"
          >
            <div className="dashboard-status-list">
              <div className="dashboard-status-row">
                <span>Messaging</span>
                <StatusPill tone={statusTone(summaryMonth.systemHealth.messaging)}>
                  {summaryMonth.systemHealth.messaging === "ACTIVE" ? "Active" : "Needs setup"}
                </StatusPill>
              </div>
              <div className="dashboard-status-row">
                <span>Calendar</span>
                <StatusPill tone={statusTone(summaryMonth.systemHealth.calendar)}>
                  {summaryMonth.systemHealth.calendar === "CONNECTED" ? "Connected" : "Needs setup"}
                </StatusPill>
              </div>
              <div className="dashboard-status-row">
                <span>Integrations</span>
                <StatusPill tone={statusTone(summaryMonth.systemHealth.integrations)}>
                  {summaryMonth.systemHealth.integrations === "CONFIGURED" ? "Configured" : "Needs setup"}
                </StatusPill>
              </div>
            </div>
          </PanelCard>
        </div>
      </section>
    </div>
  );
}
