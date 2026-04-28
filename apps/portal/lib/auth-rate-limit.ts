type HeaderGetter = {
  get: (name: string) => string | null | undefined;
};

type HeaderMapLike = HeaderGetter | Record<string, unknown>;

type HeaderCarrier =
  | Request
  | HeaderMapLike
  | {
      headers?: HeaderMapLike;
    }
  | null
  | undefined;

type SlidingWindowInput = {
  identifier: string;
  prefix: string;
  limit: number;
  windowSeconds: number;
};

type SlidingWindowLimitResult =
  | { ok: true; remaining: number; resetAtMs: number }
  | { ok: false; remaining: number; resetAtMs: number; retryAfterSeconds: number };

export type SlidingWindowLimitChecker = (input: SlidingWindowInput) => Promise<SlidingWindowLimitResult>;

type AuthRateLimitStatus =
  | { ok: true }
  | {
      ok: false;
      retryAfterSeconds: number;
    };

function normalizeRateLimitPart(value: string): string {
  const trimmed = value.trim().toLowerCase();
  return trimmed || "unknown";
}

function hasHeaderGetter(headers: HeaderMapLike): headers is HeaderGetter {
  return typeof (headers as { get?: unknown }).get === "function";
}

function readHeaderValue(headers: HeaderMapLike | undefined, name: string): string | null {
  if (!headers) return null;

  if (hasHeaderGetter(headers)) {
    const value = headers.get(name);
    return typeof value === "string" ? value : null;
  }

  const direct = headers[name] ?? headers[name.toLowerCase()];
  if (typeof direct === "string") {
    return direct;
  }

  if (Array.isArray(direct)) {
    const [first] = direct;
    return typeof first === "string" ? first : null;
  }

  return null;
}

function resolveHeaders(input: HeaderCarrier): HeaderMapLike | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }

  if (input instanceof Request) {
    return input.headers;
  }

  if ("headers" in input) {
    const nestedHeaders = input.headers;
    if (nestedHeaders && typeof nestedHeaders === "object") {
      return nestedHeaders as HeaderMapLike;
    }
    return undefined;
  }

  return input as HeaderMapLike;
}

function buildRateLimitStatus(results: SlidingWindowLimitResult[]): AuthRateLimitStatus {
  const blocked = results.filter((result) => !result.ok);
  if (blocked.length === 0) {
    return { ok: true };
  }

  return {
    ok: false,
    retryAfterSeconds: Math.max(...blocked.map((result) => result.retryAfterSeconds)),
  };
}

export function getClientIpFromHeaders(input: HeaderCarrier): string {
  const headers = resolveHeaders(input);
  const xff = readHeaderValue(headers, "x-forwarded-for");
  if (xff) {
    return xff.split(",")[0]?.trim() || "unknown";
  }

  const realIp = readHeaderValue(headers, "x-real-ip");
  if (realIp) {
    return realIp.trim();
  }

  return "unknown";
}

export async function ensureCredentialLoginAllowed(input: {
  email: string;
  ip: string;
  checker: SlidingWindowLimitChecker;
}): Promise<AuthRateLimitStatus> {
  const email = normalizeRateLimitPart(input.email);
  const ip = normalizeRateLimitPart(input.ip);

  const results = await Promise.all([
    input.checker({
      identifier: ip,
      prefix: "rl:auth:login:ip",
      limit: 30,
      windowSeconds: 60,
    }),
    input.checker({
      identifier: `${ip}:${email}`,
      prefix: "rl:auth:login:credentials",
      limit: 10,
      windowSeconds: 60,
    }),
  ]);

  return buildRateLimitStatus(results);
}

export async function ensureForgotPasswordAllowed(input: {
  email: string;
  ip: string;
  checker: SlidingWindowLimitChecker;
}): Promise<AuthRateLimitStatus> {
  const email = normalizeRateLimitPart(input.email);
  const ip = normalizeRateLimitPart(input.ip);

  const results = await Promise.all([
    input.checker({
      identifier: ip,
      prefix: "rl:auth:forgot:ip",
      limit: 10,
      windowSeconds: 60,
    }),
    input.checker({
      identifier: email,
      prefix: "rl:auth:forgot:email",
      limit: 5,
      windowSeconds: 60,
    }),
  ]);

  return buildRateLimitStatus(results);
}
