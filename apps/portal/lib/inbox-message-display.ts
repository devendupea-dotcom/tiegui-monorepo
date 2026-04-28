function normalizeMessageText(value: string | null | undefined): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncate(value: string, max = 90): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 3))}...`;
}

const LEGACY_BRACKET_PLACEHOLDER_RE = /\[[A-Z][A-Z0-9 _-]{2,}\]/;
const LEGACY_TEMPLATE_BRAND_RE = /\bSunset Auto Wholsale\b|\bSunset Auto Wholesale\b/i;
const INTERNAL_TRANSLATION_KEY_RE = /\b[a-z][a-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*)+\b/;

export function containsLegacyTemplatePollution(value: string | null | undefined): boolean {
  const text = normalizeMessageText(value);
  if (!text) return false;
  return (
    LEGACY_BRACKET_PLACEHOLDER_RE.test(text) ||
    LEGACY_TEMPLATE_BRAND_RE.test(text) ||
    (INTERNAL_TRANSLATION_KEY_RE.test(text) && /[A-Z]/.test(text))
  );
}

export function sanitizeConversationMessageBody(input: {
  body: string | null | undefined;
  direction?: "inbound" | "outbound" | null;
  status?: string | null;
}): string {
  const text = normalizeMessageText(input.body);
  if (!text) return "";
  if (!containsLegacyTemplatePollution(text)) return text;

  const status = String(input.status || "").toUpperCase();
  if (status === "FAILED") {
    return "Failed outbound SMS from a legacy imported template.";
  }
  if (input.direction === "outbound") {
    return "Legacy outbound template message hidden for clarity.";
  }
  return "Legacy imported message hidden for clarity.";
}

export function sanitizeConversationSnippet(input: {
  body: string | null | undefined;
  status?: string | null;
}): string {
  const text = normalizeMessageText(input.body);
  if (!text) return "";

  if (containsLegacyTemplatePollution(text)) {
    return String(input.status || "").toUpperCase() === "FAILED"
      ? "Failed outbound SMS"
      : "Legacy imported template message";
  }

  const base = truncate(text, 100);
  if (String(input.status || "").toUpperCase() === "FAILED") {
    return `Failed: ${base}`;
  }
  return base;
}
