import { NextResponse } from "next/server";
import { normalizeEnvValue } from "@/lib/env";
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

function parseIntSafe(value: string | null, fallback: number, min: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export async function POST(req: Request) {
  const authError = validateCronAuth(req);
  if (authError) {
    return authError;
  }

  const url = new URL(req.url);
  const maxJobs = parseIntSafe(url.searchParams.get("maxJobs"), 40, 1, 300);
  const maxAccounts = parseIntSafe(url.searchParams.get("maxAccounts"), 20, 1, 200);

  const result = await runGoogleSyncCycle({
    maxJobs,
    maxAccounts,
    source: "CRON",
  });

  return NextResponse.json({
    ok: true,
    ...result,
  });
}
