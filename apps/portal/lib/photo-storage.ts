import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type CreatePhotoRecordInput = {
  orgId: string;
  key: string;
  contentType: string;
  sizeBytes: number;
  originalName?: string | null;
  imageDataUrl?: string | null;
};

export type PhotoStorageRecord = {
  id: string;
  orgId: string;
  key: string;
  imageDataUrl: string | null;
};

let photoImageDataUrlColumnPromise: Promise<boolean> | null = null;

export async function hasPhotoImageDataUrlColumn(): Promise<boolean> {
  if (!photoImageDataUrlColumnPromise) {
    photoImageDataUrlColumnPromise = prisma
      .$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'Photo'
            AND column_name = 'imageDataUrl'
        ) AS "exists"
      `
      .then((rows) => rows[0]?.exists === true)
      .catch(() => false);
  }

  return photoImageDataUrlColumnPromise;
}

export async function createPhotoRecord(input: CreatePhotoRecordInput): Promise<{ id: string; key: string }> {
  const normalizedName = input.originalName?.slice(0, 255) || null;
  const sizeBytes = Math.trunc(input.sizeBytes);

  if (!input.imageDataUrl) {
    return prisma.photo.create({
      data: {
        orgId: input.orgId,
        key: input.key,
        contentType: input.contentType,
        sizeBytes,
        originalName: normalizedName,
      },
      select: { id: true, key: true },
    });
  }

  if (!(await hasPhotoImageDataUrlColumn())) {
    throw new Error(
      "Inline photo storage is unavailable because the Photo.imageDataUrl column is missing. Run the latest migration and restart the portal.",
    );
  }

  const id = randomUUID();
  const rows = await prisma.$queryRaw<Array<{ id: string; key: string }>>`
    INSERT INTO "Photo" (
      "id",
      "orgId",
      "key",
      "contentType",
      "sizeBytes",
      "originalName",
      "imageDataUrl",
      "createdAt"
    )
    VALUES (
      ${id},
      ${input.orgId},
      ${input.key},
      ${input.contentType},
      ${sizeBytes},
      ${normalizedName},
      ${input.imageDataUrl},
      NOW()
    )
    RETURNING "id", "key"
  `;

  const created = rows[0];
  if (!created) {
    throw new Error("Failed to create inline photo record.");
  }

  return created;
}

export async function getPhotoStorageRecord(input: {
  photoId: string;
  orgId?: string | null;
}): Promise<PhotoStorageRecord | null> {
  const orgFilter = input.orgId ? Prisma.sql` AND "orgId" = ${input.orgId}` : Prisma.empty;

  if (await hasPhotoImageDataUrlColumn()) {
    const rows = await prisma.$queryRaw<Array<PhotoStorageRecord>>`
      SELECT
        "id",
        "orgId",
        "key",
        "imageDataUrl"::text AS "imageDataUrl"
      FROM "Photo"
      WHERE "id" = ${input.photoId}
      ${orgFilter}
      LIMIT 1
    `;

    return rows[0] ?? null;
  }

  const rows = await prisma.$queryRaw<Array<Omit<PhotoStorageRecord, "imageDataUrl">>>`
    SELECT
      "id",
      "orgId",
      "key"
    FROM "Photo"
    WHERE "id" = ${input.photoId}
    ${orgFilter}
    LIMIT 1
  `;

  const row = rows[0];
  return row ? { ...row, imageDataUrl: null } : null;
}
