import Link from "next/link";
import Image from "next/image";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import type { CalendarAccessRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isInternalRole, requireSessionUser } from "@/lib/session";
import {
  AppApiError,
  requireAppApiActor,
  resolveActorOrgId,
} from "@/lib/app-api-permissions";
import { getRequestI18nContext } from "@/lib/i18n";
import ClientPortalNav from "./client-portal-nav";
import LogoutButton from "./logout-button";
import QuickAddLeadButton from "./quick-add-lead-button";
import MobileActionBar from "./mobile-action-bar";
import ThemeToggle from "./theme-toggle";
import LocaleToggle from "./locale-toggle";
import MobileModeFlag from "./mobile-mode-flag";
import PortalActionFeedback from "../_components/portal-action-feedback";

export const dynamic = "force-dynamic";

export default async function ClientPortalLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { locale, messages } = await getRequestI18nContext();
  const t = createTranslator({ locale, messages });
  const user = await requireSessionUser("/app");
  const internalUser = isInternalRole(user.role);
  const displayName = user.name?.trim()
    ? user.name.trim().split(/\s+/)[0] || user.name.trim()
    : user.email?.split("@")[0] || (internalUser ? "Admin" : "Contractor");
  let defaultOrgId: string | null = null;
  let calendarAccessRole: CalendarAccessRole = internalUser ? "OWNER" : "WORKER";
  let portalVertical: string | null = null;
  try {
    const actor = await requireAppApiActor();
    try {
      defaultOrgId = await resolveActorOrgId({ actor });
      calendarAccessRole = actor.calendarAccessRole;
    } catch (error) {
      if (error instanceof AppApiError && error.status === 400) {
        const [firstOrg] = actor.accessibleOrgs;
        if (firstOrg) {
          defaultOrgId = firstOrg.orgId;
          calendarAccessRole = firstOrg.effectiveOrgRole;
        }
      }
      if (!(error instanceof AppApiError) || (error.status !== 400 && error.status !== 404)) {
        console.error("ClientPortalLayout failed to resolve active workspace context.", error);
      }
    }
  } catch (error) {
    console.error("ClientPortalLayout failed to load workspace actor.", error);
  }

  const onboardingOrg = defaultOrgId
    ? await prisma.organization.findUnique({
        where: { id: defaultOrgId },
        select: {
          onboardingCompletedAt: true,
          portalVertical: true,
        },
      }).catch((error) => {
        console.error("ClientPortalLayout failed to load onboarding status.", error);
        return null;
      })
    : null;
  if (onboardingOrg?.portalVertical) {
    portalVertical = onboardingOrg.portalVertical;
  }
  const showOnboardingReminder =
    !internalUser &&
    (calendarAccessRole === "OWNER" || calendarAccessRole === "ADMIN") &&
    onboardingOrg !== null &&
    !onboardingOrg.onboardingCompletedAt;
  const brandTitle = internalUser
    ? t("portalLayout.internalBrandTitle")
    : t("portalLayout.brandTitle");
  const brandSubtitle = internalUser
    ? t("portalLayout.internalBrandSubtitle")
    : t("portalLayout.brandSubtitle");
  const brandDescription = internalUser
    ? t("portalLayout.internalBrandDescription")
    : t("portalLayout.brandDescription");
  const workspaceSettingsLabel = internalUser
    ? t("portalLayout.internalWorkspaceSettings")
    : t("portalLayout.workspaceSettings");
  const quickAddLabel = internalUser
    ? t("portalLayout.internalQuickAddLabel")
    : t("portalLayout.quickAddLabel");
  const quickAddDescription = internalUser
    ? t("portalLayout.internalQuickAddDescription")
    : t("portalLayout.quickAddDescription");
  const quickAddButtonLabel = internalUser
    ? t("buttons.addLeadToWorkspace")
    : t("buttons.addLead");

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <MobileModeFlag />
      <PortalActionFeedback />
      <main className="portal-shell">
        <aside className="portal-sidebar">
          <div className="portal-brand">
            <Link className="portal-brand-link" href="/app" prefetch={false}>
              <span className="portal-brand-mark">
                <Image
                  src="/tiegui-mark.png"
                  alt="TieGui"
                  width={44}
                  height={44}
                  className="portal-brand-image"
                  priority
                />
              </span>
              <span className="portal-brand-text">
                <strong>{brandTitle}</strong>
                <span>{brandSubtitle}</span>
              </span>
            </Link>
            <p className="portal-brand-sub">{brandDescription}</p>
          </div>

          <ClientPortalNav
            calendarAccessRole={calendarAccessRole}
            defaultOrgId={defaultOrgId}
            internalUser={internalUser}
            portalVertical={portalVertical}
          />

          <section className="portal-profile">
            <p className="portal-profile-label">{t("portalLayout.signedInAs")}</p>
            <p className="portal-profile-name">{displayName}</p>
            <p className="portal-profile-email">{user.email || ""}</p>
          </section>

          {internalUser ? (
            <section className="portal-profile">
              <p className="portal-profile-label">{t("portalLayout.internalPreview")}</p>
              <Link className="portal-side-link" href="/hq" prefetch={false}>
                {t("portalLayout.openHq")}
              </Link>
            </section>
          ) : null}

          <section className="portal-profile">
            <Link className="portal-side-link" href="/app/settings" prefetch={false}>
              {workspaceSettingsLabel}
            </Link>
            <LogoutButton />
          </section>
        </aside>

        <section className="portal-content">
          <header className="portal-topbar">
            <div className="portal-topbar-copy">
              <p>{quickAddLabel}</p>
              <span>{quickAddDescription}</span>
            </div>
            <div className="portal-topbar-actions">
              <ThemeToggle />
              <LocaleToggle />
              <QuickAddLeadButton
                defaultOrgId={defaultOrgId}
                internalUser={internalUser}
                calendarAccessRole={calendarAccessRole}
                label={quickAddButtonLabel}
              />
            </div>
          </header>
          {showOnboardingReminder ? (
            <section className="card portal-onboarding-reminder">
              <div className="stack-cell">
                <strong>{t("portalLayout.onboardingPausedTitle")}</strong>
                <p className="muted">{t("portalLayout.onboardingPausedDescription")}</p>
                <Link className="btn primary" href="/app/onboarding" prefetch={false}>
                  {t("portalLayout.resumeOnboarding")}
                </Link>
              </div>
            </section>
          ) : null}
          {children}
          <MobileActionBar />
        </section>
      </main>
    </NextIntlClientProvider>
  );
}
