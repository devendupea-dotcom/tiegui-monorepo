import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { upstashRedis } from "@/lib/upstash";

type SlidingWindowInput = {
  identifier: string;
  prefix: string;
  limit: number;
  windowSeconds: number;
};

const limiterCache = new Map<string, Ratelimit>();

function getSlidingWindowLimiter(input: Omit<SlidingWindowInput, "identifier">): Ratelimit | null {
  if (!upstashRedis) return null;

  const key = `${input.prefix}:${input.limit}:${input.windowSeconds}`;
  const existing = limiterCache.get(key);
  if (existing) return existing;

  const limiter = new Ratelimit({
    redis: upstashRedis,
    limiter: Ratelimit.slidingWindow(input.limit, `${input.windowSeconds} s`),
    prefix: input.prefix,
  });

  limiterCache.set(key, limiter);
  return limiter;
}

export async function checkSlidingWindowLimit(input: SlidingWindowInput): Promise<
  | { ok: true; remaining: number; resetAtMs: number }
  | { ok: false; remaining: number; resetAtMs: number; retryAfterSeconds: number }
> {
  const limiter = getSlidingWindowLimiter(input);
  if (!limiter) {
    return { ok: true, remaining: Number.POSITIVE_INFINITY, resetAtMs: 0 };
  }

  const result = await limiter.limit(input.identifier);
  const resetAtMs = typeof result.reset === "number" ? result.reset : Date.now();

  if (result.success) {
    return { ok: true, remaining: result.remaining, resetAtMs };
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((resetAtMs - Date.now()) / 1000));
  return { ok: false, remaining: result.remaining, resetAtMs, retryAfterSeconds };
}

