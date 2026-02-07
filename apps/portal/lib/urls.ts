import { normalizeEnvValue } from "./env";

export function getBaseUrlFromRequest(req: Request): string {
  const configured = normalizeEnvValue(process.env.NEXTAUTH_URL);
  if (configured) return configured.replace(/\/$/, "");

  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (!host) return "http://localhost:3001";

  return `${proto}://${host}`;
}

