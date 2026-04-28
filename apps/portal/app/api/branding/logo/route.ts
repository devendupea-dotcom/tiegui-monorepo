import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertOrgWriteAccess,
  requireAppApiActor,
  resolveActorOrgId,
} from "@/lib/app-api-permissions";
import { fileToDataUrl } from "@/lib/inline-images";
import { createPhotoRecord } from "@/lib/photo-storage";
import { isR2Configured, requireR2 } from "@/lib/r2";
import { checkSlidingWindowLimit } from "@/lib/rate-limit";
import { upstashRedis } from "@/lib/upstash";

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
      prefix: "rl:branding:logo:set",
      limit: 20,
      windowSeconds: 60,
    });

    if (!rate.ok) {
      return NextResponse.json(
        { ok: false, error: "Too many requests. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
      );
    }

    const contentType = req.headers.get("content-type") || "";
    let requestedOrgId: string | null = null;
    let photoId: string | null = null;
    let file: File | null = null;

    if (contentType.includes("application/json")) {
      const payload = (await req.json().catch(() => null)) as
        | {
            orgId?: unknown;
            photoId?: unknown;
          }
        | null;

      requestedOrgId = typeof payload?.orgId === "string" ? payload.orgId : null;
      photoId = typeof payload?.photoId === "string" ? payload.photoId.trim() : "";
    } else {
      const formData = await req.formData();
      requestedOrgId = typeof formData.get("orgId") === "string" ? String(formData.get("orgId")) : null;
      const photoIdCandidate = formData.get("photoId");
      photoId = typeof photoIdCandidate === "string" ? photoIdCandidate.trim() : "";
      const fileCandidate = formData.get("logo") || formData.get("photo") || formData.get("photoFile");
      if (fileCandidate instanceof File) {
        file = fileCandidate;
      }
    }

    const orgId = await resolveActorOrgId({ actor, requestedOrgId });
    assertOrgWriteAccess(actor, orgId);

    if (file) {
      if (file.size <= 0 || !file.type.startsWith("image/")) {
        throw new AppApiError("An image file is required.", 400);
      }

      if (file.size > MAX_UPLOAD_BYTES) {
        throw new AppApiError("Logo must be 2MB or smaller.", 400);
      }

      const ext = contentTypeToExt[file.type];
      if (!ext) {
        throw new AppApiError("Unsupported image type. Use JPEG, PNG, or WebP.", 400);
      }

      const key = `${orgId}/branding/${toUtcDatePrefix()}/${randomUUID()}.${ext}`;

      const photo = isR2Configured()
        ? await (async () => {
            const { r2, bucket } = requireR2();
            await r2.send(
              new PutObjectCommand({
                Bucket: bucket,
                Key: key,
                Body: Buffer.from(await file.arrayBuffer()),
                ContentType: file.type,
              }),
            );

            return createPhotoRecord({
              orgId,
              key,
              contentType: file.type,
              sizeBytes: file.size,
              originalName: file.name,
              imageDataUrl: null,
            });
          })()
        : await createPhotoRecord({
            orgId,
            key,
            contentType: file.type,
            sizeBytes: file.size,
            originalName: file.name,
            imageDataUrl: await fileToDataUrl(file),
          });

      await prisma.organization.update({
        where: { id: orgId },
        data: { logoPhotoId: photo.id },
        select: { id: true },
      });
      if (upstashRedis) {
        await upstashRedis.del(`branding:logo:signed-url:${orgId}`);
      }

      return NextResponse.json({ ok: true });
    }

    if (!photoId) {
      await prisma.organization.update({
        where: { id: orgId },
        data: { logoPhotoId: null },
        select: { id: true },
      });
      if (upstashRedis) {
        await upstashRedis.del(`branding:logo:signed-url:${orgId}`);
      }
      return NextResponse.json({ ok: true });
    }

    const photo = await prisma.photo.findFirst({
      where: {
        id: photoId,
        orgId,
      },
      select: { id: true },
    });

    if (!photo) {
      throw new AppApiError("Logo upload not found for this workspace.", 404);
    }

    await prisma.organization.update({
      where: { id: orgId },
      data: { logoPhotoId: photo.id },
      select: { id: true },
    });
    if (upstashRedis) {
      await upstashRedis.del(`branding:logo:signed-url:${orgId}`);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to save logo.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
