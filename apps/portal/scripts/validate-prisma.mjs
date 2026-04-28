import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { loadPrismaEnv } from "./load-prisma-env.mjs";

loadPrismaEnv();

const prismaCliPath = resolve(process.cwd(), "../../node_modules/prisma/build/index.js");

try {
  execFileSync(process.execPath, [prismaCliPath, "validate", "--schema", "prisma/schema.prisma"], {
    stdio: "inherit",
    env: process.env,
  });
} catch (error) {
  process.exit(typeof error?.status === "number" ? error.status : 1);
}
