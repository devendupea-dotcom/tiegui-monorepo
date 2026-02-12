import { normalizeEnvValue } from "./env";

export type PhotoStorageReadiness = {
  provider: string;
  productionReady: boolean;
  blockingReason: string | null;
  details: string;
};

export function getPhotoStorageReadiness(): PhotoStorageReadiness {
  const provider = (normalizeEnvValue(process.env.PHOTO_STORAGE_PROVIDER) || "local").toLowerCase();

  if (provider !== "s3" && provider !== "r2") {
    return {
      provider,
      productionReady: false,
      blockingReason: "Photo storage is local/inline. Pilot go-live is blocked until S3 or R2 is configured.",
      details: "Set PHOTO_STORAGE_PROVIDER=s3 or r2 and configure signed upload/read URL credentials.",
    };
  }

  if (provider === "s3") {
    const bucket = normalizeEnvValue(process.env.AWS_S3_BUCKET);
    const region = normalizeEnvValue(process.env.AWS_REGION);
    const key = normalizeEnvValue(process.env.AWS_ACCESS_KEY_ID);
    const secret = normalizeEnvValue(process.env.AWS_SECRET_ACCESS_KEY);
    const ready = Boolean(bucket && region && key && secret);
    return {
      provider,
      productionReady: ready,
      blockingReason: ready ? null : "S3 selected but required AWS env vars are missing.",
      details: ready
        ? `S3 bucket ${bucket} configured for signed URL mode.`
        : "Missing one or more: AWS_S3_BUCKET, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.",
    };
  }

  const bucket = normalizeEnvValue(process.env.R2_BUCKET);
  const endpoint = normalizeEnvValue(process.env.R2_ENDPOINT);
  const key = normalizeEnvValue(process.env.R2_ACCESS_KEY_ID);
  const secret = normalizeEnvValue(process.env.R2_SECRET_ACCESS_KEY);
  const ready = Boolean(bucket && endpoint && key && secret);
  return {
    provider,
    productionReady: ready,
    blockingReason: ready ? null : "R2 selected but required R2 env vars are missing.",
    details: ready
      ? `R2 bucket ${bucket} configured for signed URL mode.`
      : "Missing one or more: R2_BUCKET, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.",
  };
}
