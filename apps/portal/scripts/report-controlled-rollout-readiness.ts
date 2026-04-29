import { loadPrismaEnv } from "./load-prisma-env.mjs";
import type { ControlledRolloutReadinessItem } from "../lib/controlled-rollout-readiness";

function parseArgs(argv: string[]) {
  const orgIdIndex = argv.indexOf("--org-id");
  const envFileIndex = argv.indexOf("--env-file");
  const orgId = orgIdIndex >= 0 ? argv[orgIdIndex + 1] : undefined;
  const envFile = envFileIndex >= 0 ? argv[envFileIndex + 1] : undefined;
  return {
    orgId: orgId && !orgId.startsWith("--") ? orgId : undefined,
    envFile: envFile && !envFile.startsWith("--") ? envFile : undefined,
  };
}

const args = parseArgs(process.argv.slice(2));
if (!args.orgId) {
  console.error(
    "Usage: npm run report:rollout-readiness --workspace=portal -- --org-id <org-id> [--env-file /secure/path.env]",
  );
  process.exit(1);
}

loadPrismaEnv(args.envFile);

const { loadControlledRolloutReadinessReport } = await import(
  new URL("../lib/controlled-rollout-readiness.ts", import.meta.url).href
);
const { prisma } = await import(new URL("../lib/prisma.ts", import.meta.url).href);

try {
  const report = await loadControlledRolloutReadinessReport({
    orgId: args.orgId,
  });

  if (!report) {
    console.error(`Organization not found: ${args.orgId}`);
    process.exitCode = 2;
  } else {
    console.log(
      JSON.stringify(
        {
          generatedAt: report.generatedAt,
          orgId: report.orgId,
          orgName: report.orgName,
          launchState: report.launchState,
          readyForControlledCustomer: report.readyForControlledCustomer,
          blockingCount: report.blockingCount,
          manualCount: report.manualCount,
          summary: report.summary,
          links: report.links,
          checklist: report.items.map((item: ControlledRolloutReadinessItem) => ({
            key: item.key,
            label: item.label,
            status: item.status,
            blocking: item.blocking,
            detail: item.detail,
            action: item.action,
          })),
        },
        null,
        2,
      ),
    );
  }
} finally {
  await prisma.$disconnect();
}
