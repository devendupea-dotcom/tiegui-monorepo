import Link from "next/link";
import { addMonths, startOfMonth, subMonths } from "date-fns";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isNotFoundError } from "next/dist/client/components/not-found";
import { isRedirectError } from "next/dist/client/components/redirect";
import type { CalendarAccessRole, MarketingChannel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSessionUser } from "@/lib/session";
import {
  canManageAnyOrgJobs,
  requireAppApiActor,
  resolveActorOrgId,
} from "@/lib/app-api-permissions";
import { getPortalAdsMetrics } from "@/lib/portal-analytics";
import { getParam, resolveAppScope, withOrgQuery } from "../../_lib/portal-scope";

export const dynamic = "force-dynamic";

const EDITABLE_CHANNELS: MarketingChannel[] = ["GOOGLE_ADS", "META_ADS", "OTHER"];

function parseMonthStart(value: string | null | undefined): Date {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (/^\d{4}-\d{2}$/.test(trimmed)) {
    const parsed = new Date(`${trimmed}-01T00:00:00.000Z`);
    if (!Number.isNaN(parsed.getTime())) {
      return startOfMonth(parsed);
    }
  }
  return startOfMonth(new Date());
}

function formatMonthValue(value: Date): string {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatMonthHref(input: { monthStart: Date; delta: -1 | 1; orgId: string; internalUser: boolean }) {
  const nextMonth = input.delta === -1 ? subMonths(input.monthStart, 1) : addMonths(input.monthStart, 1);
  return withOrgQuery(`/app/analytics/ads?month=${encodeURIComponent(formatMonthValue(nextMonth))}`, input.orgId, input.internalUser);
}

function parseSpendDollars(value: string): number | null {
  const normalized = value.trim().replace(/[$,\s]/g, "");
  if (!normalized) return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  return Number.isFinite(cents) ? cents : null;
}

function formatUsdCents(value: number | null): string {
  if (value === null) return "No data";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value / 100);
}

function formatDollarsInput(value: number): string {
  return (value / 100).toFixed(2);
}

function formatPercent(value: number | null): string {
  if (value === null) return "Not enough data";
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function formatRoas(value: number | null): string {
  if (value === null) return "Add spend";
  return `${value.toFixed(2)}x`;
}

function formatStatusMessage(saved: string, error: string): string | null {
  if (saved === "spend") {
    return "Monthly spend saved.";
  }

  switch (error) {
    case "invalid-channel":
      return "We could not save that channel.";
    case "invalid-spend":
      return "Enter a valid dollar amount to save spend.";
    case "forbidden":
      return "Only owners and admins can update this page.";
    default:
      return null;
  }
}

async function saveMarketingSpendAction(formData: FormData) {
  "use server";

  const actor = await requireAppApiActor();
  if (!actor.internalUser && !canManageAnyOrgJobs(actor)) {
    redirect("/app/calendar");
  }

  const orgId = await resolveActorOrgId({
    actor,
    requestedOrgId: String(formData.get("orgId") || "").trim(),
  });
  const monthStart = parseMonthStart(String(formData.get("month") || ""));
  const month = formatMonthValue(monthStart);
  const channel = String(formData.get("channel") || "").trim().toUpperCase() as MarketingChannel;

  if (!EDITABLE_CHANNELS.includes(channel)) {
    redirect(withOrgQuery(`/app/analytics/ads?month=${encodeURIComponent(month)}&error=invalid-channel`, orgId, actor.internalUser));
  }

  const spendCents = parseSpendDollars(String(formData.get("spendDollars") || ""));
  if (spendCents === null) {
    redirect(withOrgQuery(`/app/analytics/ads?month=${encodeURIComponent(month)}&error=invalid-spend`, orgId, actor.internalUser));
  }

  const existing = await prisma.marketingSpend.findUnique({
    where: {
      orgId_monthStart_channel: {
        orgId,
        monthStart,
        channel,
      },
    },
    select: {
      notes: true,
    },
  });

  await prisma.marketingSpend.upsert({
    where: {
      orgId_monthStart_channel: {
        orgId,
        monthStart,
        channel,
      },
    },
    create: {
      orgId,
      monthStart,
      channel,
      spendCents: spendCents ?? 0,
      notes: existing?.notes ?? null,
      createdByUserId: actor.id,
    },
    update: {
      spendCents: spendCents ?? 0,
      createdByUserId: actor.id,
    },
  });

  revalidatePath("/app");
  revalidatePath("/app/analytics/ads");
  redirect(withOrgQuery(`/app/analytics/ads?month=${encodeURIComponent(month)}&saved=spend`, orgId, actor.internalUser));
}

export default async function AdsAnalyticsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  try {
    const requestedOrgId = getParam(searchParams?.orgId);
    const monthParam = getParam(searchParams?.month);
    const saved = getParam(searchParams?.saved);
    const error = getParam(searchParams?.error);
    const scope = await resolveAppScope({
      nextPath: "/app/analytics/ads",
      requestedOrgId,
    });
    const user = await requireSessionUser("/app/analytics/ads");

    let calendarAccessRole: CalendarAccessRole = scope.internalUser ? "OWNER" : "WORKER";
    if (!scope.internalUser && user.id) {
      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { calendarAccessRole: true },
      });
      calendarAccessRole = dbUser?.calendarAccessRole || "WORKER";
    }

    if (!scope.internalUser && !canManageAnyOrgJobs({
      id: user.id || "",
      role: user.role,
      orgId: scope.orgId,
      calendarAccessRole,
      internalUser: false,
    })) {
      redirect(withOrgQuery("/app/calendar", scope.orgId, scope.internalUser));
    }

    const monthStart = parseMonthStart(monthParam);
    const ads = await getPortalAdsMetrics({
      viewer: {
        id: user.id || "",
        internalUser: scope.internalUser,
        calendarAccessRole,
        orgId: scope.orgId,
      },
      month: formatMonthValue(monthStart),
    });

    const statusMessage = formatStatusMessage(saved, error);

    return (
      <>
        <section className="card command-center-hero">
          <div className="command-center-hero-copy">
            <p className="command-center-kicker">Ads Results</p>
            <h1>{ads.monthLabel}</h1>
            <p className="muted">Track what your ads are producing: leads, booked jobs, and revenue.</p>
          </div>
          <div className="analytics-month-tools">
            <form className="analytics-month-form" method="get">
              {scope.internalUser ? <input type="hidden" name="orgId" value={scope.orgId} /> : null}
              <label>
                Month
                <input type="month" name="month" defaultValue={ads.month} />
              </label>
              <button className="btn primary" type="submit">
                Apply
              </button>
            </form>
            <div className="analytics-month-nav">
              <Link className="btn secondary" href={formatMonthHref({ monthStart, delta: -1, orgId: scope.orgId, internalUser: scope.internalUser })}>
                Previous month
              </Link>
              <Link className="btn secondary" href={formatMonthHref({ monthStart, delta: 1, orgId: scope.orgId, internalUser: scope.internalUser })}>
                Next month
              </Link>
            </div>
          </div>
        </section>

        {statusMessage ? (
          <section className="card analytics-status-banner">
            <p className={saved ? "form-status" : "error-message"}>{statusMessage}</p>
          </section>
        ) : null}

        <section className="command-center-grid">
          <article className="card command-center-card">
            <div className="command-center-head">
              <div>
                <p className="command-center-section-kicker">Totals</p>
                <h2>Paid channels</h2>
                <p className="muted">What you spent, what it produced, and what came back.</p>
              </div>
              <Link className="table-link" href={withOrgQuery("/app", scope.orgId, scope.internalUser)}>
                Back to dashboard
              </Link>
            </div>
            <div className="command-metrics-grid">
              <div className="command-metric">
                <span className="command-metric-label">Spend</span>
                <strong className="command-metric-value">{formatUsdCents(ads.totals.spendCents)}</strong>
                <span className="command-metric-note">Manual monthly spend entered for Google, Meta, and other paid channels.</span>
              </div>
              <div className="command-metric">
                <span className="command-metric-label">Leads</span>
                <strong className="command-metric-value">{ads.totals.leads.toLocaleString("en-US")}</strong>
                <span className="command-metric-note">New leads attributed during this month.</span>
              </div>
              <div className="command-metric">
                <span className="command-metric-label">Booked jobs</span>
                <strong className="command-metric-value">{ads.totals.bookedJobs.toLocaleString("en-US")}</strong>
                <span className="command-metric-note">Booked work tied back to campaign source.</span>
              </div>
              <div className="command-metric">
                <span className="command-metric-label">Revenue</span>
                <strong className="command-metric-value">{formatUsdCents(ads.totals.revenueCents)}</strong>
                <span className="command-metric-note">Collected revenue from ad-sourced work.</span>
              </div>
              <div className="command-metric">
                <span className="command-metric-label">CPL</span>
                <strong className="command-metric-value">{formatUsdCents(ads.totals.cplCents)}</strong>
                <span className="command-metric-note">Average cost per lead this month.</span>
              </div>
              <div className="command-metric">
                <span className="command-metric-label">ROAS</span>
                <strong className="command-metric-value">{formatRoas(ads.totals.roas)}</strong>
                <span className="command-metric-note">Revenue returned for every dollar spent.</span>
              </div>
            </div>
            {ads.totals.spendCents === 0 ? (
              <div className="command-center-empty">
                No ad spend entered yet. Add spend below to start tracking CPL and ROAS.
              </div>
            ) : null}
          </article>
        </section>

        <section className="ads-channel-grid">
          {ads.channels.map((channel) => (
            <article key={channel.key} className="card ads-channel-card">
              <div className="command-center-head">
                <div>
                  <p className="command-center-section-kicker">{channel.label}</p>
                  <h2>{channel.key === "META_ADS" ? "Facebook / Instagram" : channel.label}</h2>
                  <p className="muted">
                    {channel.editable
                      ? "Update monthly spend and review the results by week."
                      : "Spend stays at zero here while leads and revenue are tracked automatically."}
                  </p>
                </div>
              </div>

              <div className="ads-kpi-grid">
                <div className="command-metric">
                  <span className="command-metric-label">Spend</span>
                  <strong className="command-metric-value">{formatUsdCents(channel.spendCents)}</strong>
                </div>
                <div className="command-metric">
                  <span className="command-metric-label">Leads</span>
                  <strong className="command-metric-value">{channel.leads.toLocaleString("en-US")}</strong>
                </div>
                <div className="command-metric">
                  <span className="command-metric-label">Booked jobs</span>
                  <strong className="command-metric-value">{channel.bookedJobs.toLocaleString("en-US")}</strong>
                </div>
                <div className="command-metric">
                  <span className="command-metric-label">Revenue</span>
                  <strong className="command-metric-value">{formatUsdCents(channel.revenueCents)}</strong>
                </div>
                <div className="command-metric">
                  <span className="command-metric-label">CPL</span>
                  <strong className="command-metric-value">{formatUsdCents(channel.cplCents)}</strong>
                </div>
                <div className="command-metric">
                  <span className="command-metric-label">ROAS</span>
                  <strong className="command-metric-value">{formatRoas(channel.roas)}</strong>
                </div>
              </div>

              {channel.editable ? (
                <form action={saveMarketingSpendAction} className="analytics-inline-form">
                  <input type="hidden" name="orgId" value={scope.orgId} />
                  <input type="hidden" name="month" value={ads.month} />
                  <input type="hidden" name="channel" value={channel.key} />
                  <label>
                    Spend for {ads.monthLabel}
                    <input
                      aria-label={`${channel.label} spend for ${ads.monthLabel}`}
                      inputMode="decimal"
                      name="spendDollars"
                      defaultValue={formatDollarsInput(channel.spendCents)}
                      placeholder="0.00"
                    />
                  </label>
                  <button className="btn primary" type="submit">
                    Save spend
                  </button>
                </form>
              ) : (
                <p className="muted analytics-inline-copy">Tracked automatically for this channel.</p>
              )}

              <div className="ads-weekly-list">
                <h3>By week</h3>
                {channel.weekly.length === 0 ? (
                  <div className="command-center-empty">
                    No leads or revenue recorded yet for this month.
                  </div>
                ) : (
                  <div className="ads-weekly-table" role="table" aria-label={`${channel.label} weekly results`}>
                    {channel.weekly.map((row) => (
                      <div key={`${channel.key}-${row.weekStart}`} className="ads-weekly-row" role="row">
                        <div role="cell">
                          <span className="ads-weekly-label">{row.label}</span>
                        </div>
                        <div role="cell">
                          <span className="ads-weekly-value">{row.leads.toLocaleString("en-US")} leads</span>
                        </div>
                        <div role="cell">
                          <span className="ads-weekly-value">{formatUsdCents(row.revenueCents)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </article>
          ))}
        </section>
      </>
    );
  } catch (error) {
    if (isRedirectError(error) || isNotFoundError(error)) {
      throw error;
    }
    console.error("AdsAnalyticsPage hard failure.", error);
    return (
      <section className="card">
        <h2>Ads Results are temporarily unavailable</h2>
        <p className="muted">Open your dashboard or calendar while we recover this page.</p>
        <div className="portal-empty-actions" style={{ marginTop: 12 }}>
          <Link className="btn primary" href="/app">
            Open Dashboard
          </Link>
          <Link className="btn secondary" href="/app/calendar">
            Open Calendar
          </Link>
        </div>
      </section>
    );
  }
}
