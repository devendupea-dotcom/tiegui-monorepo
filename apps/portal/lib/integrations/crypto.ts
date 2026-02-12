import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { normalizeEnvValue } from "@/lib/env";

const TOKEN_VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

function getEncryptionKey(): Buffer {
  const secret =
    normalizeEnvValue(process.env.INTEGRATIONS_ENCRYPTION_KEY) ||
    normalizeEnvValue(process.env.NEXTAUTH_SECRET);

  if (!secret) {
    throw new Error(
      "INTEGRATIONS_ENCRYPTION_KEY (or NEXTAUTH_SECRET fallback) is required for integration token encryption.",
    );
  }

  return createHash("sha256").update(secret, "utf8").digest();
}

export function encryptIntegrationToken(value: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${TOKEN_VERSION}.${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptIntegrationToken(payload: string): string {
  const [version, ivBase64, tagBase64, dataBase64] = payload.split(".");
  if (version !== TOKEN_VERSION || !ivBase64 || !tagBase64 || !dataBase64) {
    throw new Error("Invalid token payload format.");
  }

  const key = getEncryptionKey();
  const iv = Buffer.from(ivBase64, "base64");
  const tag = Buffer.from(tagBase64, "base64");
  const data = Buffer.from(dataBase64, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}
