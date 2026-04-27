import "server-only";

import { Redis } from "@upstash/redis";
import { getRateLimitBackendEnv } from "./rate-limit-config";

const { url, token } = getRateLimitBackendEnv();

export const upstashRedis = url && token ? new Redis({ url, token }) : null;

export function isUpstashConfigured(): boolean {
  return Boolean(upstashRedis);
}
