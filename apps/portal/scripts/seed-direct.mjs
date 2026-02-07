import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { config } from "dotenv";

config({ path: resolve(process.cwd(), ".env.local") });

const directOrDefaultUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!directOrDefaultUrl) {
  console.error("Missing DIRECT_URL and DATABASE_URL in apps/portal/.env.local");
  process.exit(1);
}

const child = spawn(process.execPath, [resolve(process.cwd(), "prisma/seed.mjs")], {
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: directOrDefaultUrl,
  },
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
