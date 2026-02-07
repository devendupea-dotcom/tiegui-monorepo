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

  const [newLeads, dueToday, missedCalls, booked] = await Promise.all([
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
    prisma.lead.count({
      where: {
        status: "BOOKED",
        updatedAt: {
          gte: daysAgo(30),
          lte: now,
        },
      },
    }),
  ]);

  return (
    <>
      <section className="grid">
        <article className="card kpi-card">
          <h2>New Leads (7d)</h2>
          <p className="kpi-value">{newLeads}</p>
        </article>
        <article className="card kpi-card">
          <h2>Follow-ups Due Today</h2>
          <p className="kpi-value">{dueToday}</p>
        </article>
        <article className="card kpi-card">
          <h2>Missed Calls (7d)</h2>
          <p className="kpi-value">{missedCalls}</p>
        </article>
        <article className="card kpi-card">
          <h2>Booked (30d)</h2>
          <p className="kpi-value">{booked}</p>
        </article>
      </section>

      <section className="card">
        <h2>Quick Links</h2>
        <div className="quick-links" style={{ marginTop: 12 }}>
          <Link className="btn secondary" href="/hq/inbox">
            Open Inbox
          </Link>
          <Link className="btn secondary" href="/hq/calendar">
            Open Calendar
          </Link>
          <Link className="btn secondary" href="/hq/businesses">
            View Businesses
          </Link>
        </div>
      </section>
    </>
  );
}
