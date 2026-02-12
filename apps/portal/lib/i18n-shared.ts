export const PORTAL_LOCALES = ["en", "es"] as const;
export type PortalLocale = (typeof PORTAL_LOCALES)[number];

export const PORTAL_LOCALE_COOKIE = "tiegui-locale";
export const PORTAL_LOCALE_STORAGE_KEY = "tiegui-locale";
export const PORTAL_DEFAULT_LOCALE: PortalLocale = "en";
