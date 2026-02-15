import "server-only";

import { S3Client } from "@aws-sdk/client-s3";
import { normalizeEnvValue } from "@/lib/env";

const accountId = normalizeEnvValue(process.env.R2_ACCOUNT_ID);
const accessKeyId = normalizeEnvValue(process.env.R2_ACCESS_KEY_ID);
const secretAccessKey = normalizeEnvValue(process.env.R2_SECRET_ACCESS_KEY);
const bucket = normalizeEnvValue(process.env.R2_BUCKET);

// Prefer explicit endpoint; fall back to the Cloudflare account endpoint.
const endpoint =
  normalizeEnvValue(process.env.R2_ENDPOINT) ||
  (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : null);

export const R2_BUCKET = bucket;

export function isR2Configured(): boolean {
  return Boolean(endpoint && accessKeyId && secretAccessKey && bucket);
}

export function requireR2(): { r2: S3Client; bucket: string } {
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      "R2 is not configured. Set R2_ACCOUNT_ID (or R2_ENDPOINT), R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET.",
    );
  }

  const r2 = new S3Client({
    region: "auto",
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  return { r2, bucket };
}

