import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getConversationalSmsLlmRuntimeSummary } from "@/lib/conversational-sms-llm";
import { isValidCronSecret } from "@/lib/cron-auth";
import { normalizeEnvValue } from "@/lib/env";
import { isInternalRole } from "@/lib/session";
import { boolEnv, checkRequiredTables, getSafeDbEnvInfo, pingDb } from "@/lib/internal-health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function isAuthorized(req: Request): Promise<boolean> {
  const session = await getServerSession(authOptions);
  const user = session?.user;
  if (user && isInternalRole(user.role)) {
    return true;
  }

  if (isValidCronSecret(req, normalizeEnvValue(process.env.CRON_SECRET))) {
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
  const warnings: string[] = [];

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
  const conversationalSmsLlm = getConversationalSmsLlmRuntimeSummary();

  if (!dbInfo.directUrlPresent) {
    warnings.push(
      "DIRECT_URL is not configured. Recommended for Prisma migrations/seed (Neon direct, non-pooler connection).",
    );
  }
  if (dbInfo.databaseHostIsPooler && !dbInfo.directUrlPresent) {
    warnings.push(
      "DATABASE_URL appears to be a pooler connection. Without DIRECT_URL, Prisma migrations may be unreliable.",
    );
  }
  if (!googleEnvPresent) {
    warnings.push("Google env is incomplete (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET).");
  }
  if (!twilioEnvPresent) {
    warnings.push("Twilio env is incomplete (TWILIO_TOKEN_ENCRYPTION_KEY).");
  }
  if (conversationalSmsLlm.mode === "explicit_on" && !conversationalSmsLlm.configured) {
    warnings.push("Conversational SMS LLM is enabled but Azure OpenAI credentials are missing.");
  }

  return NextResponse.json({
    ok: true,
    generatedAt,
    warnings,
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
      databaseUrlPresent: dbInfo.databaseUrlPresent,
      databaseHost: dbInfo.databaseHost,
      databaseHostIsPooler: dbInfo.databaseHostIsPooler,
      directUrlPresent: dbInfo.directUrlPresent,
      directHost: dbInfo.directHost,
    },
    env: {
      googleEnvPresent,
      twilioEnvPresent,
      conversationalSmsLlmEnabled: conversationalSmsLlm.enabled,
      conversationalSmsLlmConfigured: conversationalSmsLlm.configured,
      conversationalSmsLlmMode: conversationalSmsLlm.mode,
      conversationalSmsModel: conversationalSmsLlm.model,
      azureOpenAiEndpointOrigin: conversationalSmsLlm.endpointOrigin,
      cronSecretPresent: boolEnv("CRON_SECRET"),
      integrationsEncryptionKeyPresent: boolEnv("INTEGRATIONS_ENCRYPTION_KEY") || boolEnv("NEXTAUTH_SECRET"),
      twilioSendEnabled: normalizeEnvValue(process.env.TWILIO_SEND_ENABLED) === "true",
      twilioValidateSignature: normalizeEnvValue(process.env.TWILIO_VALIDATE_SIGNATURE) === "true",
    },
  });
}
