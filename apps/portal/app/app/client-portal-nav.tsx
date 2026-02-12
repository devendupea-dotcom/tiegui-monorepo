"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

type NavLink = {
  href: string;
  labelKey: string;
  icon: ReactNode;
};

const navLinks: NavLink[] = [
  {
    href: "/app",
    labelKey: "today",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 3v3M18 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1Z" />
      </svg>
    ),
  },
  {
    href: "/app/inbox",
    labelKey: "inbox",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 6h16v12H4zM4 14h5l2 3h2l2-3h5" />
      </svg>
    ),
  },
  {
    href: "/app/jobs",
    labelKey: "jobs",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 6V4h6v2M4 8h16v11H4zM4 12h16" />
      </svg>
    ),
  },
  {
    href: "/app/calendar",
    labelKey: "calendar",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 3v3M17 3v3M5 6h14a2 2 0 0 1 2 2v11H3V8a2 2 0 0 1 2-2Zm-2 6h4v4h-4z" />
      </svg>
    ),
  },
  {
    href: "/app/invoices",
    labelKey: "invoices",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 3h10l3 3v15H4V3h3zm3 0v4h4V3M8 12h8M8 16h8" />
      </svg>
    ),
  },
  {
    href: "/app/settings",
    labelKey: "settings",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m12 8 1.4-2.6 2.9 1-.5 3 2 2 3-.5 1 2.9L19 15l-2 2 .5 3-2.9 1L12 18l-2.6 1.4-2.9-1 .5-3-2-2-3 .5-1-2.9L5 11l2-2-.5-3 2.9-1zM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z" />
      </svg>
    ),
  },
];

function withOrgQuery(path: string, orgId: string | null): string {
  if (!orgId) {
    return path;
  }
  const joiner = path.includes("?") ? "&" : "?";
  return `${path}${joiner}orgId=${encodeURIComponent(orgId)}`;
}

export default function ClientPortalNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("appNav");
  const orgId = searchParams.get("orgId");

  return (
    <nav className="app-nav" aria-label="Client portal navigation">
      {navLinks.map((link) => {
        const active =
          link.href === "/app"
            ? pathname === "/app"
            : pathname === link.href || pathname.startsWith(`${link.href}/`);

        return (
          <Link
            key={link.href}
            href={withOrgQuery(link.href, orgId)}
            className={`app-nav-link ${active ? "active" : ""}`}
          >
            <span className="app-nav-icon">{link.icon}</span>
            <span className="app-nav-label">{t(link.labelKey)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
