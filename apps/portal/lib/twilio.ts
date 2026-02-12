import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizeEnvValue } from "./env";

type ValidationResult =
  | { ok: true }
  | {
      ok: false;
      status: number;
      error: string;
    };

function firstHeaderValue(value: string | null): string | null {
  if (!value) return null;
  const [first] = value.split(",");
  const trimmed = first?.trim();
  return trimmed || null;
}

function toTwilioParamMap(formData: FormData): Record<string, string | string[]> {
  const params: Record<string, string | string[]> = {};

  for (const [key, rawValue] of formData.entries()) {
    if (typeof rawValue !== "string") {
      continue;
    }

    const existing = params[key];
    if (existing === undefined) {
      params[key] = rawValue;
      continue;
    }

    if (Array.isArray(existing)) {
      existing.push(rawValue);
      continue;
    }

    params[key] = [existing, rawValue];
  }

  return params;
}

function buildSignaturePayload(url: string, params: Record<string, string | string[]>): string {
  let payload = url;
  const keys = Object.keys(params).sort();

  for (const key of keys) {
    const value = params[key];
    if (Array.isArray(value)) {
      for (const item of [...value].sort()) {
        payload += key + item;
      }
    } else {
      payload += key + value;
    }
  }

  return payload;
}

function computeSignature(payload: string, authToken: string): string {
  return createHmac("sha1", authToken).update(Buffer.from(payload, "utf8")).digest("base64");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function buildCandidateUrls(req: Request): string[] {
  const asReceived = new URL(req.url);

  const forwardedProto = firstHeaderValue(req.headers.get("x-forwarded-proto"));
  const forwardedHost = firstHeaderValue(req.headers.get("x-forwarded-host"));
  const forwardedPort = firstHeaderValue(req.headers.get("x-forwarded-port"));

  const base = `${asReceived.pathname}${asReceived.search}`;

  const candidates = new Set<string>();
  candidates.add(asReceived.toString());

  if (forwardedHost || forwardedProto) {
    const protocol = forwardedProto || asReceived.protocol.replace(":", "");
    const hostWithPort =
      forwardedHost && forwardedPort && !forwardedHost.includes(":")
        ? `${forwardedHost}:${forwardedPort}`
        : forwardedHost || asReceived.host;
    candidates.add(`${protocol}://${hostWithPort}${base}`);
  }

  // Twilio may sign default ports without explicit :443/:80.
  for (const candidate of [...candidates]) {
    if (candidate.startsWith("https://") && candidate.includes(":443/")) {
      candidates.add(candidate.replace(":443/", "/"));
    }
    if (candidate.startsWith("http://") && candidate.includes(":80/")) {
      candidates.add(candidate.replace(":80/", "/"));
    }
  }

  return [...candidates];
}

export function validateTwilioWebhook(req: Request, formData: FormData): ValidationResult {
  const shouldValidate = normalizeEnvValue(process.env.TWILIO_VALIDATE_SIGNATURE) === "true";
  if (!shouldValidate) {
    return { ok: true };
  }

  const authToken = normalizeEnvValue(process.env.TWILIO_AUTH_TOKEN);
  if (!authToken) {
    return {
      ok: false,
      status: 500,
      error: "TWILIO_AUTH_TOKEN is required when TWILIO_VALIDATE_SIGNATURE=true.",
    };
  }

  const providedSignature = firstHeaderValue(req.headers.get("x-twilio-signature"));
  if (!providedSignature) {
    return {
      ok: false,
      status: 403,
      error: "Missing Twilio signature.",
    };
  }

  const params = toTwilioParamMap(formData);
  const candidateUrls = buildCandidateUrls(req);

  for (const url of candidateUrls) {
    const expected = computeSignature(buildSignaturePayload(url, params), authToken);
    if (safeEqual(expected, providedSignature)) {
      return { ok: true };
    }
  }

  return {
    ok: false,
    status: 403,
    error: "Invalid Twilio signature.",
  };
}
