import type enMessages from "@/messages/en.json";

export type AppNavMessageKey = keyof typeof enMessages.appNav;

export type PortalNavLinkId =
  | "today"
  | "inbox"
  | "jobs"
  | "calendar"
  | "builder"
  | "estimates"
  | "invoices"
  | "settings"
  | "jobRecords"
  | "dispatch"
  | "materials"
  | "purchaseOrders"
  | "expenses"
  | "fieldNotes";

export type PortalNavLink = {
  id: PortalNavLinkId;
  href: string;
  labelKey: AppNavMessageKey;
  builderLabelKey?: AppNavMessageKey;
  builderOnly?: boolean;
};

export type PortalNavSection = {
  id: "command" | "revenue" | "workspace" | "advanced";
  labelKey: AppNavMessageKey;
  internalOnly?: boolean;
  links: PortalNavLink[];
};

export const portalNavSections: PortalNavSection[] = [
  {
    id: "command",
    labelKey: "commandSection",
    links: [
      {
        id: "today",
        href: "/app",
        labelKey: "today",
      },
      {
        id: "inbox",
        href: "/app/inbox",
        labelKey: "inbox",
      },
      {
        id: "jobs",
        href: "/app/jobs",
        labelKey: "jobs",
        builderLabelKey: "buyers",
      },
      {
        id: "calendar",
        href: "/app/calendar",
        labelKey: "calendar",
        builderLabelKey: "timeline",
      },
      {
        id: "builder",
        href: "/app/builder",
        labelKey: "builderPortal",
        builderOnly: true,
      },
    ],
  },
  {
    id: "revenue",
    labelKey: "revenueSection",
    links: [
      {
        id: "estimates",
        href: "/app/estimates",
        labelKey: "estimates",
      },
      {
        id: "invoices",
        href: "/app/invoices",
        labelKey: "invoices",
        builderLabelKey: "payments",
      },
    ],
  },
  {
    id: "workspace",
    labelKey: "workspaceSection",
    links: [
      {
        id: "settings",
        href: "/app/settings",
        labelKey: "settings",
      },
    ],
  },
  {
    id: "advanced",
    labelKey: "advancedSection",
    links: [
      {
        id: "jobRecords",
        href: "/app/jobs/records",
        labelKey: "jobRecords",
        builderLabelKey: "buildProjects",
      },
      {
        id: "dispatch",
        href: "/app/dispatch",
        labelKey: "dispatch",
        builderLabelKey: "buildSchedule",
      },
      {
        id: "materials",
        href: "/app/materials",
        labelKey: "materials",
        builderLabelKey: "selections",
      },
      {
        id: "purchaseOrders",
        href: "/app/purchase-orders",
        labelKey: "purchaseOrders",
      },
      {
        id: "expenses",
        href: "/app/expenses",
        labelKey: "expenses",
      },
      {
        id: "fieldNotes",
        href: "/app/field-notes",
        labelKey: "fieldNotes",
      },
    ],
  },
];

export function isBuilderWorkspace(input: {
  internalUser: boolean;
  portalVertical?: string | null;
}): boolean {
  return !input.internalUser && input.portalVertical === "HOMEBUILDER";
}

export function resolvePortalNavSections(input: {
  internalUser: boolean;
  portalVertical?: string | null;
}): PortalNavSection[] {
  const builderWorkspace = isBuilderWorkspace(input);

  return portalNavSections
    .filter((section) => !section.internalOnly || input.internalUser)
    .map((section) => ({
      ...section,
      links: section.links.filter((link) => builderWorkspace || !link.builderOnly),
    }))
    .filter((section) => section.links.length > 0);
}
