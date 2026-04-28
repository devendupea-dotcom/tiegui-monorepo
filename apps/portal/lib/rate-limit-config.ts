import { normalizeEnvValue } from "./env";

export function isProductionRateLimitRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return normalizeEnvValue(env.NODE_ENV) === "production" || normalizeEnvValue(env.VERCEL_ENV) === "production";
}

export function getRateLimitBackendEnv(env: NodeJS.ProcessEnv = process.env): {
  url: string;
  token: string;
  source: "upstash" | "vercel-kv" | null;
  error?: string;
} {
  const upstashUrl = normalizeEnvValue(env.UPSTASH_REDIS_REST_URL);
  const upstashToken = normalizeEnvValue(env.UPSTASH_REDIS_REST_TOKEN);
  const upstashPartial = Boolean(upstashUrl || upstashToken) && !(upstashUrl && upstashToken);
  const kvUrl = normalizeEnvValue(env.KV_REST_API_URL);
  const kvToken = normalizeEnvValue(env.KV_REST_API_TOKEN);
  const kvPartial = Boolean(kvUrl || kvToken) && !(kvUrl && kvToken);

  if (upstashPartial || kvPartial) {
    const partialPairs = [
      upstashPartial ? "UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN" : null,
      kvPartial ? "KV_REST_API_URL/KV_REST_API_TOKEN" : null,
    ].filter(Boolean);
    return {
      url: "",
      token: "",
      source: null,
      error: `Incomplete rate-limit backend env pair: ${partialPairs.join(", ")}.`,
    };
  }

  if (upstashUrl && upstashToken) {
    return { url: upstashUrl, token: upstashToken, source: "upstash" };
  }

  if (kvUrl && kvToken) {
    return { url: kvUrl, token: kvToken, source: "vercel-kv" };
  }

  return { url: "", token: "", source: null };
}

export function isRateLimitBackendConfiguredFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(getRateLimitBackendEnv(env).source);
}

export function shouldRequireRateLimitBackend(env: NodeJS.ProcessEnv = process.env): boolean {
  return isProductionRateLimitRuntime(env) || normalizeEnvValue(env.RATE_LIMIT_REQUIRE_BACKEND) === "true";
}

export function resolveMissingRateLimitBackendDecision(env: NodeJS.ProcessEnv = process.env):
  | {
      ok: true;
    }
  | {
      ok: false;
      retryAfterSeconds: number;
    } {
  if (!shouldRequireRateLimitBackend(env)) {
    return { ok: true };
  }

  return {
    ok: false,
    retryAfterSeconds: 60,
  };
}
