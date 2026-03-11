import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertOrgWriteAccess,
  requireAppApiActor,
  resolveActorOrgId,
} from "@/lib/app-api-permissions";
import { isR2Configured, requireR2 } from "@/lib/r2";
import { checkSlidingWindowLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

const contentTypeToExt: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function toUtcDatePrefix(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  try {
    const actor = await requireAppApiActor();

    const rate = await checkSlidingWindowLimit({
      identifier: actor.id,
      prefix: "rl:branding:logo:sign-upload",
      limit: 10,
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
          orgId?: unknown;
          contentType?: unknown;
          sizeBytes?: unknown;
          originalName?: unknown;
        }
      | null;

    const requestedOrgId = typeof payload?.orgId === "string" ? payload.orgId : null;
    const orgId = await resolveActorOrgId({ actor, requestedOrgId });
    assertOrgWriteAccess(actor, orgId);

    const contentType = typeof payload?.contentType === "string" ? payload.contentType : "";
    const sizeBytes = typeof payload?.sizeBytes === "number" ? payload.sizeBytes : Number(payload?.sizeBytes);
    const originalName = typeof payload?.originalName === "string" ? payload.originalName : null;

    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      throw new AppApiError("sizeBytes must be a positive number.", 400);
    }

    if (sizeBytes > MAX_UPLOAD_BYTES) {
      throw new AppApiError("Logo must be 2MB or smaller.", 400);
    }

    const ext = contentTypeToExt[contentType];
    if (!ext) {
      throw new AppApiError("Unsupported image type. Use JPEG, PNG, or WebP.", 400);
    }

    if (!isR2Configured()) {
      return NextResponse.json(
        { ok: false, error: "Object storage is unavailable. Upload the logo directly through the portal." },
        { status: 503 },
      );
    }

    const { r2, bucket } = requireR2();
    const key = `${orgId}/branding/${toUtcDatePrefix()}/${randomUUID()}.${ext}`;

    const photo = await prisma.photo.create({
      data: {
        orgId,
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

    const message = error instanceof Error ? error.message : "Failed to sign logo upload.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
