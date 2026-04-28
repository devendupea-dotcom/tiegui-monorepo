import type { ResolvedMessageLocale } from "@/lib/message-language";

const OPT_OUT_HINT_EN = "Reply STOP to opt out.";
const OPT_OUT_HINT_ES = "Responde STOP para dejar de recibir mensajes.";
const A2P_OPENER_DISCLOSURE_EN = "Reply STOP to unsubscribe.";
const A2P_OPENER_DISCLOSURE_BILINGUAL = "Reply STOP to unsubscribe / Responde STOP para cancelar.";
const STOP_KEYWORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "OPTOUT", "REVOKE"]);
const START_KEYWORDS = new Set(["START", "UNSTOP"]);
const HELP_KEYWORDS = new Set(["HELP"]);

export type SmsComplianceKeyword = "STOP" | "START" | "HELP";

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function hasOptOutHint(body: string, locale: ResolvedMessageLocale): boolean {
  const normalized = normalizeWhitespace(body);
  if (!normalized) return false;

  if (locale === "ES") {
    return normalized.includes("responde stop") || normalized.includes("stop para dejar de recibir");
  }

  return (
    normalized.includes("reply stop") ||
    normalized.includes("text stop") ||
    normalized.includes("stop to opt out")
  );
}

function hasDisclosure(body: string, disclosure: string): boolean {
  return normalizeWhitespace(body).includes(normalizeWhitespace(disclosure));
}

function normalizeInboundKeyword(body: string): string {
  return body.trim().toUpperCase().split(/\s+/)[0] || "";
}

export function getSmsOptOutHint(locale: ResolvedMessageLocale): string {
  return locale === "ES" ? OPT_OUT_HINT_ES : OPT_OUT_HINT_EN;
}

export function ensureSmsOptOutHint(body: string, locale: ResolvedMessageLocale): string {
  const trimmed = body.trim();
  if (!trimmed) {
    return getSmsOptOutHint(locale);
  }

  if (hasOptOutHint(trimmed, locale)) {
    return trimmed;
  }

  return `${trimmed}\n\n${getSmsOptOutHint(locale)}`;
}

export function getSmsA2POpenerDisclosure(variant: "EN" | "BILINGUAL"): string {
  return variant === "BILINGUAL" ? A2P_OPENER_DISCLOSURE_BILINGUAL : A2P_OPENER_DISCLOSURE_EN;
}

export function ensureSmsA2POpenerDisclosure(body: string, variant: "EN" | "BILINGUAL"): string {
  const trimmed = body.trim();
  const disclosure = getSmsA2POpenerDisclosure(variant);
  if (!trimmed) {
    return disclosure;
  }

  if (hasDisclosure(trimmed, disclosure)) {
    return trimmed;
  }

  return `${trimmed} ${disclosure}`.trim();
}

export function parseSmsComplianceKeyword(body: string): SmsComplianceKeyword | null {
  const keyword = normalizeInboundKeyword(body);
  if (STOP_KEYWORDS.has(keyword)) return "STOP";
  if (START_KEYWORDS.has(keyword)) return "START";
  if (HELP_KEYWORDS.has(keyword)) return "HELP";
  return null;
}

export function buildSmsComplianceReply(input: {
  keyword: SmsComplianceKeyword;
  bizName: string;
  bizPhone?: string | null;
}): string {
  const bizName = input.bizName.trim() || "Our office";

  if (input.keyword === "STOP") {
    return `You've been unsubscribed from ${bizName} messages. Reply START to re-subscribe.`;
  }

  if (input.keyword === "START") {
    return `You've been re-subscribed to ${bizName} messages. Reply STOP at any time to unsubscribe.`;
  }

  const bizPhone = input.bizPhone?.trim() || "our office";
  return `${bizName} automated messaging. For support contact us at ${bizPhone}. Reply STOP to unsubscribe.`;
}
