import { containsLegacyTemplatePollution } from "@/lib/inbox-message-display";

const SUSPICIOUS_WORK_TYPE_PATTERNS = [
  /\breply stop\b/i,
  /\bmessage and data rates may apply\b/i,
  /\bvehicle you're interested in\b/i,
  /\bplease reply yes\b/i,
  /\bcustom videos\b/i,
  /\bwhat work (?:are|r) you looking\b/i,
  /\bwhat'?s the (?:property )?address\b/i,
  /\bwhen are you looking to get this done\b/i,
  /\bjust getting a quote\b/i,
  /^what'?s up\b/i,
];

const LIKELY_WORK_SUMMARY_PATTERNS = [
  /\byard ?work\b/i,
  /\bcleanup\b/i,
  /\bedging\b/i,
  /\blandscap(?:e|ing)\b/i,
  /\bmulch(?:ing)?\b/i,
  /\bgrading\b/i,
  /\bdrainage\b/i,
  /\bhauling?\b/i,
  /\bremov(?:al|e)\b/i,
  /\bretaining\b/i,
  /\bfence\b/i,
  /\bpatio\b/i,
  /\btrim(?:ming)?\b/i,
  /\bmow(?:ing)?\b/i,
  /\bsod\b/i,
  /\binstall(?:ation)?\b/i,
  /\brepair\b/i,
  /\bproject\b/i,
  /\bhelp\b/i,
] as const;

export function containsSuspiciousLeadFieldText(value: string | null | undefined): boolean {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return false;
  return containsLegacyTemplatePollution(text) || SUSPICIOUS_WORK_TYPE_PATTERNS.some((pattern) => pattern.test(text));
}

export function containsLikelyWorkSummaryText(value: string | null | undefined): boolean {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text || containsSuspiciousLeadFieldText(text)) return false;
  return LIKELY_WORK_SUMMARY_PATTERNS.some((pattern) => pattern.test(text));
}

export function sanitizeLeadBusinessTypeLabel(value: string | null | undefined): string | null {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (containsSuspiciousLeadFieldText(text)) return null;
  if (text.length > 90) return null;
  return text;
}
