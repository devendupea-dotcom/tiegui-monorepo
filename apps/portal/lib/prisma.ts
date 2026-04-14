import { PrismaClient } from "@prisma/client";
import { normalizeEnvValue } from "./env";

declare global {
  var prisma: PrismaClient | undefined;
}

const databaseUrl = normalizeEnvValue(process.env.DATABASE_URL);

export const prisma =
  global.prisma ||
  new PrismaClient({
    ...(databaseUrl ? { datasources: { db: { url: databaseUrl } } } : {}),
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") global.prisma = prisma;
