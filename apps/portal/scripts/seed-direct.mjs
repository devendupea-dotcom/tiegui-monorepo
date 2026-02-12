import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { config } from "dotenv";

config({ path: resolve(process.cwd(), ".env.local") });

const directOrDefaultUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!directOrDefaultUrl) {
  console.error("Missing DIRECT_URL and DATABASE_URL in apps/portal/.env.local");
  process.exit(1);
}

const prismaCliPath = resolve(process.cwd(), "../../node_modules/prisma/build/index.js");

function run(commandArgs, envOverride = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, commandArgs, {
      stdio: "inherit",
      env: {
        ...process.env,
        ...envOverride,
      },
    });

    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(`Command failed with exit code ${code ?? 1}`));
    });
  });
}

try {
  await run([prismaCliPath, "generate", "--schema", "prisma/schema.prisma"]);
  await run([resolve(process.cwd(), "prisma/seed.mjs")], {
    DATABASE_URL: directOrDefaultUrl,
  });
} catch (error) {
  console.error(error);
  process.exit(1);
}
