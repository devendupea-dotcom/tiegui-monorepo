import { loadPrismaEnv } from "./load-prisma-env.mjs";

loadPrismaEnv();

const APPLY = process.env.APPLY === "1";
const ORG_ID = `${process.env.ORG_ID || ""}`.trim() || null;
const LIMIT = Number.parseInt(`${process.env.LIMIT || ""}`.trim(), 10);

const { runCommunicationIntegrityRepair } = await import(
  new URL("../lib/communication-integrity-repair.ts", import.meta.url).href
);

async function main() {
  if (!ORG_ID) {
    throw new Error(
      "ORG_ID is required so communication repairs stay scoped to one workspace.",
    );
  }

  const result = await runCommunicationIntegrityRepair({
    orgId: ORG_ID,
    apply: APPLY,
    rowLimit: Number.isFinite(LIMIT) ? LIMIT : null,
  });

  console.log(
    [
      "[repair-communication-integrity]",
      `mode=${APPLY ? "apply" : "preview"}`,
      `org=${ORG_ID}`,
      `legacyCallCandidates=${result.legacyCalls.candidateRows}`,
      `legacyCallCreated=${result.legacyCalls.createdRows}`,
      `legacyMessageCandidates=${result.legacyMessages.candidateRows}`,
      `legacyMessageCreated=${result.legacyMessages.createdRows}`,
      `partialRepairable=${result.partialLinkage.repairableRows}`,
      `partialRepaired=${result.partialLinkage.repairedRows}`,
      `partialUnrepaired=${result.partialLinkage.unrepairedRows}`,
    ].join(" "),
  );

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("[repair-communication-integrity] failed", error);
  process.exitCode = 1;
});
