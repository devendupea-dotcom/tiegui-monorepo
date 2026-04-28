import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { isValidCronSecret } from "@/lib/cron-auth";
import { normalizeEnvValue } from "@/lib/env";
import { getGoogleSyncAlertState } from "@/lib/integrations/google-sync";
import { prisma } from "@/lib/prisma";
import { isInternalRole } from "@/lib/session";
import { maskSid } from "@/lib/twilio-config-crypto";

export const dynamic = "force-dynamic";

async function isAuthorized(req: Request): Promise<boolean> {
  const session = await getServerSession(authOptions);
  const user = session?.user;
  if (user && isInternalRole(user.role)) {
    return true;
  }

  // Fallback: allow the cron bearer secret to fetch health without needing a browser session.
  if (isValidCronSecret(req, normalizeEnvValue(process.env.CRON_SECRET))) {
    return true;
  }

  return false;
}

function boolEnv(key: string): boolean {
  return Boolean(normalizeEnvValue(process.env[key]));
}

async function safe<T>(label: string, fn: () => Promise<T>) {
  try {
    return { ok: true as const, label, value: await fn() };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return { ok: false as const, label, error: message };
  }
}

export async function GET(req: Request) {
  const authorized = await isAuthorized(req);
  if (!authorized) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const url = new URL(req.url);
  const orgId = url.searchParams.get("orgId")?.trim() || null;
  const now = new Date();

  const envSnapshot = {
    GOOGLE_CLIENT_ID: boolEnv("GOOGLE_CLIENT_ID"),
    GOOGLE_CLIENT_SECRET: boolEnv("GOOGLE_CLIENT_SECRET"),
    GOOGLE_REDIRECT_URI: boolEnv("GOOGLE_REDIRECT_URI"),
    MICROSOFT_CLIENT_ID: boolEnv("MICROSOFT_CLIENT_ID"),
    MICROSOFT_CLIENT_SECRET: boolEnv("MICROSOFT_CLIENT_SECRET"),
    MICROSOFT_TENANT_ID: boolEnv("MICROSOFT_TENANT_ID"),
    MICROSOFT_REDIRECT_URI: boolEnv("MICROSOFT_REDIRECT_URI"),
    CRON_SECRET: boolEnv("CRON_SECRET"),
    INTEGRATIONS_ENCRYPTION_KEY:
      boolEnv("INTEGRATIONS_ENCRYPTION_KEY") || boolEnv("NEXTAUTH_SECRET"),
    NEXTAUTH_SECRET: boolEnv("NEXTAUTH_SECRET"),
    STRIPE_SECRET_KEY: boolEnv("STRIPE_SECRET_KEY"),
    STRIPE_CONNECT_CLIENT_ID: boolEnv("STRIPE_CONNECT_CLIENT_ID"),
    STRIPE_WEBHOOK_SECRET: boolEnv("STRIPE_WEBHOOK_SECRET"),
    TWILIO_TOKEN_ENCRYPTION_KEY: boolEnv("TWILIO_TOKEN_ENCRYPTION_KEY"),
    TWILIO_SEND_ENABLED:
      normalizeEnvValue(process.env.TWILIO_SEND_ENABLED) === "true",
    TWILIO_VALIDATE_SIGNATURE:
      normalizeEnvValue(process.env.TWILIO_VALIDATE_SIGNATURE) === "true",
  };

  const migrationCheck = await safe("db:migrations", async () => {
    const rows = await prisma.$queryRaw<
      Array<{
        migration_name: string;
        finished_at: Date | null;
        started_at: Date | null;
      }>
    >(Prisma.sql`
      SELECT migration_name, finished_at, started_at
      FROM _prisma_migrations
      ORDER BY finished_at DESC NULLS LAST, started_at DESC NULLS LAST
      LIMIT 8
    `);
    return {
      recent: rows.map((row) => ({
        name: row.migration_name,
        finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
      })),
      count: rows.length,
    };
  });

  const dbModelChecks = await Promise.all([
    safe("db:googleAccount", async () =>
      prisma.googleAccount.count({ where: orgId ? { orgId } : {} }),
    ),
    safe("db:googleOAuthState", async () =>
      prisma.googleOAuthState.count({ where: orgId ? { orgId } : {} }),
    ),
    safe("db:googleSyncJob", async () =>
      prisma.googleSyncJob.count({ where: orgId ? { orgId } : {} }),
    ),
    safe("db:googleSyncJobAttempt", async () =>
      prisma.googleSyncJobAttempt.count({ where: orgId ? { orgId } : {} }),
    ),
    safe("db:googleSyncRun", async () => prisma.googleSyncRun.count()),
    safe("db:googleSyncHealthAlert", async () =>
      prisma.googleSyncHealthAlert.count(),
    ),
    safe("db:leadConversationState", async () =>
      prisma.leadConversationState.count({ where: orgId ? { orgId } : {} }),
    ),
    safe("db:leadConversationAuditEvent", async () =>
      prisma.leadConversationAuditEvent.count({
        where: orgId ? { orgId } : {},
      }),
    ),
    safe("db:organizationMessagingSettings", async () =>
      prisma.organizationMessagingSettings.count({
        where: orgId ? { orgId } : {},
      }),
    ),
    safe("db:organizationTwilioConfig", async () =>
      prisma.organizationTwilioConfig.count({
        where: orgId ? { organizationId: orgId } : {},
      }),
    ),
  ]);

  const dbOk = migrationCheck.ok && dbModelChecks.every((check) => check.ok);

  const googleAccountSummary = await safe("google:accounts", async () => {
    const accounts = await prisma.googleAccount.findMany({
      ...(orgId ? { where: { orgId } } : {}),
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: {
        id: true,
        orgId: true,
        userId: true,
        googleEmail: true,
        isEnabled: true,
        writeCalendarId: true,
        scopes: true,
        lastSyncAt: true,
        syncStatus: true,
        syncError: true,
        connectedAt: true,
        expiresAt: true,
      },
    });

    const enabled = accounts.filter((a) => a.isEnabled);
    const withWrite = enabled.filter((a) =>
      a.scopes.includes("https://www.googleapis.com/auth/calendar.events"),
    );
    const lastSyncAt = enabled
      .map((a) => a.lastSyncAt)
      .filter(Boolean)
      .sort((a, b) => b!.getTime() - a!.getTime())[0];

    return {
      total: accounts.length,
      enabled: enabled.length,
      enabledWithWriteScope: withWrite.length,
      lastSyncAt: lastSyncAt ? lastSyncAt.toISOString() : null,
      lastError:
        enabled.find((a) => a.syncStatus === "ERROR")?.syncError || null,
      samples: accounts.slice(0, 5).map((a) => ({
        orgId: a.orgId,
        userId: a.userId,
        googleEmail: a.googleEmail,
        isEnabled: a.isEnabled,
        syncStatus: a.syncStatus,
        lastSyncAt: a.lastSyncAt ? a.lastSyncAt.toISOString() : null,
        syncError: a.syncError,
      })),
    };
  });

  const googleSyncSummary = await safe("google:syncHealth", async () => {
    const state = await getGoogleSyncAlertState();
    return {
      generatedAt: state.generatedAt,
      lastCronRunAt: state.lastCronRunAt
        ? state.lastCronRunAt.toISOString()
        : null,
      lastCronMinutesAgo: state.lastCronMinutesAgo,
      queueDepth: state.queueDepth,
      recent: state.recent,
      flags: state.flags,
      showBanner: state.showBanner,
    };
  });

  const twilioSummary = await safe("twilio:config", async () => {
    if (!orgId) {
      const grouped = await prisma.organizationTwilioConfig.groupBy({
        by: ["status"],
        _count: { status: true },
      });
      return {
        orgId: null,
        groupedByStatus: grouped.map((row) => ({
          status: row.status,
          count: row._count.status,
        })),
        sendEnabled: envSnapshot.TWILIO_SEND_ENABLED,
        validateSignature: envSnapshot.TWILIO_VALIDATE_SIGNATURE,
        tokenEncryptionKeyPresent: envSnapshot.TWILIO_TOKEN_ENCRYPTION_KEY,
      };
    }

    const config = await prisma.organizationTwilioConfig.findUnique({
      where: { organizationId: orgId },
      select: {
        id: true,
        twilioSubaccountSid: true,
        messagingServiceSid: true,
        phoneNumber: true,
        status: true,
        updatedAt: true,
      },
    });

    return {
      orgId,
      configured: Boolean(config),
      status: config?.status || null,
      subaccountSid: config?.twilioSubaccountSid
        ? maskSid(config.twilioSubaccountSid)
        : null,
      messagingServiceSid: config?.messagingServiceSid
        ? maskSid(config.messagingServiceSid)
        : null,
      phoneNumber: config?.phoneNumber || null,
      updatedAt: config?.updatedAt ? config.updatedAt.toISOString() : null,
      sendEnabled: envSnapshot.TWILIO_SEND_ENABLED,
      validateSignature: envSnapshot.TWILIO_VALIDATE_SIGNATURE,
      tokenEncryptionKeyPresent: envSnapshot.TWILIO_TOKEN_ENCRYPTION_KEY,
    };
  });

  return NextResponse.json({
    ok: true,
    generatedAt: now.toISOString(),
    orgId,
    env: envSnapshot,
    db: {
      ok: dbOk,
      migrationCheck,
      modelChecks: dbModelChecks,
    },
    google: {
      ok: Boolean(
        envSnapshot.GOOGLE_CLIENT_ID && envSnapshot.GOOGLE_CLIENT_SECRET,
      ),
      accounts: googleAccountSummary,
      sync: googleSyncSummary,
    },
    stripe: {
      ok: Boolean(
        envSnapshot.STRIPE_SECRET_KEY &&
        envSnapshot.STRIPE_WEBHOOK_SECRET,
      ),
      env: {
        secretPresent: envSnapshot.STRIPE_SECRET_KEY,
        connectClientIdPresent: envSnapshot.STRIPE_CONNECT_CLIENT_ID,
        webhookSecretPresent: envSnapshot.STRIPE_WEBHOOK_SECRET,
      },
    },
    twilio: {
      ok: true,
      config: twilioSummary,
    },
  });
}
