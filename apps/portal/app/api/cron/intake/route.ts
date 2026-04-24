import { NextResponse } from "next/server";
import { isValidCronSecret } from "@/lib/cron-auth";
import {
  ensureIntakeCallbackEvent,
} from "@/lib/intake-automation";
import { processMissedCallRecovery } from "@/lib/missed-call-recovery";
import {
  processDueConversationalFollowUps,
} from "@/lib/conversational-sms";
import { normalizeEnvValue } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { processDueSmsDispatchQueue } from "@/lib/sms-dispatch-queue";

export const dynamic = "force-dynamic";

const DEFAULT_WINDOW_HOURS = 48;
const DEFAULT_LIMIT = 200;
const ROUTE = "/api/cron/intake";

function clampInt(
  value: string | null,
  {
    fallback,
    min,
    max,
  }: {
    fallback: number;
    min: number;
    max: number;
  },
): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
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

async function handleCronIntake(req: Request) {
  const authError = validateCronAuth(req);
  if (authError) {
    return authError;
  }

  const url = new URL(req.url);
  const windowHours = clampInt(url.searchParams.get("windowHours"), {
    fallback: DEFAULT_WINDOW_HOURS,
    min: 1,
    max: 168,
  });
  const limit = clampInt(url.searchParams.get("limit"), {
    fallback: DEFAULT_LIMIT,
    min: 1,
    max: 1000,
  });

  const now = new Date();
  const cronLog = await prisma.internalCronRunLog.create({
    data: {
      route: ROUTE,
      status: "OK",
      startedAt: now,
      metricsJson: {
        windowHours,
        limit,
      },
    },
    select: {
      id: true,
    },
  });
  const since = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  try {
    const queueDispatchResult = await processDueSmsDispatchQueue({ maxJobs: limit });
    const conversationalFollowUps = await processDueConversationalFollowUps({ maxLeads: limit });

    const missedCalls = await prisma.call.findMany({
      where: {
        direction: "INBOUND",
        status: "MISSED",
        startedAt: { gte: since },
        leadId: { not: null },
        org: {
          missedCallAutoReplyOn: true,
          OR: [{ smsFromNumberE164: { not: null } }, { twilioConfig: { isNot: null } }],
        },
      },
      select: {
        id: true,
        orgId: true,
        leadId: true,
        twilioCallSid: true,
        startedAt: true,
        lead: {
          select: {
            id: true,
            phoneE164: true,
          },
        },
      },
      orderBy: { startedAt: "desc" },
      take: limit,
    });

    let introsSent = 0;
    let introsSkipped = 0;

    for (const call of missedCalls) {
      if (!call.leadId || !call.lead?.phoneE164) {
        introsSkipped += 1;
        continue;
      }

      const decision = await processMissedCallRecovery({
        orgId: call.orgId,
        leadId: call.lead.id,
        callId: call.id,
        callSid: call.twilioCallSid,
        fromNumberE164: call.lead.phoneE164,
        occurredAt: call.startedAt,
        source: "cron",
      });

      if (decision.action === "send" || decision.action === "queue") {
        introsSent += 1;
      } else {
        introsSkipped += 1;
      }
    }

    const completedLeads = await prisma.lead.findMany({
      where: {
        intakeStage: "COMPLETED",
        intakePreferredCallbackAt: { not: null },
        updatedAt: { gte: since },
        org: { intakeAutomationEnabled: true },
      },
      select: {
        id: true,
        orgId: true,
        intakePreferredCallbackAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });

    let callbackEventsCreated = 0;
    let callbackEventsSkipped = 0;
    for (const lead of completedLeads) {
      const callbackAt = lead.intakePreferredCallbackAt;
      if (!callbackAt) {
        callbackEventsSkipped += 1;
        continue;
      }

      const created = await ensureIntakeCallbackEvent({
        orgId: lead.orgId,
        leadId: lead.id,
        callbackAt,
      });
      if (created) {
        callbackEventsCreated += 1;
      } else {
        callbackEventsSkipped += 1;
      }
    }

    await prisma.internalCronRunLog.update({
      where: {
        id: cronLog.id,
      },
      data: {
        status:
          queueDispatchResult.failed > 0 || conversationalFollowUps.failed > 0
            ? "ERROR"
            : "OK",
        finishedAt: new Date(),
        processedCount:
          missedCalls.length +
          completedLeads.length +
          queueDispatchResult.scanned +
          conversationalFollowUps.scanned,
        successCount:
          introsSent +
          callbackEventsCreated +
          queueDispatchResult.sent +
          conversationalFollowUps.sent,
        failureCount:
          queueDispatchResult.failed + conversationalFollowUps.failed,
        metricsJson: {
          windowHours,
          limit,
          missedCallsScanned: missedCalls.length,
          introsSent,
          introsSkipped,
          completedLeadsScanned: completedLeads.length,
          callbackEventsCreated,
          callbackEventsSkipped,
          queuedSmsDispatch: queueDispatchResult,
          conversationalFollowUps,
        },
      },
    });

    return NextResponse.json({
      ok: true,
      processedAt: now.toISOString(),
      windowHours,
      limit,
      missedCallsScanned: missedCalls.length,
      introsSent,
      introsSkipped,
      completedLeadsScanned: completedLeads.length,
      callbackEventsCreated,
      callbackEventsSkipped,
      queuedSmsDispatch: queueDispatchResult,
      conversationalFollowUps,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Intake cron failed.";

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
  return handleCronIntake(req);
}

export async function POST(req: Request) {
  return handleCronIntake(req);
}
