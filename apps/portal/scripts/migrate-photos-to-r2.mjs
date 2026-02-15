import { config } from "dotenv";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

config({ path: resolve(process.cwd(), ".env.local") });

function normalize(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

function requiredEnv(name) {
  const value = normalize(process.env[name]);
  if (!value) {
    console.error(`Missing ${name} in apps/portal/.env.local`);
    process.exit(1);
  }
  return value;
}

const r2AccountId = normalize(process.env.R2_ACCOUNT_ID);
const r2Endpoint =
  normalize(process.env.R2_ENDPOINT) ||
  (r2AccountId ? `https://${r2AccountId}.r2.cloudflarestorage.com` : null);

const r2 = new S3Client({
  region: "auto",
  endpoint: r2Endpoint || undefined,
  credentials: {
    accessKeyId: requiredEnv("R2_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnv("R2_SECRET_ACCESS_KEY"),
  },
});

const bucket = requiredEnv("R2_BUCKET");

const contentTypeToExt = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/svg+xml": "svg",
};

function toUtcDatePrefix(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return {
    contentType: match[1],
    base64: match[2],
  };
}

const prisma = new PrismaClient();

const BATCH_SIZE = Math.max(1, Math.min(200, Number(process.env.MIGRATE_PHOTOS_BATCH || 100)));

let migrated = 0;
let failed = 0;
let cursor = null;

console.log(`Starting LeadPhoto -> R2 migration (batch=${BATCH_SIZE}).`);

try {
  while (true) {
    const rows = await prisma.leadPhoto.findMany({
      where: {
        photoId: null,
        imageDataUrl: { not: null },
      },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: BATCH_SIZE,
      orderBy: { id: "asc" },
      select: {
        id: true,
        orgId: true,
        fileName: true,
        mimeType: true,
        imageDataUrl: true,
        createdAt: true,
      },
    });

    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      cursor = row.id;

      try {
        const parsed = parseDataUrl(row.imageDataUrl);
        if (!parsed) {
          failed += 1;
          console.warn(`[skip] ${row.id} unsupported data URL format`);
          continue;
        }

        const contentType = parsed.contentType || row.mimeType || "application/octet-stream";
        const ext = contentTypeToExt[contentType] || "bin";
        const bytes = Buffer.from(parsed.base64, "base64");
        const key = `${row.orgId}/${toUtcDatePrefix(row.createdAt)}/${randomUUID()}.${ext}`;

        await r2.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: bytes,
            ContentType: contentType,
          }),
        );

        const photo = await prisma.photo.create({
          data: {
            orgId: row.orgId,
            key,
            contentType,
            sizeBytes: bytes.byteLength,
            originalName: (row.fileName || "").slice(0, 255) || null,
          },
          select: { id: true },
        });

        await prisma.leadPhoto.update({
          where: { id: row.id },
          data: {
            photoId: photo.id,
            imageDataUrl: null,
            mimeType: contentType,
          },
        });

        migrated += 1;
        if (migrated % 25 === 0) {
          console.log(`Migrated ${migrated} photos...`);
        }
      } catch (error) {
        failed += 1;
        console.error(`[fail] ${row.id}`, error);
      }
    }
  }
} finally {
  await prisma.$disconnect().catch(() => null);
}

console.log(`Done. migrated=${migrated} failed=${failed}`);

