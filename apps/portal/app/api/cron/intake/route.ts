import { NextResponse } from "next/server";
import {
  ensureIntakeCallbackEvent,
  sendMissedCallIntroAndStartFlow,
  type IntakeOrganizationSettings,
} from "@/lib/intake-automation";
import { normalizeEnvValue } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { processDueSmsDispatchQueue } from "@/lib/sms-dispatch-queue";

export const dynamic = "force-dynamic";

const DEFAULT_WINDOW_HOURS = 48;
const DEFAULT_LIMIT = 200;

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

function getBearerToken(headerValue: string | null): string | null {
  if (!headerValue) {
    return null;
  }
  const trimmed = headerValue.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  const token = trimmed.slice(7).trim();
  return token || null;
}

function getOrganizationSettings(call: {
  org: Omit<IntakeOrganizationSettings, "calendarTimezone"> & {
    twilioConfig?: { phoneNumber: string } | null;
    dashboardConfig?: { calendarTimezone: string } | null;
  };
}): IntakeOrganizationSettings {
  return {
    ...call.org,
    smsFromNumberE164: call.org.smsFromNumberE164 || call.org.twilioConfig?.phoneNumber || null,
    calendarTimezone: call.org.dashboardConfig?.calendarTimezone || "America/Los_Angeles",
  };
}

function getCronSecret(req: Request): string | null {
  const headerSecret = req.headers.get("x-cron-secret")?.trim();
  if (headerSecret) {
    return headerSecret;
  }
  return getBearerToken(req.headers.get("authorization"));
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

  const provided = getCronSecret(req);
  if (!provided || provided !== expected) {
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

export async function POST(req: Request) {
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
  const since = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  const queueDispatchResult = await processDueSmsDispatchQueue({ maxJobs: limit });

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
      startedAt: true,
      org: {
        select: {
          id: true,
          smsFromNumberE164: true,
          twilioConfig: {
            select: {
              phoneNumber: true,
            },
          },
          smsQuietHoursStartMinute: true,
          smsQuietHoursEndMinute: true,
          messageLanguage: true,
          missedCallAutoReplyBody: true,
          missedCallAutoReplyBodyEn: true,
          missedCallAutoReplyBodyEs: true,
          intakeAutomationEnabled: true,
          intakeAskLocationBody: true,
          intakeAskLocationBodyEn: true,
          intakeAskLocationBodyEs: true,
          intakeAskWorkTypeBody: true,
          intakeAskWorkTypeBodyEn: true,
          intakeAskWorkTypeBodyEs: true,
          intakeAskCallbackBody: true,
          intakeAskCallbackBodyEn: true,
          intakeAskCallbackBodyEs: true,
          intakeCompletionBody: true,
          intakeCompletionBodyEn: true,
          intakeCompletionBodyEs: true,
          dashboardConfig: {
            select: {
              calendarTimezone: true,
            },
          },
        },
      },
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

    const duplicateWindowStart = new Date(call.startedAt.getTime() - 2 * 60 * 1000);
    const existingOutbound = await prisma.message.findFirst({
      where: {
        orgId: call.orgId,
        leadId: call.leadId,
        direction: "OUTBOUND",
        createdAt: { gte: duplicateWindowStart },
      },
      select: { id: true },
    });

    if (existingOutbound) {
      introsSkipped += 1;
      continue;
    }

    await sendMissedCallIntroAndStartFlow({
      organization: getOrganizationSettings(call),
      leadId: call.lead.id,
      toNumberE164: call.lead.phoneE164,
    });
    introsSent += 1;
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
  });
}
