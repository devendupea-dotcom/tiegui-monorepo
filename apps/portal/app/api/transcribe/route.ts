import { NextResponse } from "next/server";
import { normalizeEnvValue } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertCanMutateLeadJob,
  requireAppApiActor,
} from "@/lib/app-api-permissions";
import { startOfUtcDay, startOfUtcMonth } from "@/lib/usage";
import { maybeSendAiQuotaAlerts } from "@/lib/usage-alerts";
import { checkSlidingWindowLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const MAX_AUDIO_DURATION_SECONDS = 300;
const DEFAULT_WHISPER_COST_CENTS_PER_MINUTE = 1;

function parseDuration(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

export async function POST(req: Request) {
  try {
    const actor = await requireAppApiActor();

    const rate = await checkSlidingWindowLimit({
      identifier: actor.id,
      prefix: "rl:ai:transcribe",
      limit: 10,
      windowSeconds: 60,
    });

    if (!rate.ok) {
      return NextResponse.json(
        { ok: false, error: "Too many requests. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
      );
    }

    const formData = await req.formData();

    const jobId = String(formData.get("jobId") || "").trim();
    const file = formData.get("audio");
    const durationSeconds = parseDuration(formData.get("durationSeconds"));

    if (!jobId) {
      throw new AppApiError("jobId is required.", 400);
    }

    if (!(file instanceof File) || file.size <= 0) {
      throw new AppApiError("Audio file is required.", 400);
    }

    if (file.size > MAX_AUDIO_BYTES) {
      throw new AppApiError("Audio file is too large. Keep recordings under 10MB.", 400);
    }

    if (durationSeconds !== null && durationSeconds > MAX_AUDIO_DURATION_SECONDS) {
      throw new AppApiError("Recording is too long. Keep it under 5 minutes.", 400);
    }

    const lead = await prisma.lead.findUnique({
      where: { id: jobId },
      select: { id: true, orgId: true },
    });
    if (!lead) {
      throw new AppApiError("Job not found.", 404);
    }

    await assertCanMutateLeadJob({
      actor,
      orgId: lead.orgId,
      leadId: lead.id,
    });

    const organization = await prisma.organization.findUnique({
      where: { id: lead.orgId },
      select: {
        voiceNotesEnabled: true,
        aiMonthlyBudgetCents: true,
        aiHardStop: true,
        aiUserDailyRequestLimit: true,
      },
    });
    if (!organization?.voiceNotesEnabled) {
      throw new AppApiError("Voice notes are disabled for this organization.", 403);
    }

    const apiKey = normalizeEnvValue(process.env.OPENAI_API_KEY);
    if (!apiKey) {
      throw new AppApiError("OPENAI_API_KEY is not configured.", 500);
    }

    const now = new Date();
    const periodStart = startOfUtcMonth(now);
    const dayStart = startOfUtcDay(now);
    const centsPerMinute = Math.max(
      1,
      Math.round(
        Number(normalizeEnvValue(process.env.OPENAI_WHISPER_COST_CENTS_PER_MINUTE)) ||
          DEFAULT_WHISPER_COST_CENTS_PER_MINUTE,
      ),
    );
    const fallbackDurationSeconds = durationSeconds ?? 60;
    const minutes = Math.max(1, Math.ceil(Math.max(1, fallbackDurationSeconds) / 60));
    const estimatedCostCents = Math.max(1, minutes * centsPerMinute);

    const quotaSnapshot = await prisma.$transaction(async (tx) => {
      if (organization.aiUserDailyRequestLimit > 0) {
        await tx.aiUserDayUsage.upsert({
          where: {
            orgId_userId_dayStart: {
              orgId: lead.orgId,
              userId: actor.id,
              dayStart,
            },
          },
          create: {
            orgId: lead.orgId,
            userId: actor.id,
            dayStart,
          },
          update: {},
        });

        const updatedDaily = await tx.aiUserDayUsage.updateMany({
          where: {
            orgId: lead.orgId,
            userId: actor.id,
            dayStart,
            requestsCount: { lt: organization.aiUserDailyRequestLimit },
          },
          data: {
            requestsCount: { increment: 1 },
            estimatedCostCents: { increment: estimatedCostCents },
          },
        });

        if (updatedDaily.count === 0) {
          throw new AppApiError("Daily voice note limit reached. Try again tomorrow.", 429);
        }
      }

      await tx.aiUsage.upsert({
        where: { orgId_periodStart: { orgId: lead.orgId, periodStart } },
        create: { orgId: lead.orgId, periodStart },
        update: {},
      });

      const monthlyBudget = organization.aiMonthlyBudgetCents || 0;
      const hardStop = organization.aiHardStop ?? true;

      if (monthlyBudget > 0 && hardStop) {
        const updatedMonthly = await tx.$executeRaw`
          UPDATE "AiUsage"
          SET "requestsCount" = "requestsCount" + 1,
              "estimatedCostCents" = "estimatedCostCents" + ${estimatedCostCents},
              "updatedAt" = CURRENT_TIMESTAMP
          WHERE "orgId" = ${lead.orgId}
            AND "periodStart" = ${periodStart}
            AND ("estimatedCostCents" + ${estimatedCostCents}) <= ${monthlyBudget};
        `;

        if (Number(updatedMonthly) === 0) {
          throw new AppApiError("AI budget limit reached for this month. Contact TieGui to raise the cap.", 429);
        }
      } else {
        await tx.aiUsage.updateMany({
          where: { orgId: lead.orgId, periodStart },
          data: {
            requestsCount: { increment: 1 },
            estimatedCostCents: { increment: estimatedCostCents },
          },
        });
      }

      const updated = await tx.aiUsage.findUnique({
        where: { orgId_periodStart: { orgId: lead.orgId, periodStart } },
        select: { estimatedCostCents: true },
      });

      return {
        usedCents: updated?.estimatedCostCents ?? 0,
        limitCents: monthlyBudget,
      };
    });

    if (quotaSnapshot.limitCents > 0) {
      try {
        await maybeSendAiQuotaAlerts({
          orgId: lead.orgId,
          periodStart,
          usedCents: quotaSnapshot.usedCents,
          limitCents: quotaSnapshot.limitCents,
        });
      } catch (error) {
        console.warn("Failed to send AI quota alert email.", error);
      }
    }

    const audioForm = new FormData();
    audioForm.set("file", file, file.name || "voice-note.webm");
    audioForm.set("model", "whisper-1");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: audioForm,
    });

    const payload = (await response.json().catch(() => null)) as
      | { text?: unknown; error?: { message?: unknown } }
      | null;

    if (!response.ok) {
      const message =
        typeof payload?.error?.message === "string"
          ? payload.error.message
          : `Transcription failed (${response.status}).`;
      throw new AppApiError(message, 502);
    }

    const text = typeof payload?.text === "string" ? payload.text.trim() : "";
    if (!text) {
      throw new AppApiError("No speech detected. Try recording again.", 400);
    }

    return NextResponse.json({ ok: true, text });
  } catch (error) {
    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Transcription failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
