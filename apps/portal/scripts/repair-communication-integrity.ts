import { loadPrismaEnv } from "./load-prisma-env.mjs";

loadPrismaEnv();

function getArgValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

const APPLY = process.env.APPLY === "1";
const ORG_ID =
  getArgValue("--org-id") || `${process.env.ORG_ID || ""}`.trim() || null;
const LIMIT = Number.parseInt(
  getArgValue("--limit") || `${process.env.LIMIT || ""}`.trim(),
  10,
);

const { runCommunicationIntegrityRepair } = await import(
  new URL("../lib/communication-integrity-repair.ts", import.meta.url).href
);
const { prisma } = await import(new URL("../lib/prisma.ts", import.meta.url).href);

async function getScopedOrgIds() {
  if (ORG_ID) {
    return [ORG_ID];
  }

  if (APPLY) {
    throw new Error(
      "ORG_ID or --org-id is required when APPLY=1 so communication repairs stay scoped to one workspace.",
    );
  }

  const organizations = await prisma.organization.findMany({
    select: {
      id: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  return organizations.map((organization: { id: string }) => organization.id);
}

async function main() {
  const orgIds = await getScopedOrgIds();
  if (orgIds.length === 0) {
    console.log("[repair-communication-integrity] no organizations found");
    return;
  }

  const results = [];
  for (const orgId of orgIds) {
    const result = await runCommunicationIntegrityRepair({
      orgId,
      apply: APPLY,
      rowLimit: Number.isFinite(LIMIT) ? LIMIT : null,
    });
    results.push(result);

    console.log(
      [
        "[repair-communication-integrity]",
        `mode=${APPLY ? "apply" : "preview"}`,
        `org=${orgId}`,
        `legacyCallCandidates=${result.legacyCalls.candidateRows}`,
        `legacyCallCreated=${result.legacyCalls.createdRows}`,
        `legacyMessageCandidates=${result.legacyMessages.candidateRows}`,
        `legacyMessageCreated=${result.legacyMessages.createdRows}`,
        `partialRepairable=${result.partialLinkage.repairableRows}`,
        `partialRepaired=${result.partialLinkage.repairedRows}`,
        `partialUnrepaired=${result.partialLinkage.unrepairedRows}`,
      ].join(" "),
    );
  }

  console.log(JSON.stringify(ORG_ID ? results[0] : results, null, 2));
}

main().catch((error) => {
  console.error("[repair-communication-integrity] failed", error);
  process.exitCode = 1;
});
