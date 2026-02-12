"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect } from "react";
import {
  PORTAL_LOCALE_COOKIE,
  PORTAL_LOCALE_STORAGE_KEY,
  type PortalLocale,
} from "@/lib/i18n-shared";

function setLocalePersistence(locale: PortalLocale) {
  const maxAgeSeconds = 60 * 60 * 24 * 365;
  document.cookie = `${PORTAL_LOCALE_COOKIE}=${locale}; path=/; max-age=${maxAgeSeconds}; samesite=lax`;
  window.localStorage.setItem(PORTAL_LOCALE_STORAGE_KEY, locale);
}

export default function LocaleToggle() {
  const router = useRouter();
  const locale = useLocale() as PortalLocale;
  const t = useTranslations("localeToggle");

  useEffect(() => {
    setLocalePersistence(locale);
  }, [locale]);

  function applyLocale(nextLocale: PortalLocale) {
    if (nextLocale === locale) {
      return;
    }
    setLocalePersistence(nextLocale);
    router.refresh();
  }

  return (
    <div className="locale-toggle" role="group" aria-label={t("groupLabel")}>
      <button
        type="button"
        className={`locale-toggle-btn ${locale === "en" ? "active" : ""}`}
        onClick={() => applyLocale("en")}
      >
        {t("englishShort")}
      </button>
      <button
        type="button"
        className={`locale-toggle-btn ${locale === "es" ? "active" : ""}`}
        onClick={() => applyLocale("es")}
      >
        {t("spanishShort")}
      </button>
    </div>
  );
}
