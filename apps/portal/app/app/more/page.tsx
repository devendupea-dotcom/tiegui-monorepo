import Link from "next/link";
import { getParam, resolveAppScope, withOrgQuery } from "../_lib/portal-scope";
import { requireAppPageViewer } from "../_lib/portal-viewer";

export const dynamic = "force-dynamic";

const destinations = [
  {
    href: "/app/estimates",
    title: "Estimates",
    body: "Create, send, and follow up on customer estimates.",
  },
  {
    href: "/app/invoices",
    title: "Invoices & payments",
    body: "See balances, send invoices, and follow up on overdue payments.",
  },
  {
    href: "/app/expenses",
    title: "Expenses",
    body: "Record business expenses and job costs.",
  },
  {
    href: "/app/settings",
    title: "Business settings",
    body: "Update business details, texting preferences, and team access.",
  },
] as const;

export default async function MorePage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const requestedOrgId = getParam(searchParams?.orgId);
  const scope = await resolveAppScope({ nextPath: "/app/more", requestedOrgId });
  await requireAppPageViewer({ nextPath: "/app/more", orgId: scope.orgId });

  return (
    <section className="card">
      <div className="stack-cell">
        <h1>More</h1>
        <p className="muted">Open the tools you use less often.</p>
      </div>
      <div className="more-destination-grid">
        {destinations.map((destination) => (
          <Link
            key={destination.href}
            className="more-destination-card"
            href={withOrgQuery(destination.href, scope.orgId, scope.internalUser)}
            prefetch={false}
          >
            <strong>{destination.title}</strong>
            <span>{destination.body}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
