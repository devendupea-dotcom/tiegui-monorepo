import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertCanMutateLeadJob,
  requireAppApiActor,
} from "@/lib/app-api-permissions";
import { requireR2 } from "@/lib/r2";
import { checkSlidingWindowLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

const contentTypeToExt: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  // iOS can produce HEIC/HEIF. We accept it for now and store as-is.
  "image/heic": "heic",
  "image/heif": "heif",
};

function toUtcDatePrefix(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  try {
    const actor = await requireAppApiActor();

    const rate = await checkSlidingWindowLimit({
      identifier: actor.id,
      prefix: "rl:photos:sign-upload",
      limit: 30,
      windowSeconds: 60,
    });

    if (!rate.ok) {
      return NextResponse.json(
        { ok: false, error: "Too many uploads. Try again shortly." },
        {
          status: 429,
          headers: {
            "Retry-After": String(rate.retryAfterSeconds),
          },
        },
      );
    }

    const payload = (await req.json().catch(() => null)) as
      | {
          leadId?: unknown;
          contentType?: unknown;
          sizeBytes?: unknown;
          originalName?: unknown;
        }
      | null;

    const leadId = typeof payload?.leadId === "string" ? payload.leadId : "";
    const contentType = typeof payload?.contentType === "string" ? payload.contentType : "";
    const sizeBytes = typeof payload?.sizeBytes === "number" ? payload.sizeBytes : Number(payload?.sizeBytes);
    const originalName = typeof payload?.originalName === "string" ? payload.originalName : null;

    if (!leadId) {
      throw new AppApiError("leadId is required.", 400);
    }

    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      throw new AppApiError("sizeBytes must be a positive number.", 400);
    }

    if (sizeBytes > MAX_UPLOAD_BYTES) {
      throw new AppApiError("Photo must be 12MB or smaller.", 400);
    }

    const ext = contentTypeToExt[contentType];
    if (!ext) {
      throw new AppApiError("Unsupported image type. Use JPEG, PNG, WebP, or HEIC.", 400);
    }

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, orgId: true },
    });

    if (!lead) {
      throw new AppApiError("Job not found.", 404);
    }

    await assertCanMutateLeadJob({ actor, orgId: lead.orgId, leadId: lead.id });

    const { r2, bucket } = requireR2();

    const key = `${lead.orgId}/${toUtcDatePrefix()}/${randomUUID()}.${ext}`;

    const photo = await prisma.photo.create({
      data: {
        orgId: lead.orgId,
        key,
        contentType,
        sizeBytes: Math.trunc(sizeBytes),
        originalName: originalName?.slice(0, 255) || null,
      },
      select: { id: true, key: true },
    });

    const uploadUrl = await getSignedUrl(
      r2,
      new PutObjectCommand({
        Bucket: bucket,
        Key: photo.key,
        ContentType: contentType,
      }),
      { expiresIn: 60 },
    );

    return NextResponse.json({ ok: true, uploadUrl, photoId: photo.id, key: photo.key });
  } catch (error) {
    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to sign upload.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
