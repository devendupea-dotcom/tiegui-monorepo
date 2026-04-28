import "server-only";

import { randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppApiError } from "@/lib/app-api-permissions";
import { fileToDataUrl } from "@/lib/inline-images";
import { isR2Configured, requireR2 } from "@/lib/r2";

const MAX_PHOTO_BYTES = 12 * 1024 * 1024;

const contentTypeToExt: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

export const leadPhotoSelect = {
  id: true,
  photoId: true,
  fileName: true,
  mimeType: true,
  imageDataUrl: true,
  caption: true,
  createdAt: true,
  photo: {
    select: {
      key: true,
    },
  },
  createdBy: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
} satisfies Prisma.LeadPhotoSelect;

export type LeadPhotoRecord = Prisma.LeadPhotoGetPayload<{
  select: typeof leadPhotoSelect;
}>;

export type ResolvedLeadPhotoRecord = LeadPhotoRecord & {
  resolvedUrl: string | null;
};

function toUtcDatePrefix(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export async function createLeadPhoto(input: {
  req: Request;
  orgId: string;
  leadId: string;
  actorId: string;
  fallbackFileName?: string;
}): Promise<LeadPhotoRecord> {
  const fallbackFileName = input.fallbackFileName || "job-photo";
  const contentType = input.req.headers.get("content-type") || "";
  let file: File | null = null;
  let photoId: string | null = null;
  let captionRaw = "";

  if (contentType.includes("application/json")) {
    const payload = (await input.req.json().catch(() => null)) as
      | {
          photoId?: unknown;
          caption?: unknown;
        }
      | null;
    photoId = typeof payload?.photoId === "string" ? payload.photoId : null;
    captionRaw = typeof payload?.caption === "string" ? payload.caption.trim() : "";
  } else {
    const formData = await input.req.formData();
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

    if (photo.orgId !== input.orgId) {
      throw new AppApiError("Forbidden", 403);
    }

    return prisma.leadPhoto.create({
      data: {
        orgId: input.orgId,
        leadId: input.leadId,
        photoId: photo.id,
        createdByUserId: input.actorId,
        fileName: photo.originalName || fallbackFileName,
        mimeType: photo.contentType,
        imageDataUrl: null,
        caption: captionRaw || null,
      },
      select: leadPhotoSelect,
    });
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

  if (!isR2Configured()) {
    return prisma.leadPhoto.create({
      data: {
        orgId: input.orgId,
        leadId: input.leadId,
        photoId: null,
        createdByUserId: input.actorId,
        fileName: file.name?.slice(0, 255) || fallbackFileName,
        mimeType: file.type,
        imageDataUrl: await fileToDataUrl(file),
        caption: captionRaw || null,
      },
      select: leadPhotoSelect,
    });
  }

  const { r2, bucket } = requireR2();
  const key = `${input.orgId}/${toUtcDatePrefix()}/${randomUUID()}.${ext}`;

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
      orgId: input.orgId,
      key,
      contentType: file.type,
      sizeBytes: Math.trunc(file.size),
      originalName: file.name?.slice(0, 255) || null,
    },
    select: { id: true, contentType: true, originalName: true },
  });

  return prisma.leadPhoto.create({
    data: {
      orgId: input.orgId,
      leadId: input.leadId,
      photoId: stored.id,
      createdByUserId: input.actorId,
      fileName: stored.originalName || file.name || fallbackFileName,
      mimeType: stored.contentType,
      imageDataUrl: null,
      caption: captionRaw || null,
    },
    select: leadPhotoSelect,
  });
}

export async function resolveLeadPhotoUrls(photos: LeadPhotoRecord[]): Promise<ResolvedLeadPhotoRecord[]> {
  if (photos.length === 0) return [];

  if (!isR2Configured()) {
    return photos.map((photo) => ({
      ...photo,
      resolvedUrl: photo.imageDataUrl,
    }));
  }

  const { r2, bucket } = requireR2();

  return Promise.all(
    photos.map(async (photo) => {
      if (photo.imageDataUrl) {
        return { ...photo, resolvedUrl: photo.imageDataUrl };
      }

      if (!photo.photo?.key) {
        return { ...photo, resolvedUrl: null };
      }

      try {
        const url = await getSignedUrl(
          r2,
          new GetObjectCommand({
            Bucket: bucket,
            Key: photo.photo.key,
          }),
          { expiresIn: 60 },
        );

        return { ...photo, resolvedUrl: url };
      } catch {
        return { ...photo, resolvedUrl: null };
      }
    }),
  );
}
