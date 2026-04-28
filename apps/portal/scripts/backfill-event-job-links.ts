import type { CalendarEventStatus, EventType } from "@prisma/client";
import { loadPrismaEnv } from "./load-prisma-env.mjs";

function getArgValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

const envFile = getArgValue("--env-file");
loadPrismaEnv(envFile || undefined);

const { PrismaClient } = await import("@prisma/client");
const { ensureOperationalJobFromLeadBooking } = await import(new URL("../lib/operational-jobs.ts", import.meta.url).href);

const prisma = new PrismaClient({
  ...(process.env.DATABASE_URL ? { datasources: { db: { url: process.env.DATABASE_URL } } } : {}),
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
});

const APPLY = process.argv.includes("--apply");
const LIMIT = Math.max(1, Math.min(5000, Number.parseInt(getArgValue("--limit") || "500", 10) || 500));
const ORG_ID = getArgValue("--org-id");
const BATCH_SIZE = 100;
const EVENT_BACKFILL_TYPES: EventType[] = ["JOB", "ESTIMATE"];

type EventBackfillRow = {
  id: string;
  orgId: string;
  leadId: string | null;
  jobId: string | null;
  type: EventType;
  status: CalendarEventStatus;
  startAt: Date;
  endAt: Date | null;
  title: string;
  customerName: string | null;
  addressLine: string | null;
  createdByUserId: string | null;
};

const eventBackfillSelect = {
  id: true,
  orgId: true,
  leadId: true,
  jobId: true,
  type: true,
  status: true,
  startAt: true,
  endAt: true,
  title: true,
  customerName: true,
  addressLine: true,
  createdByUserId: true,
} as const;

function baseWhere() {
  return {
    ...(ORG_ID ? { orgId: ORG_ID } : {}),
    jobId: null,
    leadId: { not: null },
    type: { in: EVENT_BACKFILL_TYPES },
  };
}

function formatExample(input: {
  eventId: string;
  leadId: string | null;
  type: string;
  status: string;
  jobId: string | null;
}) {
  return [
    input.eventId,
    `leadId=${input.leadId || "none"}`,
    `type=${input.type}`,
    `status=${input.status}`,
    `jobId=${input.jobId || "none"}`,
  ].join(" | ");
}

async function main() {
  let cursor: string | null = null;
  let scanned = 0;
  let linked = 0;
  const examples: string[] = [];

  while (scanned < LIMIT) {
    const remaining = LIMIT - scanned;
    const rows: EventBackfillRow[] = await prisma.event.findMany({
      where: baseWhere(),
      orderBy: [{ id: "asc" }],
      take: Math.min(BATCH_SIZE, remaining),
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
      select: eventBackfillSelect,
    });

    if (rows.length === 0) {
      break;
    }

    cursor = rows[rows.length - 1]?.id || null;

    for (const row of rows) {
      scanned += 1;
      const result: { jobId: string | null; created: boolean } = await prisma.$transaction((tx) =>
        ensureOperationalJobFromLeadBooking(tx, {
          orgId: row.orgId,
          leadId: row.leadId,
          eventId: row.id,
          type: row.type,
          status: row.status,
          startAt: row.startAt,
          endAt: row.endAt,
          title: row.title,
          customerName: row.customerName,
          addressLine: row.addressLine,
          createdByUserId: row.createdByUserId,
          createIfMissing: false,
          persistEventLink: APPLY,
          persistJobChanges: APPLY,
        }),
      );

      if (examples.length < 25) {
        examples.push(
          formatExample({
            eventId: row.id,
            leadId: row.leadId,
            type: row.type,
            status: row.status,
            jobId: result.jobId,
          }),
        );
      }

      if (result.jobId) {
        linked += 1;
      }
    }
  }

  console.log(
    `[backfill-event-job-links] mode=${APPLY ? "apply" : "dry-run"} org=${ORG_ID || "all"} scanned=${scanned} linked=${linked}`,
  );

  for (const example of examples) {
    console.log(`[backfill-event-job-links] example ${example}`);
  }
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
