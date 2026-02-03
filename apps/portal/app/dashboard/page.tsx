import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);

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

  const [leads, calls] = await Promise.all([
    prisma.lead.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.call.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  return (
    <main className="page">
      <section className="card">
        <h1>Dashboard</h1>
        <p className="muted">Welcome back. Here’s the latest activity for your workspace.</p>
      </section>

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
