import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { loadPrismaEnv } from "./load-prisma-env.mjs";

loadPrismaEnv();

const prismaCliPath = resolve(process.cwd(), "../../node_modules/prisma/build/index.js");
const child = spawn(process.execPath, [prismaCliPath, "migrate", "deploy", "--schema", "prisma/schema.prisma"], {
  stdio: "inherit",
  env: process.env,
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
