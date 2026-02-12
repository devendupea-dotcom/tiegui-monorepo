import Link from "next/link";
import Image from "next/image";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import { prisma } from "@/lib/prisma";
import { isInternalRole, requireSessionUser } from "@/lib/session";
import { getRequestI18nContext } from "@/lib/i18n";
import ClientPortalNav from "./client-portal-nav";
import LogoutButton from "./logout-button";
import QuickAddLeadButton from "./quick-add-lead-button";
import MobileActionBar from "./mobile-action-bar";
import ThemeToggle from "./theme-toggle";
import LocaleToggle from "./locale-toggle";

export default async function ClientPortalLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { locale, messages } = await getRequestI18nContext();
  const t = createTranslator({ locale, messages });
  const user = await requireSessionUser("/app");
  const internalUser = isInternalRole(user.role);
  const displayName = user.name || user.email || "Contractor";
  const [userAccess, firstOrg] = await Promise.all([
    user.id
      ? prisma.user.findUnique({
          where: { id: user.id },
          select: { calendarAccessRole: true },
        })
      : Promise.resolve(null),
    internalUser
      ? prisma.organization.findFirst({
          select: { id: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve(null),
  ]);

  const defaultOrgId = internalUser ? firstOrg?.id || null : user.orgId || null;
  const calendarAccessRole = userAccess?.calendarAccessRole || "WORKER";
  const onboardingOrg = !internalUser && defaultOrgId
    ? await prisma.organization.findUnique({
        where: { id: defaultOrgId },
        select: {
          onboardingCompletedAt: true,
          onboardingSkippedAt: true,
        },
      })
    : null;
  const showOnboardingReminder =
    !internalUser &&
    (calendarAccessRole === "OWNER" || calendarAccessRole === "ADMIN") &&
    onboardingOrg !== null &&
    !onboardingOrg.onboardingCompletedAt &&
    Boolean(onboardingOrg.onboardingSkippedAt);

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <main className="portal-shell">
        <aside className="portal-sidebar">
          <div className="portal-brand">
            <Link className="portal-brand-link" href="/app">
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
                <strong>{t("portalLayout.brandTitle")}</strong>
                <span>{t("portalLayout.brandSubtitle")}</span>
              </span>
            </Link>
            <p className="portal-brand-sub">{t("portalLayout.brandDescription")}</p>
          </div>

          <ClientPortalNav />

          <section className="portal-profile">
            <p className="portal-profile-label">{t("portalLayout.signedInAs")}</p>
            <p className="portal-profile-name">{displayName}</p>
            <p className="portal-profile-email">{user.email || ""}</p>
          </section>

          {internalUser ? (
            <section className="portal-profile">
              <p className="portal-profile-label">{t("portalLayout.internalPreview")}</p>
              <Link className="portal-side-link" href="/hq">
                {t("portalLayout.openHq")}
              </Link>
            </section>
          ) : null}

          <section className="portal-profile">
            <Link className="portal-side-link" href="/app/settings">
              {t("portalLayout.workspaceSettings")}
            </Link>
            <LogoutButton />
          </section>
        </aside>

        <section className="portal-content">
          <header className="portal-topbar">
            <div className="portal-topbar-copy">
              <p>{t("portalLayout.quickAddLabel")}</p>
              <span>{t("portalLayout.quickAddDescription")}</span>
            </div>
            <div className="portal-topbar-actions">
              <ThemeToggle />
              <LocaleToggle />
              <QuickAddLeadButton
                defaultOrgId={defaultOrgId}
                internalUser={internalUser}
                calendarAccessRole={calendarAccessRole}
                label={t("buttons.addLead")}
              />
            </div>
          </header>
          {showOnboardingReminder ? (
            <section className="card portal-onboarding-reminder">
              <div className="stack-cell">
                <strong>{t("portalLayout.onboardingPausedTitle")}</strong>
                <p className="muted">{t("portalLayout.onboardingPausedDescription")}</p>
                <Link className="btn primary" href="/app/onboarding">
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
