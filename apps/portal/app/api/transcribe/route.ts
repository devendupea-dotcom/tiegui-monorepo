import { NextResponse } from "next/server";
import { normalizeEnvValue } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertCanMutateLeadJob,
  requireAppApiActor,
} from "@/lib/app-api-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const MAX_AUDIO_DURATION_SECONDS = 300;

function parseDuration(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

export async function POST(req: Request) {
  try {
    const actor = await requireAppApiActor();
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
      select: { voiceNotesEnabled: true },
    });
    if (!organization?.voiceNotesEnabled) {
      throw new AppApiError("Voice notes are disabled for this organization.", 403);
    }

    const apiKey = normalizeEnvValue(process.env.OPENAI_API_KEY);
    if (!apiKey) {
      throw new AppApiError("OPENAI_API_KEY is not configured.", 500);
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
