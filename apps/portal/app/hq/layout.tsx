import Link from "next/link";
import { requireInternalUser } from "@/lib/session";

const links = [
  { href: "/hq", label: "Dashboard" },
  { href: "/hq/inbox", label: "Inbox" },
  { href: "/hq/calendar", label: "Calendar" },
  { href: "/hq/businesses", label: "Businesses" },
];

export default async function HqLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await requireInternalUser("/hq");

  return (
    <main className="page">
      <header className="card hq-header">
        <div>
          <h1>TieGui HQ</h1>
          <p className="muted">Internal workspace for cross-business operations.</p>
        </div>
        <nav className="hq-nav" aria-label="HQ navigation">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="hq-nav-link">
              {link.label}
            </Link>
          ))}
        </nav>
      </header>
      {children}
    </main>
  );
}
