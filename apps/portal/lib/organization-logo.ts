import "server-only";

import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getPhotoStorageRecord } from "@/lib/photo-storage";
import { isR2Configured, requireR2 } from "@/lib/r2";
import { upstashRedis } from "@/lib/upstash";

type ResolveOrganizationLogoUrlInput = {
  orgId: string;
  logoPhotoId?: string | null;
  useCache?: boolean;
};

export async function resolveOrganizationLogoUrl(
  input: ResolveOrganizationLogoUrlInput,
): Promise<string | null> {
  if (!input.logoPhotoId) {
    return null;
  }

  const cacheKey = `branding:logo:signed-url:${input.orgId}`;
  if (input.useCache !== false && upstashRedis) {
    const cached = await upstashRedis.get(cacheKey);
    if (typeof cached === "string" && cached.length > 0) {
      return cached;
    }
  }

  const photo = await getPhotoStorageRecord({
    photoId: input.logoPhotoId,
    orgId: input.orgId,
  });

  if (!photo) {
    return null;
  }

  if (photo.imageDataUrl) {
    return photo.imageDataUrl;
  }

  if (!isR2Configured()) {
    return null;
  }

  const { r2, bucket } = requireR2();
  const signedUrl = await getSignedUrl(
    r2,
    new GetObjectCommand({
      Bucket: bucket,
      Key: photo.key,
    }),
    { expiresIn: 60 },
  );

  if (input.useCache !== false && upstashRedis) {
    await upstashRedis.set(cacheKey, signedUrl, { ex: 55 });
  }

  return signedUrl;
}
