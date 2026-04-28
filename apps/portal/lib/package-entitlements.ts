import type { MessagingLaunchMode, OrganizationPackage } from "@prisma/client";

export type PackageEntitlements = {
  package: OrganizationPackage;
  label: string;
  shortLabel: string;
  description: string;
  canUseLiveSms: boolean;
  requiresNoSmsMode: boolean;
  managedSetupIncluded: boolean;
  features: string[];
};

export const ORGANIZATION_PACKAGE_ORDER: OrganizationPackage[] = [
  "PORTAL_ONLY",
  "MESSAGING_ENABLED",
  "MANAGED",
];

export function getPackageEntitlements(
  value: OrganizationPackage | null | undefined,
): PackageEntitlements {
  const packageValue = value || "MESSAGING_ENABLED";

  switch (packageValue) {
    case "PORTAL_ONLY":
      return {
        package: "PORTAL_ONLY",
        label: "TieGui CRM",
        shortLabel: "Portal Only",
        description:
          "Core CRM, jobs, scheduling, estimates, invoices, files, website intake, and internal notes without Twilio/SMS.",
        canUseLiveSms: false,
        requiresNoSmsMode: true,
        managedSetupIncluded: false,
        features: [
          "Leads and customers",
          "Jobs and scheduling",
          "Estimates and invoices",
          "Purchase orders",
          "Files and photos",
          "Website lead intake",
          "Internal notes",
        ],
      };
    case "MANAGED":
      return {
        package: "MANAGED",
        label: "TieGui CRM + Managed Growth",
        shortLabel: "Managed",
        description:
          "Core CRM plus SMS eligibility, managed setup, workflow support, and launch monitoring.",
        canUseLiveSms: true,
        requiresNoSmsMode: false,
        managedSetupIncluded: true,
        features: [
          "Everything in TieGui CRM",
          "SMS/Twilio eligibility",
          "Managed setup",
          "Workflow tuning",
          "Launch monitoring",
          "Priority support",
        ],
      };
    case "MESSAGING_ENABLED":
    default:
      return {
        package: "MESSAGING_ENABLED",
        label: "TieGui CRM + Messaging",
        shortLabel: "Messaging Enabled",
        description:
          "Core CRM plus eligibility for live Twilio/SMS, inbox texting, missed-call recovery, and SMS diagnostics.",
        canUseLiveSms: true,
        requiresNoSmsMode: false,
        managedSetupIncluded: false,
        features: [
          "Everything in TieGui CRM",
          "SMS/Twilio eligibility",
          "Inbox texting",
          "Missed-call recovery",
          "SMS consent controls",
          "Delivery diagnostics",
        ],
      };
  }
}

export function canUseMessagingLaunchMode(input: {
  package: OrganizationPackage | null | undefined;
  messagingLaunchMode: MessagingLaunchMode;
}): boolean {
  const entitlements = getPackageEntitlements(input.package);
  if (input.messagingLaunchMode === "LIVE_SMS") {
    return entitlements.canUseLiveSms;
  }
  return true;
}

export function getPackageMessagingMismatch(input: {
  package: OrganizationPackage | null | undefined;
  messagingLaunchMode: MessagingLaunchMode;
}): string | null {
  const entitlements = getPackageEntitlements(input.package);
  if (input.messagingLaunchMode === "LIVE_SMS" && !entitlements.canUseLiveSms) {
    return `${entitlements.shortLabel} does not include the SMS/Twilio module. Switch this org to No SMS or move it to a messaging-enabled package.`;
  }
  return null;
}
