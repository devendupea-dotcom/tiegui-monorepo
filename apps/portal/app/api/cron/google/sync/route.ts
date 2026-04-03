import { NextResponse } from "next/server";
import { isValidCronSecret } from "@/lib/cron-auth";
import { normalizeEnvValue } from "@/lib/env";
import { runGoogleSyncCycle } from "@/lib/integrations/google-sync";

export const dynamic = "force-dynamic";

function validateCronAuth(req: Request): NextResponse | null {
  const expected = normalizeEnvValue(process.env.CRON_SECRET);
  if (!expected) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured." }, { status: 500 });
  }

  if (!isValidCronSecret(req, expected)) {
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

async function handleGoogleSyncCron(req: Request) {
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

export async function GET(req: Request) {
  return handleGoogleSyncCron(req);
}

export async function POST(req: Request) {
  return handleGoogleSyncCron(req);
}
