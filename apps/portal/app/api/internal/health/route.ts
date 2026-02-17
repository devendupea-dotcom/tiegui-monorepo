import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { normalizeEnvValue } from "@/lib/env";
import { isInternalRole } from "@/lib/session";
import { boolEnv, checkRequiredTables, getSafeDbEnvInfo, pingDb } from "@/lib/internal-health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getBearerToken(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  const token = trimmed.slice(7).trim();
  return token || null;
}

function getCronSecret(req: Request): string | null {
  const headerSecret = req.headers.get("x-cron-secret")?.trim();
  if (headerSecret) return headerSecret;
  return getBearerToken(req.headers.get("authorization"));
}

async function isAuthorized(req: Request): Promise<boolean> {
  const session = await getServerSession(authOptions);
  const user = session?.user;
  if (user && isInternalRole(user.role)) {
    return true;
  }

  const expectedCronSecret = normalizeEnvValue(process.env.CRON_SECRET);
  const provided = getCronSecret(req);
  if (expectedCronSecret && provided && provided === expectedCronSecret) {
    return true;
  }

  return false;
}

export async function GET(req: Request) {
  const authorized = await isAuthorized(req);
  if (!authorized) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const generatedAt = new Date().toISOString();
  const dbInfo = getSafeDbEnvInfo();

  let dbOk = false;
  let dbError: string | null = null;
  try {
    await pingDb();
    dbOk = true;
  } catch (error) {
    dbOk = false;
    dbError = error instanceof Error ? error.message : "unknown error";
  }

  let requiredTables = { ok: false, missing: [] as string[], present: [] as string[] };
  let requiredTablesError: string | null = null;
  try {
    requiredTables = await checkRequiredTables({ ttlMs: 60_000 });
  } catch (error) {
    requiredTablesError = error instanceof Error ? error.message : "unknown error";
  }

  const googleEnvPresent = boolEnv("GOOGLE_CLIENT_ID") && boolEnv("GOOGLE_CLIENT_SECRET");
  const twilioEnvPresent = boolEnv("TWILIO_TOKEN_ENCRYPTION_KEY");

  return NextResponse.json({
    ok: true,
    generatedAt,
    vercel: {
      gitCommitSha: normalizeEnvValue(process.env.VERCEL_GIT_COMMIT_SHA) || null,
      gitRef: normalizeEnvValue(process.env.VERCEL_GIT_COMMIT_REF) || null,
      deploymentId: normalizeEnvValue(process.env.VERCEL_DEPLOYMENT_ID) || null,
      environment: normalizeEnvValue(process.env.VERCEL_ENV) || null,
    },
    db: {
      dbOk,
      dbError,
      migrationTablesPresent: requiredTables.ok,
      missingTables: requiredTables.missing,
      requiredTablesError,
      databaseHost: dbInfo.databaseHost,
      databaseHostIsPooler: dbInfo.databaseHostIsPooler,
      directHost: dbInfo.directHost,
    },
    env: {
      googleEnvPresent,
      twilioEnvPresent,
      cronSecretPresent: boolEnv("CRON_SECRET"),
      integrationsEncryptionKeyPresent: boolEnv("INTEGRATIONS_ENCRYPTION_KEY") || boolEnv("NEXTAUTH_SECRET"),
      twilioSendEnabled: normalizeEnvValue(process.env.TWILIO_SEND_ENABLED) === "true",
      twilioValidateSignature: normalizeEnvValue(process.env.TWILIO_VALIDATE_SIGNATURE) === "true",
    },
  });
}

