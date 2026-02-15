import "server-only";

import { Redis } from "@upstash/redis";
import { normalizeEnvValue } from "@/lib/env";

const url = normalizeEnvValue(process.env.UPSTASH_REDIS_REST_URL);
const token = normalizeEnvValue(process.env.UPSTASH_REDIS_REST_TOKEN);

export const upstashRedis = url && token ? new Redis({ url, token }) : null;

export function isUpstashConfigured(): boolean {
  return Boolean(upstashRedis);
}

