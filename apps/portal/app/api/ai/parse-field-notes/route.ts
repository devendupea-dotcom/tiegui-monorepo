import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";
import { normalizeEnvValue } from "@/lib/env";
import {
  createEmptyParsedFieldNotes,
  fieldNotesJsonSchema,
  normalizeParsedFieldNotes,
} from "@/lib/field-notes";
import { prisma } from "@/lib/prisma";
import { checkSlidingWindowLimit } from "@/lib/rate-limit";
import { capturePortalError } from "@/lib/telemetry";
import { maybeSendAiQuotaAlerts } from "@/lib/usage-alerts";
import { startOfUtcDay, startOfUtcMonth } from "@/lib/usage";
import {
  AppApiError,
  assertOrgReadAccess,
  requireAppApiActor,
  resolveActorOrgId,
} from "@/lib/app-api-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const DEFAULT_FIELD_NOTES_COST_CENTS = 4;
const FIELD_NOTES_MODEL = "gpt-4.1-mini";
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type ParseFieldNotesJsonPayload = {
  orgId?: unknown;
  image?: unknown;
  imageBase64?: unknown;
  base64?: unknown;
  mimeType?: unknown;
};

type OpenAiResponsesPayload =
  | {
      output_text?: unknown;
      output?: Array<{
        content?: Array<{
          type?: unknown;
          text?: unknown;
        }>;
      }>;
      error?: {
        message?: unknown;
      };
    }
  | null;

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  const firstNewline = trimmed.indexOf("\n");
  if (firstNewline === -1) {
    return trimmed.replace(/```/g, "").trim();
  }

  const lastFence = trimmed.lastIndexOf("```");
  const body = lastFence > firstNewline ? trimmed.slice(firstNewline + 1, lastFence) : trimmed.slice(firstNewline + 1);
  return body.trim();
}

function extractJsonBody(value: string): string {
  const withoutFence = stripCodeFence(value);
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return withoutFence.slice(start, end + 1);
  }
  return withoutFence;
}

function extractOpenAiText(payload: OpenAiResponsesPayload): string {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const chunks =
    payload?.output
      ?.flatMap((message) => message.content || [])
      .map((item) => (item?.type === "output_text" && typeof item.text === "string" ? item.text : ""))
      .filter(Boolean) || [];

  return chunks.join("\n").trim();
}

function estimateBase64Size(value: string): number {
  const normalized = value.replace(/^data:[^,]+,/, "").replace(/\s/g, "");
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function normalizeDataUrl(value: string, mimeType: string | null): { dataUrl: string; mimeType: string } {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new AppApiError("Image data is required.", 400);
  }

  if (trimmed.startsWith("data:")) {
    const match = /^data:([^;,]+);base64,/i.exec(trimmed);
    if (!match) {
      throw new AppApiError("Image base64 must be a valid data URL.", 400);
    }
    const detectedMimeType = match[1]?.toLowerCase() || "";
    if (!ALLOWED_IMAGE_TYPES.has(detectedMimeType)) {
      throw new AppApiError("Use a JPG, PNG, or WebP image for field notes.", 400);
    }
    return { dataUrl: trimmed, mimeType: detectedMimeType };
  }

  const normalizedMimeType = (mimeType || "").trim().toLowerCase();
  if (!normalizedMimeType || !ALLOWED_IMAGE_TYPES.has(normalizedMimeType)) {
    throw new AppApiError("Base64 uploads must include mimeType as image/jpeg, image/png, or image/webp.", 400);
  }

  return {
    dataUrl: `data:${normalizedMimeType};base64,${trimmed.replace(/\s/g, "")}`,
    mimeType: normalizedMimeType,
  };
}

async function readImageInput(req: Request): Promise<{
  requestedOrgId: string | undefined;
  imageDataUrl: string;
  sizeBytes: number;
}> {
  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const payload = (await req.json().catch(() => null)) as ParseFieldNotesJsonPayload | null;
    const requestedOrgId = typeof payload?.orgId === "string" ? payload.orgId.trim() : undefined;
    const imageValue =
      typeof payload?.image === "string"
        ? payload.image
        : typeof payload?.imageBase64 === "string"
          ? payload.imageBase64
          : typeof payload?.base64 === "string"
            ? payload.base64
            : "";

    const { dataUrl } = normalizeDataUrl(
      imageValue,
      typeof payload?.mimeType === "string" ? payload.mimeType : null,
    );
    const sizeBytes = estimateBase64Size(dataUrl);
    if (sizeBytes <= 0 || sizeBytes > MAX_IMAGE_BYTES) {
      throw new AppApiError("Field note image must be 8MB or smaller.", 400);
    }

    return {
      requestedOrgId,
      imageDataUrl: dataUrl,
      sizeBytes,
    };
  }

  const formData = await req.formData();
  const requestedOrgId = typeof formData.get("orgId") === "string" ? String(formData.get("orgId")).trim() : undefined;
  const fileCandidate = formData.get("image") || formData.get("photo") || formData.get("file");

  if (!(fileCandidate instanceof File) || fileCandidate.size <= 0) {
    throw new AppApiError("A field note image is required.", 400);
  }

  if (!ALLOWED_IMAGE_TYPES.has(fileCandidate.type)) {
    throw new AppApiError("Use a JPG, PNG, or WebP image for field notes.", 400);
  }

  if (fileCandidate.size > MAX_IMAGE_BYTES) {
    throw new AppApiError("Field note image must be 8MB or smaller.", 400);
  }

  const imageDataUrl = `data:${fileCandidate.type};base64,${Buffer.from(await fileCandidate.arrayBuffer()).toString("base64")}`;

  return {
    requestedOrgId,
    imageDataUrl,
    sizeBytes: fileCandidate.size,
  };
}

async function reserveAiQuota(input: {
  orgId: string;
  actorId: string;
  estimatedCostCents: number;
}) {
  const organization = await prisma.organization.findUnique({
    where: { id: input.orgId },
    select: {
      aiMonthlyBudgetCents: true,
      aiHardStop: true,
      aiUserDailyRequestLimit: true,
    },
  });

  if (!organization) {
    throw new AppApiError("Organization not found.", 404);
  }

  const now = new Date();
  const periodStart = startOfUtcMonth(now);
  const dayStart = startOfUtcDay(now);

  const quotaSnapshot = await prisma.$transaction(async (tx) => {
    if (organization.aiUserDailyRequestLimit > 0) {
      await tx.aiUserDayUsage.upsert({
        where: {
          orgId_userId_dayStart: {
            orgId: input.orgId,
            userId: input.actorId,
            dayStart,
          },
        },
        create: {
          orgId: input.orgId,
          userId: input.actorId,
          dayStart,
        },
        update: {},
      });

      const updatedDaily = await tx.aiUserDayUsage.updateMany({
        where: {
          orgId: input.orgId,
          userId: input.actorId,
          dayStart,
          requestsCount: { lt: organization.aiUserDailyRequestLimit },
        },
        data: {
          requestsCount: { increment: 1 },
          estimatedCostCents: { increment: input.estimatedCostCents },
        },
      });

      if (updatedDaily.count === 0) {
        throw new AppApiError("Daily AI request limit reached. Try again tomorrow.", 429);
      }
    }

    await tx.aiUsage.upsert({
      where: { orgId_periodStart: { orgId: input.orgId, periodStart } },
      create: { orgId: input.orgId, periodStart },
      update: {},
    });

    const monthlyBudget = organization.aiMonthlyBudgetCents || 0;
    const hardStop = organization.aiHardStop ?? true;

    if (monthlyBudget > 0 && hardStop) {
      const updatedMonthly = await tx.$executeRaw`
        UPDATE "AiUsage"
        SET "requestsCount" = "requestsCount" + 1,
            "estimatedCostCents" = "estimatedCostCents" + ${input.estimatedCostCents},
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "orgId" = ${input.orgId}
          AND "periodStart" = ${periodStart}
          AND ("estimatedCostCents" + ${input.estimatedCostCents}) <= ${monthlyBudget};
      `;

      if (Number(updatedMonthly) === 0) {
        throw new AppApiError("AI budget limit reached for this month. Contact TieGui to raise the cap.", 429);
      }
    } else {
      await tx.aiUsage.updateMany({
        where: { orgId: input.orgId, periodStart },
        data: {
          requestsCount: { increment: 1 },
          estimatedCostCents: { increment: input.estimatedCostCents },
        },
      });
    }

    const updated = await tx.aiUsage.findUnique({
      where: { orgId_periodStart: { orgId: input.orgId, periodStart } },
      select: { estimatedCostCents: true },
    });

    return {
      usedCents: updated?.estimatedCostCents ?? 0,
      limitCents: monthlyBudget,
      periodStart,
    };
  });

  if (quotaSnapshot.limitCents > 0) {
    try {
      await maybeSendAiQuotaAlerts({
        orgId: input.orgId,
        periodStart: quotaSnapshot.periodStart,
        usedCents: quotaSnapshot.usedCents,
        limitCents: quotaSnapshot.limitCents,
      });
    } catch (error) {
      console.warn("Failed to send AI quota alert email for field notes.", error);
    }
  }
}

function buildPrompt(): string {
  const schemaExample = JSON.stringify(createEmptyParsedFieldNotes(), null, 2);
  const schemaReference = JSON.stringify(fieldNotesJsonSchema, null, 2);

  return [
    "Read this contractor field-note photo and extract structured job data.",
    "The notes may be handwritten, messy, abbreviated, or partially cut off.",
    "Return only valid JSON.",
    "Do not wrap the JSON in markdown.",
    "Do not invent details that are not present in the image.",
    "If a field is missing or unclear, return an empty string or an empty array.",
    "Use this JSON shape:",
    schemaExample,
    "Schema reference:",
    schemaReference,
    "Rules:",
    '- measurements must be an array of objects with "label", "value", "unit", and "notes".',
    '- materials must be an array of objects with "name", "quantity", "unit", and "notes".',
    "- quote_amount should preserve the amount text exactly as written when possible.",
    "- timeline should summarize timing, schedule, or seasonality notes.",
    "- follow_up should capture reminders, open questions, callbacks, or next steps.",
  ].join("\n");
}

export async function POST(req: Request) {
  try {
    const actor = await requireAppApiActor();

    const rate = await checkSlidingWindowLimit({
      identifier: actor.id,
      prefix: "rl:ai:field-notes",
      limit: 6,
      windowSeconds: 60,
    });

    if (!rate.ok) {
      return NextResponse.json(
        { ok: false, error: "Too many scans. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
      );
    }

    const { requestedOrgId, imageDataUrl, sizeBytes } = await readImageInput(req);
    const orgId = await resolveActorOrgId({
      actor,
      requestedOrgId,
    });
    assertOrgReadAccess(actor, orgId);

    const apiKey = normalizeEnvValue(process.env.OPENAI_API_KEY);
    if (!apiKey) {
      throw new AppApiError("OPENAI_API_KEY is not configured.", 500);
    }

    await reserveAiQuota({
      orgId,
      actorId: actor.id,
      estimatedCostCents: Math.max(DEFAULT_FIELD_NOTES_COST_CENTS, Math.ceil(sizeBytes / (1024 * 1024))),
    });

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: FIELD_NOTES_MODEL,
        max_output_tokens: 1400,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: "You extract handwritten contractor field notes into accurate CRM-ready JSON.",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: buildPrompt(),
              },
              {
                type: "input_image",
                image_url: imageDataUrl,
              },
            ],
          },
        ],
      }),
    });

    const payload = (await response.json().catch(() => null)) as OpenAiResponsesPayload;
    if (!response.ok) {
      const message =
        typeof payload?.error?.message === "string"
          ? payload.error.message
          : `Field note parsing failed (${response.status}).`;
      throw new AppApiError(message, 502);
    }

    const rawText = extractOpenAiText(payload);
    if (!rawText) {
      throw new AppApiError("The AI parser returned an empty result. Try a clearer photo.", 502);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJsonBody(rawText));
    } catch (error) {
      console.error("Field notes parser returned invalid JSON.", {
        rawText,
        error,
      });
      throw new AppApiError("The AI response could not be organized into structured data. Try another photo.", 502);
    }

    const data = normalizeParsedFieldNotes(parsed);

    return NextResponse.json({
      ok: true,
      data,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "POST /api/ai/parse-field-notes",
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to parse field notes.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
