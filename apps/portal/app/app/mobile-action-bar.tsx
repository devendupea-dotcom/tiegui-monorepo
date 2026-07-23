"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

function withPortalQuery(path: string, orgId: string | null, mobileMode: boolean): string {
  if (!orgId && !mobileMode) {
    return path;
  }
  const target = new URL(path, "https://app.tieguisolutions.com");
  if (orgId) {
    target.searchParams.set("orgId", orgId);
  }
  if (mobileMode) {
    target.searchParams.set("mobile", "1");
  }
  const query = target.searchParams.toString();
  return query ? `${target.pathname}?${query}` : target.pathname;
}

export default function MobileActionBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const orgId = searchParams.get("orgId");
  const mobileMode = searchParams.get("mobile") === "1";

  const links = [
    { href: "/app", label: "Today" },
    { href: "/app/inbox", label: "Inbox" },
    { href: "/app/calendar", label: "Schedule" },
    { href: "/app/jobs", label: "Jobs" },
    { href: "/app/more", label: "More" },
  ];

  return (
    <nav className="mobile-action-bar" aria-label="Primary navigation">
      {links.map((link) => {
        const active = link.href === "/app"
          ? pathname === "/app"
          : pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            className={`mobile-action-btn ${active ? "primary" : ""}`}
            href={withPortalQuery(link.href, orgId, mobileMode)}
            prefetch={false}
            aria-current={active ? "page" : undefined}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
