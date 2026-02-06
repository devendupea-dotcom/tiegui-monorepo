import { getServerSession, type Session } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type AppSession = Session & {
  user?: (Session["user"] & {
    role?: string;
    organizationId?: string;
  }) | null;
};

type LeadRow = {
  id: string;
  phoneNumber: string;
  status: string;
};

type CallRow = {
  id: string;
  fromNumber: string;
  status: string;
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

  if (!session?.user?.organizationId) {
    return (
      <main className="page">
        <section className="card">
          <h1>Access denied</h1>
          <p className="muted">Your account is not assigned to an organization.</p>
        </section>
      </main>
    );
  }

  const organizationId = session.user.organizationId;

  let leads: LeadRow[] = [];
  let calls: CallRow[] = [];
  let dataError = false;
  try {
    [leads, calls] = await Promise.all([
      prisma.lead.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
        take: 10,
      }) as Promise<LeadRow[]>,
      prisma.call.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
        take: 10,
      }) as Promise<CallRow[]>,
    ]);
  } catch (error) {
    console.error("dashboard: data load failed", error);
    dataError = true;
  }

  return (
    <main className="page">
      <section className="card">
        <h1>Dashboard</h1>
        <p className="muted">Welcome back. Here’s the latest activity for your workspace.</p>
      </section>

      {dataError && (
        <section className="card">
          <h2>Setup needed</h2>
          <p className="muted">
            We couldn&apos;t load your organization data. This usually means the database isn&apos;t
            reachable or hasn&apos;t been initialized yet.
          </p>
          <p className="muted" style={{ marginTop: 10 }}>
            Check `DATABASE_URL` in Vercel env vars and ensure Prisma tables exist.
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
                <strong>{lead.phoneNumber}</strong>
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
                <strong>{call.fromNumber}</strong>
                <span className="muted">{call.status}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
