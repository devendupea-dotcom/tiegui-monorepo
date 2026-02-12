import { NextResponse } from "next/server";
import type { LeadStatus } from "@prisma/client";
import { normalizeEnvValue } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { sendOutboundSms } from "@/lib/sms";

export const dynamic = "force-dynamic";

const DEFAULT_NUDGE_TEMPLATE =
  "Hey {{name}}, just checking in. We can still help with your project whenever you're ready. Reply here and we can lock in next steps.";

const STALE_WINDOW_MS = 48 * 60 * 60 * 1000;
const CONTACTED_BUCKET_STATUSES: LeadStatus[] = ["NEW", "CALLED_NO_ANSWER", "VOICEMAIL", "INTERESTED", "FOLLOW_UP"];

function isCronAuthorized(req: Request): boolean {
  const secret = normalizeEnvValue(process.env.CRON_SECRET);
  if (!secret) {
    return false;
  }
  const header = req.headers.get("authorization")?.trim() || "";
  return header === `Bearer ${secret}`;
}

function clampNudges(value: number | null | undefined): number {
  const normalized = Number(value ?? 2);
  if (!Number.isFinite(normalized)) return 2;
  return Math.min(10, Math.max(1, Math.floor(normalized)));
}

function minuteOfDayInTimeZone(value: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(value);
  const hour = Number(parts.find((part) => part.type === "hour")?.value || "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value || "0");
  return hour * 60 + minute;
}

function isInsideQuietHours(input: {
  nowUtc: Date;
  startMinute: number;
  endMinute: number;
  timeZone: string;
}): boolean {
  const localMinute = minuteOfDayInTimeZone(input.nowUtc, input.timeZone);
  const start = Math.min(1439, Math.max(0, Math.floor(input.startMinute)));
  const end = Math.min(1439, Math.max(0, Math.floor(input.endMinute)));

  if (start === end) return false;
  if (start < end) {
    return localMinute >= start && localMinute < end;
  }
  return localMinute >= start || localMinute < end;
}

function buildNudgeMessage(template: string | null | undefined, leadName: string | null): string {
  const base = (template || "").trim() || DEFAULT_NUDGE_TEMPLATE;
  const safeName = (leadName || "").trim() || "there";
  return base
    .replaceAll("{{name}}", safeName)
    .replaceAll("{name}", safeName);
}

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = new Date();
  const cronLog = await prisma.internalCronRunLog.create({
    data: {
      route: "/api/cron/ghost-buster",
      status: "OK",
      startedAt,
      metricsJson: {
        staleWindowHours: 48,
      },
    },
    select: { id: true },
  });

  const staleBefore = new Date(Date.now() - STALE_WINDOW_MS);

  let totalProcessed = 0;
  let totalSent = 0;
  let totalFailures = 0;
  let totalSkippedQuietHours = 0;
  let totalSkippedNoNumber = 0;

  try {
    const organizations = await prisma.organization.findMany({
      where: {
        ghostBustingEnabled: true,
      },
      select: {
        id: true,
        name: true,
        smsFromNumberE164: true,
        ghostBustingQuietHoursStart: true,
        ghostBustingQuietHoursEnd: true,
        ghostBustingMaxNudges: true,
        ghostBustingTemplateText: true,
        dashboardConfig: {
          select: {
            calendarTimezone: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const orgResults: Array<{
      orgId: string;
      orgName: string;
      sent: number;
      failures: number;
      skippedQuietHours: number;
      skippedNoNumber: number;
      candidates: number;
    }> = [];

    for (const org of organizations) {
      const orgTimeZone = org.dashboardConfig?.calendarTimezone || "America/Los_Angeles";
      const maxNudges = clampNudges(org.ghostBustingMaxNudges);

      let sent = 0;
      let failures = 0;
      let skippedQuietHours = 0;
      let skippedNoNumber = 0;

      if (!org.smsFromNumberE164) {
        skippedNoNumber += 1;
        orgResults.push({
          orgId: org.id,
          orgName: org.name,
          sent,
          failures,
          skippedQuietHours,
          skippedNoNumber,
          candidates: 0,
        });
        totalSkippedNoNumber += skippedNoNumber;
        continue;
      }

      if (
        isInsideQuietHours({
          nowUtc: new Date(),
          startMinute: org.ghostBustingQuietHoursStart,
          endMinute: org.ghostBustingQuietHoursEnd,
          timeZone: orgTimeZone,
        })
      ) {
        skippedQuietHours += 1;
        orgResults.push({
          orgId: org.id,
          orgName: org.name,
          sent,
          failures,
          skippedQuietHours,
          skippedNoNumber,
          candidates: 0,
        });
        totalSkippedQuietHours += skippedQuietHours;
        continue;
      }

      const leads = await prisma.lead.findMany({
        where: {
          orgId: org.id,
          status: { in: CONTACTED_BUCKET_STATUSES },
          lastInboundAt: { not: null, lte: staleBefore },
          lastOutboundAt: { not: null, lte: staleBefore },
          ghostNudgeCount: { lt: maxNudges },
          NOT: {
            messages: {
              some: {
                type: "SYSTEM_NUDGE",
                createdAt: { gte: staleBefore },
              },
            },
          },
          OR: [{ lastGhostNudgeAt: null }, { lastGhostNudgeAt: { lte: staleBefore } }],
        },
        select: {
          id: true,
          orgId: true,
          contactName: true,
          businessName: true,
          phoneE164: true,
          status: true,
          ghostNudgeCount: true,
          lastGhostNudgeAt: true,
        },
        orderBy: [{ lastInboundAt: "asc" }, { updatedAt: "asc" }],
        take: 200,
      });

      totalProcessed += leads.length;

      for (const lead of leads) {
        if (lead.status === "DNC") {
          continue;
        }

        const nudgeBody = buildNudgeMessage(
          org.ghostBustingTemplateText,
          lead.contactName || lead.businessName || null,
        );
        const now = new Date();
        const providerResult = await sendOutboundSms({
          fromNumberE164: org.smsFromNumberE164,
          toNumberE164: lead.phoneE164,
          body: nudgeBody,
        });

        if (providerResult.status === "FAILED") {
          failures += 1;
          await prisma.internalCronRunLog.create({
            data: {
              route: "/api/cron/ghost-buster",
              orgId: org.id,
              status: "ERROR",
              startedAt: now,
              finishedAt: now,
              processedCount: 1,
              successCount: 0,
              failureCount: 1,
              errorMessage: providerResult.notice || "Ghost buster nudge failed to send.",
              metricsJson: {
                leadId: lead.id,
                toNumberE164: lead.phoneE164,
              },
            },
          });
          continue;
        }

        await prisma.$transaction([
          prisma.message.create({
            data: {
              orgId: lead.orgId,
              leadId: lead.id,
              direction: "OUTBOUND",
              type: "SYSTEM_NUDGE",
              fromNumberE164: org.smsFromNumberE164,
              toNumberE164: lead.phoneE164,
              body: nudgeBody,
              provider: "TWILIO",
              providerMessageSid: providerResult.providerMessageSid,
              status: providerResult.status,
            },
          }),
          prisma.lead.update({
            where: { id: lead.id },
            data: {
              lastContactedAt: now,
              lastOutboundAt: now,
              ghostNudgeCount: {
                increment: 1,
              },
              lastGhostNudgeAt: now,
            },
          }),
        ]);

        sent += 1;
      }

      totalSent += sent;
      totalFailures += failures;
      totalSkippedQuietHours += skippedQuietHours;
      totalSkippedNoNumber += skippedNoNumber;

      orgResults.push({
        orgId: org.id,
        orgName: org.name,
        sent,
        failures,
        skippedQuietHours,
        skippedNoNumber,
        candidates: leads.length,
      });
    }

    await prisma.internalCronRunLog.update({
      where: { id: cronLog.id },
      data: {
        status: totalFailures > 0 ? "ERROR" : "OK",
        finishedAt: new Date(),
        processedCount: totalProcessed,
        successCount: totalSent,
        failureCount: totalFailures,
        metricsJson: {
          processed: totalProcessed,
          sent: totalSent,
          failures: totalFailures,
          skippedQuietHours: totalSkippedQuietHours,
          skippedNoNumber: totalSkippedNoNumber,
          orgCount: organizations.length,
          orgResults,
        },
      },
    });

    return NextResponse.json({
      ok: true,
      processed: totalProcessed,
      sent: totalSent,
      failures: totalFailures,
      skippedQuietHours: totalSkippedQuietHours,
      skippedNoNumber: totalSkippedNoNumber,
      orgCount: organizations.length,
      orgResults,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ghost buster failed.";
    await prisma.internalCronRunLog.update({
      where: { id: cronLog.id },
      data: {
        status: "ERROR",
        finishedAt: new Date(),
        processedCount: totalProcessed,
        successCount: totalSent,
        failureCount: totalFailures + 1,
        errorMessage: message,
        metricsJson: {
          processed: totalProcessed,
          sent: totalSent,
          failures: totalFailures,
          skippedQuietHours: totalSkippedQuietHours,
          skippedNoNumber: totalSkippedNoNumber,
        },
      },
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
