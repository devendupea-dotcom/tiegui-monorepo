import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { normalizeEnvValue } from "@/lib/env";

const TOKEN_VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

function getTwilioTokenEncryptionKey(): Buffer {
  const raw = normalizeEnvValue(process.env.TWILIO_TOKEN_ENCRYPTION_KEY);
  if (!raw) {
    throw new Error("TWILIO_TOKEN_ENCRYPTION_KEY is required (base64-encoded 32-byte key).");
  }

  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new Error("TWILIO_TOKEN_ENCRYPTION_KEY must be valid base64.");
  }

  if (key.length !== 32) {
    throw new Error("TWILIO_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  }

  return key;
}

export function encryptTwilioAuthToken(value: string): string {
  const key = getTwilioTokenEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${TOKEN_VERSION}.${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptTwilioAuthToken(payload: string): string {
  const [version, ivBase64, tagBase64, dataBase64] = payload.split(".");
  if (version !== TOKEN_VERSION || !ivBase64 || !tagBase64 || !dataBase64) {
    throw new Error("Invalid Twilio token payload format.");
  }

  const key = getTwilioTokenEncryptionKey();
  const iv = Buffer.from(ivBase64, "base64");
  const tag = Buffer.from(tagBase64, "base64");
  const data = Buffer.from(dataBase64, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function maskSecretTail(value: string | null | undefined, visible = 4): string {
  const normalized = (value || "").trim();
  if (!normalized) return "";
  const suffix = normalized.slice(-Math.max(1, visible));
  return `${"•".repeat(Math.max(0, normalized.length - suffix.length))}${suffix}`;
}

export function maskSid(value: string | null | undefined): string {
  const normalized = (value || "").trim();
  if (!normalized) return "(missing)";
  if (normalized.length <= 8) return "****";
  return `${normalized.slice(0, 4)}…${normalized.slice(-4)}`;
}
