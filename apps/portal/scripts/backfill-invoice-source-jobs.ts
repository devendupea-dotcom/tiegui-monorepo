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
const {
  ensureInvoiceSourceJobLink,
  resolveInvoiceSourceJobLink,
} = await import(new URL("../lib/invoices.ts", import.meta.url).href);

const prisma = new PrismaClient({
  ...(process.env.DATABASE_URL ? { datasources: { db: { url: process.env.DATABASE_URL } } } : {}),
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
});

const APPLY = process.argv.includes("--apply");
const LIMIT = Math.max(1, Math.min(5000, Number.parseInt(getArgValue("--limit") || "500", 10) || 500));
const ORG_ID = getArgValue("--org-id");
const BATCH_SIZE = 100;

type InvoiceBackfillRow = {
  id: string;
  orgId: string;
  legacyLeadId: string | null;
  sourceEstimateId: string | null;
  sourceJobId: string | null;
  customerId: string;
  invoiceNumber: string;
};

const invoiceBackfillSelect = {
  id: true,
  orgId: true,
  legacyLeadId: true,
  sourceEstimateId: true,
  sourceJobId: true,
  customerId: true,
  invoiceNumber: true,
} as const;

function baseWhere() {
  return {
    ...(ORG_ID ? { orgId: ORG_ID } : {}),
    sourceJobId: null,
  };
}

function formatExample(input: {
  invoiceNumber: string;
  invoiceId: string;
  matchedBy: string | null;
  reason: string;
  sourceJobId: string | null;
}) {
  return [
    input.invoiceNumber,
    input.invoiceId,
    `matchedBy=${input.matchedBy || "none"}`,
    `reason=${input.reason}`,
    `sourceJobId=${input.sourceJobId || "none"}`,
  ].join(" | ");
}

async function main() {
  let cursor: string | null = null;
  let scanned = 0;
  let updated = 0;
  const stats = new Map<string, number>();
  const examples: string[] = [];

  while (scanned < LIMIT) {
    const remaining = LIMIT - scanned;
    const rows: InvoiceBackfillRow[] = await prisma.invoice.findMany({
      where: baseWhere(),
      orderBy: [{ id: "asc" }],
      take: Math.min(BATCH_SIZE, remaining),
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
      select: invoiceBackfillSelect,
    });

    if (rows.length === 0) {
      break;
    }

    cursor = rows[rows.length - 1]?.id || null;

    for (const row of rows) {
      scanned += 1;
      const resolution = await resolveInvoiceSourceJobLink(prisma, row);
      stats.set(resolution.reason, (stats.get(resolution.reason) || 0) + 1);

      if (examples.length < 25) {
        examples.push(
          formatExample({
            invoiceNumber: row.invoiceNumber,
            invoiceId: row.id,
            matchedBy: resolution.matchedBy,
            reason: resolution.reason,
            sourceJobId: resolution.sourceJobId,
          }),
        );
      }

      if (!APPLY || !resolution.sourceJobId) {
        continue;
      }

      const result = await ensureInvoiceSourceJobLink(prisma, row);
      if (result.updated) {
        updated += 1;
      }
    }
  }

  console.log(
    `[backfill-invoice-source-jobs] mode=${APPLY ? "apply" : "dry-run"} org=${ORG_ID || "all"} scanned=${scanned} updated=${updated}`,
  );

  for (const [reason, count] of stats.entries()) {
    console.log(`[backfill-invoice-source-jobs] ${reason} count=${count}`);
  }

  for (const example of examples) {
    console.log(`[backfill-invoice-source-jobs] example ${example}`);
  }
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
