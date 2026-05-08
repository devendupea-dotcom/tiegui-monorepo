"use client";

import Image from "next/image";
import Link from "next/link";
import type { CalendarAccessRole } from "@prisma/client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import ClientPortalNav from "./client-portal-nav";
import LogoutButton from "./logout-button";

type MobilePortalMenuProps = {
  calendarAccessRole: CalendarAccessRole;
  defaultOrgId?: string | null;
  displayName: string;
  email?: string | null;
  internalUser?: boolean;
  portalVertical?: string | null;
};

export default function MobilePortalMenu({
  calendarAccessRole,
  defaultOrgId,
  displayName,
  email,
  internalUser = false,
  portalVertical,
}: MobilePortalMenuProps) {
  const t = useTranslations("portalLayout");
  const [open, setOpen] = useState(false);

  const brandTitle = internalUser ? t("internalBrandTitle") : t("brandTitle");
  const brandSubtitle = internalUser
    ? t("internalBrandSubtitle")
    : t("brandSubtitle");
  const brandDescription = internalUser
    ? t("internalBrandDescription")
    : t("brandDescription");
  const workspaceSettingsLabel = internalUser
    ? t("internalWorkspaceSettings")
    : t("workspaceSettings");

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
    }

    document.body.classList.add("mobile-portal-menu-open");
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.classList.remove("mobile-portal-menu-open");
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <header className="mobile-portal-bar">
        <button
          type="button"
          className="mobile-portal-menu-btn"
          aria-label={t("openNavigation")}
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <span />
          <span />
          <span />
        </button>
        <Link className="mobile-portal-brand-link" href="/app" prefetch={false}>
          <span className="mobile-portal-brand-mark">
            <Image
              src="/tiegui-mark.png"
              alt="TieGui"
              width={32}
              height={32}
              className="portal-brand-image"
              priority
            />
          </span>
          <span className="mobile-portal-brand-text">
            <strong>{brandTitle}</strong>
            <span>{brandSubtitle}</span>
          </span>
        </Link>
      </header>

      {open ? (
        <div className="mobile-portal-drawer" role="dialog" aria-modal="true">
          <button
            type="button"
            className="mobile-portal-drawer-backdrop"
            aria-label={t("closeNavigation")}
            onClick={() => setOpen(false)}
          />
          <aside className="mobile-portal-drawer-card">
            <div className="mobile-portal-drawer-head">
              <div className="portal-brand">
                <Link
                  className="portal-brand-link"
                  href="/app"
                  prefetch={false}
                  onClick={() => setOpen(false)}
                >
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
              <button
                type="button"
                className="mobile-portal-close-btn"
                aria-label={t("closeNavigation")}
                onClick={() => setOpen(false)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>

            <div onClick={(event) => {
              const target = event.target;
              if (target instanceof Element && target.closest("a")) {
                setOpen(false);
              }
            }}>
              <ClientPortalNav
                calendarAccessRole={calendarAccessRole}
                defaultOrgId={defaultOrgId}
                internalUser={internalUser}
                portalVertical={portalVertical}
              />
            </div>

            <section className="portal-profile">
              <p className="portal-profile-label">{t("signedInAs")}</p>
              <p className="portal-profile-name">{displayName}</p>
              <p className="portal-profile-email">{email || ""}</p>
            </section>

            {internalUser ? (
              <section className="portal-profile">
                <p className="portal-profile-label">{t("internalPreview")}</p>
                <Link
                  className="portal-side-link"
                  href="/hq"
                  prefetch={false}
                  onClick={() => setOpen(false)}
                >
                  {t("openHq")}
                </Link>
              </section>
            ) : null}

            <section className="portal-profile">
              <Link
                className="portal-side-link"
                href="/app/settings"
                prefetch={false}
                onClick={() => setOpen(false)}
              >
                {workspaceSettingsLabel}
              </Link>
              <LogoutButton />
            </section>
          </aside>
        </div>
      ) : null}
    </>
  );
}
