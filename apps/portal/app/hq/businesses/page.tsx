import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { endOfToday, formatDateTime } from "@/lib/hq";

export const dynamic = "force-dynamic";

export default async function HqBusinessesPage() {
  const [organizations, dueCounts] = await Promise.all([
    prisma.organization.findMany({
      select: {
        id: true,
        name: true,
        createdAt: true,
        smsFromNumberE164: true,
        _count: {
          select: {
            users: true,
            leads: true,
            calls: true,
            messages: true,
            events: true,
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.lead.groupBy({
      by: ["orgId"],
      where: {
        nextFollowUpAt: {
          lte: endOfToday(),
        },
      },
      _count: { _all: true },
    }),
  ]);

  const dueByOrg = new Map(dueCounts.map((item) => [item.orgId, item._count._all]));

  return (
    <section className="card">
      <h2>Businesses</h2>
      <p className="muted">Job workspaces for every org.</p>

      {organizations.length === 0 ? (
        <p className="muted" style={{ marginTop: 12 }}>
          No businesses yet.
        </p>
      ) : (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Leads</th>
                <th>Due Follow-ups</th>
                <th>Calls</th>
                <th>Messages</th>
                <th>Events</th>
                <th>SMS Number</th>
                <th>Portal</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {organizations.map((organization) => (
                <tr key={organization.id}>
                  <td>
                    <Link className="table-link" href={`/hq/businesses/${organization.id}`}>
                      {organization.name}
                    </Link>
                  </td>
                  <td>{organization._count.leads}</td>
                  <td>{dueByOrg.get(organization.id) ?? 0}</td>
                  <td>{organization._count.calls}</td>
                  <td>{organization._count.messages}</td>
                  <td>{organization._count.events}</td>
                  <td>{organization.smsFromNumberE164 || "-"}</td>
                  <td>
                    <Link className="table-link" href={`/app?orgId=${organization.id}`}>
                      Open
                    </Link>
                  </td>
                  <td>{formatDateTime(organization.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
