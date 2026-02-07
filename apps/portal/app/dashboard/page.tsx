import { getServerSession, type Session } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

type AppSession = Session & {
  user?:
    | (Session["user"] & {
        role?: string;
        orgId?: string | null;
      })
    | null;
};

type LeadRow = {
  id: string;
  phoneE164: string;
  status: string;
  contactName: string | null;
  nextFollowUpAt: Date | null;
};

type CallRow = {
  id: string;
  fromNumberE164: string;
  toNumberE164: string;
  direction: string;
  status: string;
  startedAt: Date;
};

export default async function DashboardPage() {
  let session: AppSession | null = null;
  try {
    session = (await getServerSession(authOptions)) as AppSession | null;
  } catch (error) {
    console.error("dashboard:getServerSession failed", error);
    redirect("/login?next=/dashboard");
  }

  if (!session?.user) {
    redirect("/login?next=/dashboard");
  }

  if (session.user.role === "INTERNAL") {
    redirect("/hq");
  }

  if (!session.user.orgId) {
    return (
      <main className="page">
        <section className="card">
          <h1>Access denied</h1>
          <p className="muted">Your account is not assigned to a business workspace.</p>
        </section>
      </main>
    );
  }

  const orgId = session.user.orgId;

  let leads: LeadRow[] = [];
  let calls: CallRow[] = [];
  let dataError = false;
  try {
    [leads, calls] = await Promise.all([
      prisma.lead.findMany({
        where: { orgId },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          phoneE164: true,
          status: true,
          contactName: true,
          nextFollowUpAt: true,
        },
      }) as Promise<LeadRow[]>,
      prisma.call.findMany({
        where: { orgId },
        orderBy: { startedAt: "desc" },
        take: 10,
        select: {
          id: true,
          fromNumberE164: true,
          toNumberE164: true,
          direction: true,
          status: true,
          startedAt: true,
        },
      }) as Promise<CallRow[]>,
    ]);
  } catch (error) {
    console.error("dashboard: data load failed", error);
    dataError = true;
  }

  return (
    <main className="page">
      <section className="card">
        <h1>Client Dashboard</h1>
        <p className="muted">Latest leads and call activity for your business.</p>
      </section>

      {dataError && (
        <section className="card">
          <h2>Setup needed</h2>
          <p className="muted">
            We couldn&apos;t load your workspace data. Check `DATABASE_URL` and ensure Prisma
            migrations have been applied.
          </p>
        </section>
      )}

      <section className="grid">
        <div className="card">
          <h2>Recent Leads</h2>
          <ul className="list">
            {leads.length === 0 && <li className="muted">No leads yet.</li>}
            {leads.map((lead) => (
              <li key={lead.id}>
                <strong>
                  <Link className="table-link" href={`/app/leads/${lead.id}?tab=messages`}>
                    {lead.contactName || lead.phoneE164}
                  </Link>
                </strong>
                <span className="muted">{lead.status}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h2>Recent Calls</h2>
          <ul className="list">
            {calls.length === 0 && <li className="muted">No calls yet.</li>}
            {calls.map((call) => (
              <li key={call.id}>
                <strong>{call.fromNumberE164}</strong>
                <span className="muted">{call.direction} • {call.status}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
