import { NextResponse } from "next/server";
import { isValidCronSecret } from "@/lib/cron-auth";
import { normalizeEnvValue } from "@/lib/env";
import { processDueOrgOwnerBookingReminders } from "@/lib/org-owner-notifications";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/cron/owner-booking-reminders";

function clampInt(
  value: string | null,
  input: {
    fallback: number;
    min: number;
    max: number;
  },
): number {
  if (!value) {
    return input.fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return input.fallback;
  }

  return Math.min(input.max, Math.max(input.min, parsed));
}

function validateCronAuth(req: Request): NextResponse | null {
  const expected = normalizeEnvValue(process.env.CRON_SECRET);
  if (!expected) {
    return NextResponse.json(
      {
        ok: false,
        error: "CRON_SECRET is not configured.",
      },
      { status: 500 },
    );
  }

  if (!isValidCronSecret(req, expected)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Unauthorized",
      },
      { status: 401 },
    );
  }

  return null;
}

async function handleOwnerBookingRemindersCron(req: Request) {
  const authError = validateCronAuth(req);
  if (authError) {
    return authError;
  }

  const url = new URL(req.url);
  const maxOrganizations = clampInt(url.searchParams.get("maxOrganizations"), {
    fallback: 200,
    min: 1,
    max: 500,
  });
  const maxEventsPerOrg = clampInt(url.searchParams.get("maxEventsPerOrg"), {
    fallback: 50,
    min: 1,
    max: 200,
  });
  const graceMinutes = clampInt(url.searchParams.get("graceMinutes"), {
    fallback: 5,
    min: 1,
    max: 30,
  });

  const startedAt = new Date();
  const cronLog = await prisma.internalCronRunLog.create({
    data: {
      route: ROUTE,
      status: "OK",
      startedAt,
      metricsJson: {
        maxOrganizations,
        maxEventsPerOrg,
        graceMinutes,
      },
    },
    select: {
      id: true,
    },
  });

  try {
    const result = await processDueOrgOwnerBookingReminders({
      now: startedAt,
      maxOrganizations,
      maxEventsPerOrg,
      graceMinutes,
    });

    await prisma.internalCronRunLog.update({
      where: {
        id: cronLog.id,
      },
      data: {
        status: result.failures > 0 ? "ERROR" : "OK",
        finishedAt: new Date(),
        processedCount: result.eventsProcessed,
        successCount: result.sent,
        failureCount: result.failures,
        metricsJson: {
          ...result,
          maxOrganizations,
          maxEventsPerOrg,
          graceMinutes,
        },
      },
    });

    return NextResponse.json({
      ok: true,
      processedAt: startedAt.toISOString(),
      ...result,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Owner booking reminders failed.";

    await prisma.internalCronRunLog.update({
      where: {
        id: cronLog.id,
      },
      data: {
        status: "ERROR",
        finishedAt: new Date(),
        errorMessage: message,
      },
    });

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  return handleOwnerBookingRemindersCron(req);
}

export async function POST(req: Request) {
  return handleOwnerBookingRemindersCron(req);
}
