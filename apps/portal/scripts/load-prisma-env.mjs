import { resolve } from "node:path";
import { config } from "dotenv";

export function loadPrismaEnv() {
  config({ path: resolve(process.cwd(), ".env") });
  config({ path: resolve(process.cwd(), ".env.local"), override: true });

  if (!process.env.DIRECT_URL && process.env.DATABASE_URL) {
    process.env.DIRECT_URL = process.env.DATABASE_URL;
    console.warn("[prisma-env] DIRECT_URL was not set. Falling back to DATABASE_URL for local Prisma tooling.");
  }
}
