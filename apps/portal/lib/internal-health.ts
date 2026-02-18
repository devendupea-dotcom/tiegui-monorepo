import { Prisma } from "@prisma/client";
import { normalizeEnvValue } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export type DbRequiredTablesStatus = {
  ok: boolean;
  missing: string[];
  present: string[];
};

type CachedValue<T> = { value: T; expiresAt: number };

const REQUIRED_TABLES = [
  // Google integration + sync
  "GoogleAccount",
  "GoogleOAuthState",
  "GoogleSyncJob",
  "GoogleSyncJobAttempt",
  "GoogleSyncRun",
  "GoogleSyncHealthAlert",
  // Conversational SMS
  "LeadConversationState",
  "LeadConversationAuditEvent",
  "OrganizationMessagingSettings",
] as const;

let cachedRequiredTables: CachedValue<DbRequiredTablesStatus> | null = null;

function extractHostname(input: string | undefined): string | null {
  const value = normalizeEnvValue(input);
  if (!value) return null;

  try {
    const parsed = new URL(value);
    return parsed.hostname || null;
  } catch {
    // Fallback for non-URL-safe credentials (should be URL-encoded in env)
    const atIndex = value.lastIndexOf("@");
    if (atIndex === -1) return null;
    const afterAt = value.slice(atIndex + 1);
    const hostPort = afterAt.split("/")[0] || "";
    const host = hostPort.split(":")[0] || "";
    return host.trim() ? host.trim() : null;
  }
}

export function getSafeDbEnvInfo() {
  const databaseUrl = normalizeEnvValue(process.env.DATABASE_URL);
  const directUrl = normalizeEnvValue(process.env.DIRECT_URL);

  return {
    databaseUrlPresent: Boolean(databaseUrl),
    databaseHost: extractHostname(databaseUrl),
    databaseHostIsPooler: Boolean(databaseUrl && databaseUrl.includes("-pooler.")),
    directUrlPresent: Boolean(directUrl),
    directHost: extractHostname(directUrl),
  };
}

export function boolEnv(key: string): boolean {
  return Boolean(normalizeEnvValue(process.env[key]));
}

export async function pingDb(): Promise<boolean> {
  await prisma.$queryRaw(Prisma.sql`SELECT 1`);
  return true;
}

async function checkRequiredTablesUncached(): Promise<DbRequiredTablesStatus> {
  const present: string[] = [];
  const missing: string[] = [];

  const results = await Promise.all(
    REQUIRED_TABLES.map(async (tableName) => {
      const regclassName = `public."${tableName}"`;
      // Prisma can't deserialize Postgres `regclass`, so we return a boolean instead.
      const rows = await prisma.$queryRaw<Array<{ exists: boolean | null }>>(
        Prisma.sql`SELECT (to_regclass(${regclassName}) IS NOT NULL) AS exists`,
      );
      return { tableName, exists: Boolean(rows[0]?.exists) };
    }),
  );

  for (const row of results) {
    if (row.exists) {
      present.push(row.tableName);
    } else {
      missing.push(row.tableName);
    }
  }

  return {
    ok: missing.length === 0,
    missing,
    present,
  };
}

export async function checkRequiredTables(input?: { ttlMs?: number }): Promise<DbRequiredTablesStatus> {
  const ttlMs = Math.max(5_000, Math.min(5 * 60_000, input?.ttlMs ?? 60_000));
  const now = Date.now();
  if (cachedRequiredTables && cachedRequiredTables.expiresAt > now) {
    return cachedRequiredTables.value;
  }

  const value = await checkRequiredTablesUncached();
  cachedRequiredTables = { value, expiresAt: now + ttlMs };
  return value;
}
