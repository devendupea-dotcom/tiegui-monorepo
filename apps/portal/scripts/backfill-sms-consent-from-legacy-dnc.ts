import { loadPrismaEnv } from "./load-prisma-env.mjs";

function parseArgs(argv: string[]) {
  const envFileIndex = argv.indexOf("--env-file");
  const envFile = envFileIndex >= 0 ? argv[envFileIndex + 1] : undefined;
  return {
    dryRun: argv.includes("--dry-run"),
    envFile: envFile && !envFile.startsWith("--") ? envFile : undefined,
  };
}

const args = parseArgs(process.argv.slice(2));
loadPrismaEnv(args.envFile);

const { backfillSmsConsentFromLegacyDnc } = await import(
  new URL("../lib/sms-consent.ts", import.meta.url).href
);
const { prisma } = await import(new URL("../lib/prisma.ts", import.meta.url).href);

try {
  const result = await backfillSmsConsentFromLegacyDnc({
    dryRun: args.dryRun,
  });

  console.log(
    JSON.stringify(
      {
        dryRun: args.dryRun,
        scanned: result.scanned,
        candidates: result.candidates,
        created: result.created,
        updated: result.updated,
        skippedExplicitOptIn: result.skippedExplicitOptIn,
      },
      null,
      2,
    ),
  );
} finally {
  await prisma.$disconnect();
}
