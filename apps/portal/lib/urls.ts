import { normalizeEnvValue } from "./env";

function firstHeaderValue(value: string | null): string | null {
  if (!value) return null;
  const [first] = value.split(",");
  return first?.trim() || null;
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "0.0.0.0";
}

function normalizeConfiguredBaseUrl(value: string | undefined): string | null {
  const configured = normalizeEnvValue(value);
  if (!configured) {
    return null;
  }

  try {
    const parsed = new URL(configured.startsWith("http") ? configured : `https://${configured}`);
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return configured.replace(/\/$/, "");
  }
}

export function getConfiguredBaseUrl(): string | null {
  return (
    normalizeConfiguredBaseUrl(process.env.NEXTAUTH_URL) ||
    normalizeConfiguredBaseUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL) ||
    normalizeConfiguredBaseUrl(process.env.VERCEL_URL)
  );
}

export function getBaseUrlFromRequest(req: Request): string {
  const configured = getConfiguredBaseUrl();
  const vercelEnv = normalizeEnvValue(process.env.VERCEL_ENV);
  const forwardedProto = firstHeaderValue(req.headers.get("x-forwarded-proto"));
  const forwardedHost = firstHeaderValue(req.headers.get("x-forwarded-host"));
  const host = forwardedHost || firstHeaderValue(req.headers.get("host"));

  if (host && vercelEnv === "preview") {
    return `${forwardedProto || "https"}://${host}`;
  }

  if (configured) {
    try {
      const parsed = new URL(configured);
      if (host && isLocalHostname(parsed.hostname) && !isLocalHostname(host.split(":")[0] || "")) {
        return `${forwardedProto || parsed.protocol.replace(":", "") || "https"}://${host}`;
      }
      return parsed.toString().replace(/\/$/, "");
    } catch {
      return configured.replace(/\/$/, "");
    }
  }

  if (!host) return "http://localhost:3001";

  return `${forwardedProto || "https"}://${host}`;
}
