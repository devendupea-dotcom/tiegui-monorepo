import { cookies, headers } from "next/headers";
import { createTranslator } from "next-intl";
import type enMessages from "@/messages/en.json";
import {
  PORTAL_DEFAULT_LOCALE,
  PORTAL_LOCALE_COOKIE,
  type PortalLocale,
} from "./i18n-shared";

type PortalMessages = typeof enMessages;

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

export async function getRequestLocale(): Promise<PortalLocale> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const cookieLocale = normalizeLocale(cookieStore.get(PORTAL_LOCALE_COOKIE)?.value);
  if (cookieLocale) {
    return cookieLocale;
  }
  return detectLocaleFromAcceptLanguage(headerStore.get("accept-language"));
}

async function getMessagesForLocale(locale: PortalLocale): Promise<PortalMessages> {
  switch (locale) {
    case "es":
      return (await import("@/messages/es.json")).default as PortalMessages;
    case "en":
    default:
      return (await import("@/messages/en.json")).default;
  }
}

export async function getRequestMessages(): Promise<PortalMessages> {
  const locale = await getRequestLocale();
  return getMessagesForLocale(locale);
}

export async function getRequestTranslator() {
  const locale = await getRequestLocale();
  const messages = await getMessagesForLocale(locale);
  return createTranslator({
    locale,
    messages,
  });
}

export async function getRequestI18nContext() {
  const locale = await getRequestLocale();
  const messages = await getMessagesForLocale(locale);
  return { locale, messages };
}
