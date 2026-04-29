import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { endOfToday, startOfToday } from "@/lib/hq";

export const dynamic = "force-dynamic";

function daysAgo(days: number) {
  const value = new Date();
  value.setDate(value.getDate() - days);
  return value;
}

export default async function HqDashboardPage() {
  const todayStart = startOfToday();
  const todayEnd = endOfToday();
  const now = new Date();

  const [newLeads, dueToday, missedCalls, bookedLeads] = await Promise.all([
    prisma.lead.count({ where: { createdAt: { gte: daysAgo(7) } } }),
    prisma.lead.count({
      where: {
        nextFollowUpAt: {
          gte: todayStart,
          lte: todayEnd,
        },
      },
    }),
    prisma.call.count({
      where: {
        status: "MISSED",
        startedAt: { gte: daysAgo(7) },
      },
    }),
    prisma.event.findMany({
      where: {
        leadId: { not: null },
        type: { in: ["JOB", "ESTIMATE"] },
        status: { in: ["SCHEDULED", "CONFIRMED", "EN_ROUTE", "ON_SITE", "IN_PROGRESS"] },
        startAt: {
          gte: daysAgo(30),
          lte: now,
        },
      },
      distinct: ["leadId"],
      select: { leadId: true },
    }),
  ]);

  return (
    <>
      <section className="grid">
        <article className="card kpi-card">
          <h2>New Leads, 7 Days</h2>
          <p className="kpi-value">{newLeads}</p>
        </article>
        <article className="card kpi-card">
          <h2>Follow-ups Due Today</h2>
          <p className="kpi-value">{dueToday}</p>
        </article>
        <article className="card kpi-card">
          <h2>Missed Calls, 7 Days</h2>
          <p className="kpi-value">{missedCalls}</p>
        </article>
        <article className="card kpi-card">
          <h2>Booked, 30 Days</h2>
          <p className="kpi-value">{bookedLeads.length}</p>
        </article>
      </section>

      <section className="card">
        <h2>HQ Overview</h2>
        <p className="muted">Cross-client controls for leads, scheduling, workspace health, and integrations.</p>
        <div className="quick-links" style={{ marginTop: 12 }}>
          <Link className="btn secondary" href="/hq/inbox">
            HQ Inbox
          </Link>
          <Link className="btn secondary" href="/hq/messaging">
            Messaging Health
          </Link>
          <Link className="btn secondary" href="/hq/calendar">
            HQ Calendar
          </Link>
          <Link className="btn secondary" href="/hq/businesses">
            Client Workspaces
          </Link>
          <Link className="btn secondary" href="/hq/integrations/google/health">
            Google Sync Health
          </Link>
        </div>
      </section>
    </>
  );
}
