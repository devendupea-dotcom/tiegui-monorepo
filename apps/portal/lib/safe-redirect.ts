const SAFE_REDIRECT_BASE = "https://portal.local";

function isSafeInternalPath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || !trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return false;
  }
  if (trimmed.includes("\\") || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    return false;
  }

  try {
    const parsed = new URL(trimmed, SAFE_REDIRECT_BASE);
    return parsed.origin === SAFE_REDIRECT_BASE;
  } catch {
    return false;
  }
}

export function sanitizeRedirectPath(value: string | null | undefined, fallback = "/"): string {
  const safeFallback = isSafeInternalPath(fallback) ? fallback : "/";
  if (!value || !isSafeInternalPath(value)) {
    return safeFallback;
  }

  const parsed = new URL(value.trim(), SAFE_REDIRECT_BASE);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function sanitizeSameOriginRedirectUrl(
  value: string | null | undefined,
  origin: string,
  fallback = "/",
): string {
  if (!value) {
    return sanitizeRedirectPath(null, fallback);
  }

  if (isSafeInternalPath(value)) {
    return sanitizeRedirectPath(value, fallback);
  }

  try {
    const parsed = new URL(value);
    if (parsed.origin !== origin) {
      return sanitizeRedirectPath(null, fallback);
    }
    return sanitizeRedirectPath(`${parsed.pathname}${parsed.search}${parsed.hash}`, fallback);
  } catch {
    return sanitizeRedirectPath(null, fallback);
  }
}
