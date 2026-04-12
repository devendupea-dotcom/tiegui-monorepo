import { loadPrismaEnv } from "./load-prisma-env.mjs";

function getArgValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

const envFile = getArgValue("--env-file");
loadPrismaEnv(envFile || undefined);

const { getEstimateJobLinkIntegrityDiagnostics, repairConservativeEstimateJobLinks } = await import(
  new URL("../lib/estimate-job-linking.ts", import.meta.url).href
);

const APPLY = process.argv.includes("--apply");
const LIMIT = Math.max(1, Math.min(5000, Number.parseInt(getArgValue("--limit") || "500", 10) || 500));
const SAMPLE_LIMIT = Math.max(1, Math.min(100, Number.parseInt(getArgValue("--sample-limit") || "25", 10) || 25));
const ORG_ID = getArgValue("--org-id");

function formatIssueSample(sample: {
  kind: string;
  jobId: string;
  jobLeadId: string | null;
  sourceEstimateId: string | null;
  linkedEstimateId: string | null;
  estimateId: string;
  estimateLeadId: string | null;
  estimateJobId: string | null;
  estimateRole: string;
}) {
  return [
    sample.kind,
    `jobId=${sample.jobId}`,
    `jobLeadId=${sample.jobLeadId || "none"}`,
    `sourceEstimateId=${sample.sourceEstimateId || "none"}`,
    `linkedEstimateId=${sample.linkedEstimateId || "none"}`,
    `estimateId=${sample.estimateId}`,
    `estimateLeadId=${sample.estimateLeadId || "none"}`,
    `estimateJobId=${sample.estimateJobId || "none"}`,
    `estimateRole=${sample.estimateRole}`,
  ].join(" | ");
}

function formatRepairSample(sample: {
  jobId: string;
  estimateId: string;
  estimateRole: string;
}) {
  return [
    `jobId=${sample.jobId}`,
    `estimateId=${sample.estimateId}`,
    `estimateRole=${sample.estimateRole}`,
  ].join(" | ");
}

async function main() {
  const diagnostics = await getEstimateJobLinkIntegrityDiagnostics({
    orgId: ORG_ID || null,
    limit: LIMIT,
    sampleLimit: SAMPLE_LIMIT,
  });

  console.log(
    [
      "[diagnose-estimate-job-links]",
      `mode=${APPLY ? "apply" : "dry-run"}`,
      `org=${ORG_ID || "all"}`,
      `scannedJobs=${diagnostics.scannedJobs}`,
      `repairableJobs=${diagnostics.repairableJobs}`,
    ].join(" "),
  );

  for (const row of diagnostics.countsByKind) {
    console.log(`[diagnose-estimate-job-links] issue ${row.kind} count=${row.count}`);
  }

  for (const sample of diagnostics.samples) {
    console.log(`[diagnose-estimate-job-links] sample ${formatIssueSample(sample)}`);
  }

  const repair = await repairConservativeEstimateJobLinks({
    orgId: ORG_ID || null,
    limit: LIMIT,
    sampleLimit: SAMPLE_LIMIT,
    apply: APPLY,
  });

  console.log(
    [
      "[diagnose-estimate-job-links]",
      `repairMode=${APPLY ? "apply" : "preview"}`,
      `repairableJobs=${repair.repairableJobs}`,
      `repairedLinks=${repair.repairedLinks}`,
    ].join(" "),
  );

  for (const sample of repair.samples) {
    console.log(`[diagnose-estimate-job-links] repair ${formatRepairSample(sample)}`);
  }
}

await main();
