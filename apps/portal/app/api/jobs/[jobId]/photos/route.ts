import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";
import {
  AppApiError,
  assertCanMutateLeadJob,
  requireAppApiActor,
} from "@/lib/app-api-permissions";
import { requireR2 } from "@/lib/r2";

type RouteContext = {
  params: { jobId: string };
};

const MAX_PHOTO_BYTES = 12 * 1024 * 1024;

const contentTypeToExt: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

function toUtcDatePrefix(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export async function POST(req: Request, { params }: RouteContext) {
  try {
    const actor = await requireAppApiActor();

    const lead = await prisma.lead.findUnique({
      where: { id: params.jobId },
      select: {
        id: true,
        orgId: true,
      },
    });

    if (!lead) {
      throw new AppApiError("Job not found.", 404);
    }

    await assertCanMutateLeadJob({
      actor,
      orgId: lead.orgId,
      leadId: lead.id,
    });

    const contentType = req.headers.get("content-type") || "";
    let file: File | null = null;
    let photoId: string | null = null;
    let captionRaw = "";

    if (contentType.includes("application/json")) {
      const payload = (await req.json().catch(() => null)) as
        | {
            photoId?: unknown;
            caption?: unknown;
          }
        | null;
      photoId = typeof payload?.photoId === "string" ? payload.photoId : null;
      captionRaw = typeof payload?.caption === "string" ? payload.caption.trim() : "";
    } else {
      const formData = await req.formData();
      const fileCandidate = formData.get("photo") || formData.get("photoFile");
      if (fileCandidate instanceof File) {
        file = fileCandidate;
      }
      const photoIdCandidate = formData.get("photoId");
      photoId = typeof photoIdCandidate === "string" ? photoIdCandidate : null;
      captionRaw = String(formData.get("caption") || "").trim();
    }

    if (captionRaw.length > 200) {
      throw new AppApiError("Caption must be 200 characters or less.", 400);
    }

    if (photoId) {
      const photo = await prisma.photo.findUnique({
        where: { id: photoId },
        select: { id: true, orgId: true, contentType: true, originalName: true },
      });

      if (!photo) {
        throw new AppApiError("Uploaded photo record not found.", 404);
      }

      if (photo.orgId !== lead.orgId) {
        throw new AppApiError("Forbidden", 403);
      }

      const created = await prisma.leadPhoto.create({
        data: {
          orgId: lead.orgId,
          leadId: lead.id,
          photoId: photo.id,
          createdByUserId: actor.id,
          fileName: photo.originalName || "job-photo",
          mimeType: photo.contentType,
          imageDataUrl: null,
          caption: captionRaw || null,
        },
        select: {
          id: true,
          leadId: true,
          photoId: true,
          fileName: true,
          mimeType: true,
          caption: true,
          createdAt: true,
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      return NextResponse.json({ ok: true, photo: created });
    }

    if (!(file instanceof File) || file.size <= 0 || !file.type.startsWith("image/")) {
      throw new AppApiError("An image file is required.", 400);
    }

    if (file.size > MAX_PHOTO_BYTES) {
      throw new AppApiError("Photo must be 12MB or smaller.", 400);
    }

    const ext = contentTypeToExt[file.type];
    if (!ext) {
      throw new AppApiError("Unsupported image type. Use JPEG, PNG, WebP, or HEIC.", 400);
    }

    const { r2, bucket } = requireR2();
    const key = `${lead.orgId}/${toUtcDatePrefix()}/${randomUUID()}.${ext}`;

    await r2.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: Buffer.from(await file.arrayBuffer()),
        ContentType: file.type,
      }),
    );

    const stored = await prisma.photo.create({
      data: {
        orgId: lead.orgId,
        key,
        contentType: file.type,
        sizeBytes: Math.trunc(file.size),
        originalName: file.name?.slice(0, 255) || null,
      },
      select: { id: true, contentType: true, originalName: true },
    });

    const created = await prisma.leadPhoto.create({
      data: {
        orgId: lead.orgId,
        leadId: lead.id,
        photoId: stored.id,
        createdByUserId: actor.id,
        fileName: stored.originalName || file.name || "job-photo",
        mimeType: stored.contentType,
        imageDataUrl: null,
        caption: captionRaw || null,
      },
      select: {
        id: true,
        leadId: true,
        photoId: true,
        fileName: true,
        mimeType: true,
        caption: true,
        createdAt: true,
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return NextResponse.json({ ok: true, photo: created });
  } catch (error) {
    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to upload photo.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
