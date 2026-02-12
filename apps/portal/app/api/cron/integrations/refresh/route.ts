import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeEnvValue } from "@/lib/env";
import { getDecryptedAccessToken } from "@/lib/integrations/account-store";
import { refreshJobberTokens } from "@/lib/integrations/jobberClient";
import { refreshQboTokens } from "@/lib/integrations/qboClient";
import { runGoogleSyncCycle } from "@/lib/integrations/google-sync";

export const dynamic = "force-dynamic";

function getBearerToken(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  const token = trimmed.slice(7).trim();
  return token || null;
}

function getCronSecret(req: Request): string | null {
  const headerSecret = req.headers.get("x-cron-secret")?.trim();
  if (headerSecret) return headerSecret;
  return getBearerToken(req.headers.get("authorization"));
}

function validateCronAuth(req: Request): NextResponse | null {
  const expected = normalizeEnvValue(process.env.CRON_SECRET);
  if (!expected) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured." }, { status: 500 });
  }

  const provided = getCronSecret(req);
  if (!provided || provided !== expected) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

export async function POST(req: Request) {
  const authError = validateCronAuth(req);
  if (authError) {
    return authError;
  }

  const soon = new Date(Date.now() + 15 * 60 * 1000);
  const accounts = await prisma.integrationAccount.findMany({
    where: {
      status: "CONNECTED",
      expiresAt: {
        lte: soon,
      },
    },
    select: {
      id: true,
      orgId: true,
      provider: true,
    },
    take: 200,
  });

  let refreshed = 0;
  let skipped = 0;
  const errors: Array<{ accountId: string; provider: string; error: string }> = [];

  for (const account of accounts) {
    try {
      if (account.provider === "JOBBER") {
        await getDecryptedAccessToken({
          orgId: account.orgId,
          provider: "JOBBER",
          refresh: async (refreshToken) => {
            const refreshedToken = await refreshJobberTokens(refreshToken);
            return {
              accessToken: refreshedToken.accessToken,
              refreshToken: refreshedToken.refreshToken,
              expiresAt: refreshedToken.expiresAt,
              scopes: refreshedToken.scopes,
            };
          },
        });
      } else if (account.provider === "QBO") {
        await getDecryptedAccessToken({
          orgId: account.orgId,
          provider: "QBO",
          refresh: async (refreshToken) => {
            const refreshedToken = await refreshQboTokens(refreshToken);
            return {
              accessToken: refreshedToken.accessToken,
              refreshToken: refreshedToken.refreshToken,
              expiresAt: refreshedToken.expiresAt,
              scopes: refreshedToken.scopes,
            };
          },
        });
      } else {
        skipped += 1;
      }

      refreshed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Refresh failed.";
      errors.push({
        accountId: account.id,
        provider: account.provider,
        error: message,
      });
      await prisma.integrationAccount.update({
        where: { id: account.id },
        data: {
          status: "ERROR",
          lastError: message,
        },
      });
    }
  }

  const google = await runGoogleSyncCycle({
    maxJobs: 40,
    maxAccounts: 20,
    source: "CRON",
  });

  return NextResponse.json({
    ok: errors.length === 0,
    processed: accounts.length,
    refreshed,
    skipped,
    errors,
    google,
  });
}
