import type { LeadPreferredLanguage, MessageLanguage } from "@prisma/client";

export type ResolvedMessageLocale = "EN" | "ES";

export function resolveMessageLocale(input: {
  organizationLanguage: MessageLanguage | null | undefined;
  leadPreferredLanguage: LeadPreferredLanguage | null | undefined;
}): ResolvedMessageLocale {
  if (input.leadPreferredLanguage === "EN" || input.leadPreferredLanguage === "ES") {
    return input.leadPreferredLanguage;
  }

  if (input.organizationLanguage === "ES") {
    return "ES";
  }

  // Default to English for EN and AUTO when lead preference is unknown.
  return "EN";
}

export function pickLocalizedTemplate(input: {
  locale: ResolvedMessageLocale;
  englishTemplate?: string | null;
  spanishTemplate?: string | null;
  legacyTemplate?: string | null;
  fallbackTemplate: string;
}): string {
  const en = (input.englishTemplate || "").trim();
  const es = (input.spanishTemplate || "").trim();
  const legacy = (input.legacyTemplate || "").trim();

  if (input.locale === "ES") {
    if (es) return es;
    if (en) return en;
    if (legacy) return legacy;
    return input.fallbackTemplate;
  }

  if (en) return en;
  if (es) return es;
  if (legacy) return legacy;
  return input.fallbackTemplate;
}
