import { containsLikelyWorkSummaryText, containsSuspiciousLeadFieldText } from "@/lib/lead-display";

const CITY_FILLER_WORDS = new Set(["was", "is", "here", "there", "pls", "please"]);

function sanitizeLocationText(value: string | null | undefined): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^[,\s]+|[,\s]+$/g, "")
    .trim();
}

function normalizeLocationCandidate(value: string | null | undefined): string | null {
  const sanitized = sanitizeLocationText(value);
  if (!sanitized) {
    return null;
  }
  if (containsSuspiciousLeadFieldText(sanitized)) {
    return null;
  }
  if (!/\d/.test(sanitized) && containsLikelyWorkSummaryText(sanitized)) {
    return null;
  }

  if (/\d/.test(sanitized)) {
    return sanitized;
  }

  return normalizeLeadCity(sanitized) || sanitized;
}

export function normalizeLeadCity(value: string | null | undefined): string | null {
  const sanitized = sanitizeLocationText(value);
  if (!sanitized) {
    return null;
  }
  if (containsSuspiciousLeadFieldText(sanitized)) {
    return null;
  }

  const parts = sanitized.split(" ").filter(Boolean);
  while (parts.length > 1) {
    const last = (parts[parts.length - 1] || "").toLowerCase().replace(/[^a-z]/g, "");
    if (!CITY_FILLER_WORDS.has(last)) {
      break;
    }
    parts.pop();
  }

  const normalized = parts.join(" ").trim();
  if (containsLikelyWorkSummaryText(normalized)) {
    return null;
  }
  return normalized || null;
}

export function resolveLeadLocationLabel(input: {
  eventAddressLine?: string | null;
  customerAddressLine?: string | null;
  intakeLocationText?: string | null;
  city?: string | null;
}): string | null {
  const candidates = [
    normalizeLocationCandidate(input.eventAddressLine),
    normalizeLocationCandidate(input.customerAddressLine),
    normalizeLocationCandidate(input.intakeLocationText),
    normalizeLocationCandidate(normalizeLeadCity(input.city)),
  ];

  return candidates.find((candidate): candidate is string => Boolean(candidate && candidate.length > 0)) || null;
}

export function buildMapsHrefFromLocation(value: string | null | undefined): string | null {
  const normalized = normalizeLocationCandidate(value);
  if (!normalized) {
    return null;
  }

  return `https://maps.google.com/?q=${encodeURIComponent(normalized)}`;
}
