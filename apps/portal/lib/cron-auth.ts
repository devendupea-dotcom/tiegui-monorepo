import { normalizeEnvValue } from "./env";

export function getBearerToken(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  const token = trimmed.slice(7).trim();
  return token || null;
}

export function getCronSecretFromRequest(req: Request): string | null {
  const headerSecret = normalizeEnvValue(req.headers.get("x-cron-secret") || undefined);
  if (headerSecret) {
    return headerSecret;
  }

  return getBearerToken(req.headers.get("authorization"));
}

export function isValidCronSecret(req: Request, expectedSecret: string | null | undefined): boolean {
  const expected = normalizeEnvValue(expectedSecret || undefined);
  if (!expected) {
    return false;
  }

  const provided = getCronSecretFromRequest(req);
  return Boolean(provided && provided === expected);
}
