import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import {
  PORTAL_DEFAULT_LOCALE,
  PORTAL_LOCALE_COOKIE,
  type PortalLocale,
} from "./lib/i18n-shared";

function normalizeLocale(value: string | null | undefined): PortalLocale | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "en" || normalized.startsWith("en-")) return "en";
  if (normalized === "es" || normalized.startsWith("es-")) return "es";
  return null;
}

function getLocaleFromAcceptLanguage(headerValue: string | null): PortalLocale {
  if (!headerValue) return PORTAL_DEFAULT_LOCALE;
  const parts = headerValue.split(",");
  for (const part of parts) {
    const candidate = part.split(";")[0]?.trim();
    const locale = normalizeLocale(candidate);
    if (locale) return locale;
  }
  return PORTAL_DEFAULT_LOCALE;
}

export default getRequestConfig(async () => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const cookieLocale = normalizeLocale(cookieStore.get(PORTAL_LOCALE_COOKIE)?.value);
  const locale = cookieLocale || getLocaleFromAcceptLanguage(headerStore.get("accept-language"));

  const messages =
    locale === "es"
      ? (await import("./messages/es.json")).default
      : (await import("./messages/en.json")).default;

  return {
    locale,
    messages,
  };
});
