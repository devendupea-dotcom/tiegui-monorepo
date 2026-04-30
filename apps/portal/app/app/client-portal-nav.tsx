"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import type { CalendarAccessRole } from "@prisma/client";
import { useTranslations } from "next-intl";
import type enMessages from "@/messages/en.json";

type AppNavMessageKey = keyof typeof enMessages.appNav;

type NavLink = {
  href: string;
  labelKey: AppNavMessageKey;
  builderLabelKey?: AppNavMessageKey;
  builderOnly?: boolean;
  icon: ReactNode;
};

type NavSection = {
  labelKey: AppNavMessageKey;
  internalOnly?: boolean;
  links: NavLink[];
};

const navSections: NavSection[] = [
  {
    labelKey: "commandSection",
    links: [
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
        builderLabelKey: "buyers",
        icon: (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 6V4h6v2M4 8h16v11H4zM4 12h16" />
          </svg>
        ),
      },
      {
        href: "/app/calendar",
        labelKey: "calendar",
        builderLabelKey: "timeline",
        icon: (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 3v3M17 3v3M5 6h14a2 2 0 0 1 2 2v11H3V8a2 2 0 0 1 2-2Zm-2 6h4v4h-4z" />
          </svg>
        ),
      },
      {
        href: "/app/builder",
        labelKey: "builderPortal",
        builderOnly: true,
        icon: (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 11 12 4l8 7v9H4zM9 20v-6h6v6M7 11h10" />
          </svg>
        ),
      },
    ],
  },
  {
    labelKey: "revenueSection",
    links: [
      {
        href: "/app/estimates",
        labelKey: "estimates",
        icon: (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h4" />
          </svg>
        ),
      },
      {
        href: "/app/invoices",
        labelKey: "invoices",
        builderLabelKey: "payments",
        icon: (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 3h10l3 3v15H4V3h3zm3 0v4h4V3M8 12h8M8 16h8" />
          </svg>
        ),
      },
    ],
  },
  {
    labelKey: "workspaceSection",
    links: [
      {
        href: "/app/settings",
        labelKey: "settings",
        icon: (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m12 8 1.4-2.6 2.9 1-.5 3 2 2 3-.5 1 2.9L19 15l-2 2 .5 3-2.9 1L12 18l-2.6 1.4-2.9-1 .5-3-2-2-3 .5-1-2.9L5 11l2-2-.5-3 2.9-1zM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z" />
          </svg>
        ),
      },
    ],
  },
  {
    labelKey: "advancedSection",
    internalOnly: true,
    links: [
      {
        href: "/app/jobs/records",
        labelKey: "jobRecords",
        builderLabelKey: "buildProjects",
        icon: (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" />
          </svg>
        ),
      },
      {
        href: "/app/dispatch",
        labelKey: "dispatch",
        builderLabelKey: "buildSchedule",
        icon: (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 5h14v5H5zM5 14h6v5H5zM13 14h6v5h-6zM9 10v4M15 10v4" />
          </svg>
        ),
      },
      {
        href: "/app/materials",
        labelKey: "materials",
        builderLabelKey: "selections",
        icon: (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h16M6 7V5h12v2M6 7l1 12h10l1-12M10 11v4M14 11v4" />
          </svg>
        ),
      },
      {
        href: "/app/purchase-orders",
        labelKey: "purchaseOrders",
        icon: (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 3h10l4 4v14H6zM16 3v5h4M9 12h6M9 16h6M9 20h4" />
          </svg>
        ),
      },
      {
        href: "/app/expenses",
        labelKey: "expenses",
        icon: (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 4h10l2 3v13H5V7l2-3Zm2 7h6M9 13h6M9 17h4" />
          </svg>
        ),
      },
      {
        href: "/app/field-notes",
        labelKey: "fieldNotes",
        icon: (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 3h9l4 4v14H6zM15 3v5h4M9 11h6M9 15h6M9 19h4" />
          </svg>
        ),
      },
    ],
  },
];

function withPortalQuery(
  path: string,
  orgId: string | null,
  mobileMode: boolean,
): string {
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

type ClientPortalNavProps = {
  calendarAccessRole: CalendarAccessRole;
  defaultOrgId?: string | null;
  internalUser?: boolean;
  portalVertical?: string | null;
};

export default function ClientPortalNav({
  calendarAccessRole,
  defaultOrgId,
  internalUser = false,
  portalVertical,
}: ClientPortalNavProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("appNav");
  const orgId = searchParams.get("orgId") || defaultOrgId || null;
  const mobileMode = searchParams.get("mobile") === "1";
  const workerScoped =
    calendarAccessRole === "WORKER" || calendarAccessRole === "READ_ONLY";
  const builderWorkspace = !internalUser && portalVertical === "HOMEBUILDER";

  return (
    <nav className="app-nav" aria-label={t("navigationLabel")}>
      {navSections
        .filter((section) => !section.internalOnly || internalUser)
        .map((section) => (
          <div key={section.labelKey} className="app-nav-section">
            <p className="app-nav-section-label">
              {t(
                section.labelKey === "revenueSection" && workerScoped
                  ? "recordsSection"
                  : section.labelKey,
              )}
            </p>
            <div className="app-nav-section-links">
              {section.links
                .filter((link) => builderWorkspace || !link.builderOnly)
                .map((link) => {
                  const active =
                    link.href === "/app"
                      ? pathname === "/app"
                      : link.href === "/app/jobs"
                        ? pathname === "/app/jobs" ||
                          (pathname.startsWith("/app/jobs/") &&
                            !pathname.startsWith("/app/jobs/records"))
                        : pathname === link.href ||
                          pathname.startsWith(`${link.href}/`);

                  const labelKey =
                    builderWorkspace && link.builderLabelKey
                      ? link.builderLabelKey
                      : link.labelKey;

                  return (
                    <Link
                      key={link.href}
                      href={withPortalQuery(link.href, orgId, mobileMode)}
                      prefetch={false}
                      className={`app-nav-link ${active ? "active" : ""}`}
                      aria-label={t(labelKey)}
                    >
                      <span
                        className="app-nav-icon"
                        role="img"
                        aria-label={`${t(labelKey)} icon`}
                      >
                        {link.icon}
                      </span>
                      <span className="app-nav-label">{t(labelKey)}</span>
                    </Link>
                  );
                })}
            </div>
          </div>
        ))}
    </nav>
  );
}
