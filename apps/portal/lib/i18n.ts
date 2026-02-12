import { cache } from "react";
import { cookies, headers } from "next/headers";
import type { AbstractIntlMessages } from "next-intl";
import { createTranslator } from "next-intl";
import {
  PORTAL_DEFAULT_LOCALE,
  PORTAL_LOCALE_COOKIE,
  type PortalLocale,
} from "./i18n-shared";

function isSupportedLocale(value: string | null | undefined): value is PortalLocale {
  return value === "en" || value === "es";
}

function normalizeLocale(value: string | null | undefined): PortalLocale | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (isSupportedLocale(normalized)) {
    return normalized;
  }
  if (normalized.startsWith("es")) {
    return "es";
  }
  if (normalized.startsWith("en")) {
    return "en";
  }
  return null;
}

function detectLocaleFromAcceptLanguage(headerValue: string | null): PortalLocale {
  if (!headerValue) return PORTAL_DEFAULT_LOCALE;
  const segments = headerValue.split(",");
  for (const segment of segments) {
    const [candidate] = segment.split(";");
    const locale = normalizeLocale(candidate);
    if (locale) {
      return locale;
    }
  }
  return PORTAL_DEFAULT_LOCALE;
}

export const getRequestLocale = cache((): PortalLocale => {
  const cookieLocale = normalizeLocale(cookies().get(PORTAL_LOCALE_COOKIE)?.value);
  if (cookieLocale) {
    return cookieLocale;
  }
  return detectLocaleFromAcceptLanguage(headers().get("accept-language"));
});

const getMessagesForLocale = cache(async (locale: PortalLocale): Promise<AbstractIntlMessages> => {
  switch (locale) {
    case "es":
      return (await import("@/messages/es.json")).default as AbstractIntlMessages;
    case "en":
    default:
      return (await import("@/messages/en.json")).default as AbstractIntlMessages;
  }
});

export const getRequestMessages = cache(async (): Promise<AbstractIntlMessages> => {
  const locale = getRequestLocale();
  return getMessagesForLocale(locale);
});

export const getRequestTranslator = cache(async () => {
  const locale = getRequestLocale();
  const messages = await getMessagesForLocale(locale);
  return createTranslator({
    locale,
    messages,
  });
});

export async function getRequestI18nContext() {
  const locale = getRequestLocale();
  const messages = await getMessagesForLocale(locale);
  return { locale, messages };
}
