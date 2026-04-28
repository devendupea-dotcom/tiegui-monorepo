import { loadPrismaEnv } from "./load-prisma-env.mjs";

function getArgValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

const envFile = getArgValue("--env-file");
loadPrismaEnv(envFile || undefined);

const { getOperationalIntegrityDiagnostics, repairConservativeJobLeadLinks } = await import(
  new URL("../lib/operational-integrity.ts", import.meta.url).href
);

const APPLY = process.argv.includes("--apply");
const LIMIT = Math.max(1, Math.min(5000, Number.parseInt(getArgValue("--limit") || "500", 10) || 500));
const SAMPLE_LIMIT = Math.max(1, Math.min(100, Number.parseInt(getArgValue("--sample-limit") || "25", 10) || 25));
const ORG_ID = getArgValue("--org-id");

function getMissingSchemaMessage(error: unknown): string | null {
  if (
    typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "P2022"
    && "meta" in error
    && typeof error.meta === "object"
    && error.meta !== null
    && "column" in error.meta
    && error.meta.column === "Event.jobId"
  ) {
    return "Operational integrity diagnostics require the latest Event.jobId migration. Apply database migrations before running this command.";
  }

  return null;
}

function formatIssueSample(sample: {
  kind: string;
  jobId: string;
  currentLeadId: string | null;
  inferredLeadIds: string[];
  candidateSources: string[];
  sourceEstimateId: string | null;
  linkedEstimateId: string | null;
  estimateId?: string | null;
  eventId?: string | null;
}) {
  return [
    sample.kind,
    `jobId=${sample.jobId}`,
    `currentLeadId=${sample.currentLeadId || "none"}`,
    `inferredLeadIds=${sample.inferredLeadIds.join(",") || "none"}`,
    `candidateSources=${sample.candidateSources.join(",") || "none"}`,
    `sourceEstimateId=${sample.sourceEstimateId || "none"}`,
    `linkedEstimateId=${sample.linkedEstimateId || "none"}`,
    sample.estimateId ? `estimateId=${sample.estimateId}` : null,
    sample.eventId ? `eventId=${sample.eventId}` : null,
  ]
    .filter(Boolean)
    .join(" | ");
}

function formatRepairSample(sample: {
  jobId: string;
  leadId: string;
  candidateSources: string[];
}) {
  return [
    `jobId=${sample.jobId}`,
    `leadId=${sample.leadId}`,
    `candidateSources=${sample.candidateSources.join(",") || "none"}`,
  ].join(" | ");
}

async function main() {
  const diagnostics = await getOperationalIntegrityDiagnostics({
    orgId: ORG_ID || null,
    limit: LIMIT,
    sampleLimit: SAMPLE_LIMIT,
  });

  console.log(
    [
      "[diagnose-operational-integrity]",
      `mode=${APPLY ? "apply" : "dry-run"}`,
      `org=${ORG_ID || "all"}`,
      `scannedJobs=${diagnostics.scannedJobs}`,
      `repairableJobs=${diagnostics.repairableJobs}`,
    ].join(" "),
  );

  for (const row of diagnostics.countsByKind) {
    console.log(`[diagnose-operational-integrity] issue ${row.kind} count=${row.count}`);
  }

  for (const sample of diagnostics.samples) {
    console.log(`[diagnose-operational-integrity] sample ${formatIssueSample(sample)}`);
  }

  const repair = await repairConservativeJobLeadLinks({
    orgId: ORG_ID || null,
    limit: LIMIT,
    sampleLimit: SAMPLE_LIMIT,
    apply: APPLY,
  });

  console.log(
    [
      "[diagnose-operational-integrity]",
      `repairMode=${APPLY ? "apply" : "preview"}`,
      `repairableJobs=${repair.repairableJobs}`,
      `repairedJobs=${repair.repairedJobs}`,
    ].join(" "),
  );

  for (const sample of repair.samples) {
    console.log(`[diagnose-operational-integrity] repair ${formatRepairSample(sample)}`);
  }
}

try {
  await main();
} catch (error) {
  const schemaMessage = getMissingSchemaMessage(error);
  if (schemaMessage) {
    console.error(`[diagnose-operational-integrity] ${schemaMessage}`);
    process.exit(1);
  }
  throw error;
}
