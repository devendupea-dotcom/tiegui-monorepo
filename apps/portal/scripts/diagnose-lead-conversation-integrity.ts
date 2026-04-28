import { loadPrismaEnv } from "./load-prisma-env.mjs";

function getArgValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

const envFile = getArgValue("--env-file");
loadPrismaEnv(envFile || undefined);

const { getLeadConversationIntegrityDiagnostics, repairLeadConversationBookedSnapshots } = await import(
  new URL("../lib/lead-conversation-integrity.ts", import.meta.url).href
);

const APPLY = process.argv.includes("--apply");
const LIMIT = Math.max(1, Math.min(5000, Number.parseInt(getArgValue("--limit") || "500", 10) || 500));
const SAMPLE_LIMIT = Math.max(1, Math.min(100, Number.parseInt(getArgValue("--sample-limit") || "25", 10) || 25));
const ORG_ID = getArgValue("--org-id");

function formatIssueSample(sample: {
  kind: string;
  stateId: string;
  leadId: string;
  stage: string;
  bookedCalendarEventId: string | null;
  currentBookedStartAt: Date | null;
  currentBookedEndAt: Date | null;
  eventId?: string | null;
  eventLeadId?: string | null;
  eventType?: string | null;
  latestInboundAt?: Date | null;
  latestOutboundAt?: Date | null;
  missingConversationLinkCount?: number;
  latestMissingConversationLinkAt?: Date | null;
}) {
  return [
    sample.kind,
    `stateId=${sample.stateId}`,
    `leadId=${sample.leadId}`,
    `stage=${sample.stage}`,
    `bookedCalendarEventId=${sample.bookedCalendarEventId || "none"}`,
    `bookedStartAt=${sample.currentBookedStartAt?.toISOString() || "none"}`,
    `bookedEndAt=${sample.currentBookedEndAt?.toISOString() || "none"}`,
    sample.eventId ? `eventId=${sample.eventId}` : null,
    sample.eventLeadId ? `eventLeadId=${sample.eventLeadId}` : null,
    sample.eventType ? `eventType=${sample.eventType}` : null,
    sample.latestInboundAt ? `latestInboundAt=${sample.latestInboundAt.toISOString()}` : null,
    sample.latestOutboundAt ? `latestOutboundAt=${sample.latestOutboundAt.toISOString()}` : null,
    sample.missingConversationLinkCount ? `missingConversationLinks=${sample.missingConversationLinkCount}` : null,
    sample.latestMissingConversationLinkAt
      ? `latestMissingConversationLinkAt=${sample.latestMissingConversationLinkAt.toISOString()}`
      : null,
  ]
    .filter(Boolean)
    .join(" | ");
}

function formatRepairSample(sample: {
  stateId: string;
  leadId: string;
  bookedCalendarEventId: string;
  bookedStartAt: Date;
  bookedEndAt: Date | null;
}) {
  return [
    `stateId=${sample.stateId}`,
    `leadId=${sample.leadId}`,
    `bookedCalendarEventId=${sample.bookedCalendarEventId}`,
    `bookedStartAt=${sample.bookedStartAt.toISOString()}`,
    `bookedEndAt=${sample.bookedEndAt?.toISOString() || "none"}`,
  ].join(" | ");
}

async function main() {
  const diagnostics = await getLeadConversationIntegrityDiagnostics({
    orgId: ORG_ID || null,
    limit: LIMIT,
    sampleLimit: SAMPLE_LIMIT,
  });

  console.log(
    [
      "[diagnose-lead-conversation-integrity]",
      `mode=${APPLY ? "apply" : "dry-run"}`,
      `org=${ORG_ID || "all"}`,
      `scannedStates=${diagnostics.scannedStates}`,
      `repairableSnapshots=${diagnostics.repairableSnapshots}`,
    ].join(" "),
  );

  for (const row of diagnostics.countsByKind) {
    console.log(`[diagnose-lead-conversation-integrity] issue ${row.kind} count=${row.count}`);
  }

  for (const sample of diagnostics.samples) {
    console.log(`[diagnose-lead-conversation-integrity] sample ${formatIssueSample(sample)}`);
  }

  const repair = await repairLeadConversationBookedSnapshots({
    orgId: ORG_ID || null,
    limit: LIMIT,
    sampleLimit: SAMPLE_LIMIT,
    apply: APPLY,
  });

  console.log(
    [
      "[diagnose-lead-conversation-integrity]",
      `repairMode=${APPLY ? "apply" : "preview"}`,
      `repairableSnapshots=${repair.repairableSnapshots}`,
      `repairedSnapshots=${repair.repairedSnapshots}`,
    ].join(" "),
  );

  for (const sample of repair.samples) {
    console.log(`[diagnose-lead-conversation-integrity] repair ${formatRepairSample(sample)}`);
  }
}

await main();
