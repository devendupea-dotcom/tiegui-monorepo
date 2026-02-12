import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { config } from "dotenv";

config({ path: resolve(process.cwd(), ".env.local"), override: true });

try {
  const prismaCliPath = resolve(process.cwd(), "../../node_modules/prisma/build/index.js");
  const prismaEnv = {
    ...process.env,
    NODE_ENV: "development",
  };
  for (const key of Object.keys(prismaEnv)) {
    if (key.startsWith("npm_") || key.startsWith("NPM_")) {
      delete prismaEnv[key];
    }
  }
  delete prismaEnv.INIT_CWD;
  delete prismaEnv.CI;
  const output = execFileSync(process.execPath, [prismaCliPath, "migrate", "status", "--schema", "prisma/schema.prisma"], {
    encoding: "utf8",
    env: prismaEnv,
  });
  if (output) {
    process.stdout.write(output);
  }
} catch (error) {
  const stdout =
    typeof error === "object" &&
    error !== null &&
    "stdout" in error &&
    typeof error.stdout === "string"
      ? error.stdout
      : "";
  const stderr =
    typeof error === "object" &&
    error !== null &&
    "stderr" in error &&
    typeof error.stderr === "string"
      ? error.stderr
      : "";
  const combined = `${stdout}\n${stderr}`.trim();

  if (combined) {
    process.stderr.write(`${combined}\n`);
  }

  if (
    combined.includes("Schema engine error") ||
    combined.includes("P1001") ||
    combined.includes("P1017")
  ) {
    console.error("Prisma migration status check could not reach the database. Start aborted.");
    process.exit(1);
  }
  console.error("Pending or failed Prisma migrations detected - please run migrations first.");
  process.exit(1);
}
