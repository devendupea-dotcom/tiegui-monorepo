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
const { buildLegacyLeadCleanupPatch } = await import(new URL("../lib/legacy-lead-cleanup.ts", import.meta.url).href);

const prisma = new PrismaClient({
  ...(process.env.DATABASE_URL ? { datasources: { db: { url: process.env.DATABASE_URL } } } : {}),
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
});

const APPLY = process.argv.includes("--apply");
const LIMIT = Math.max(1, Math.min(10000, Number.parseInt(getArgValue("--limit") || "1000", 10) || 1000));
const ORG_ID = getArgValue("--org-id");
const BATCH_SIZE = 200;

type CandidateLead = {
  id: string;
  orgId: string;
  contactName: string | null;
  businessName: string | null;
  phoneE164: string;
  city: string | null;
  businessType: string | null;
  intakeLocationText: string | null;
  intakeWorkTypeText: string | null;
};

function baseWhere() {
  return {
    ...(ORG_ID ? { orgId: ORG_ID } : {}),
    OR: [
      { city: { not: null } },
      { businessType: { not: null } },
      { intakeLocationText: { not: null } },
      { intakeWorkTypeText: { not: null } },
    ],
  };
}

function displayLeadLabel(lead: CandidateLead): string {
  return lead.contactName || lead.businessName || lead.phoneE164;
}

async function main() {
  let cursor: string | null = null;
  let scanned = 0;
  let changed = 0;
  const fieldCounts = new Map<string, number>();
  const examples: string[] = [];

  while (scanned < LIMIT) {
    const rows: CandidateLead[] = await prisma.lead.findMany({
      where: baseWhere(),
      orderBy: { id: "asc" },
      take: Math.min(BATCH_SIZE, LIMIT - scanned),
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
      select: {
        id: true,
        orgId: true,
        contactName: true,
        businessName: true,
        phoneE164: true,
        city: true,
        businessType: true,
        intakeLocationText: true,
        intakeWorkTypeText: true,
      },
    });

    if (rows.length === 0) {
      break;
    }

    cursor = rows[rows.length - 1]?.id || null;

    for (const lead of rows) {
      scanned += 1;
      const patch = buildLegacyLeadCleanupPatch(lead);
      const changedFields = Object.keys(patch);

      if (changedFields.length === 0) {
        continue;
      }

      changed += 1;
      for (const field of changedFields) {
        fieldCounts.set(field, (fieldCounts.get(field) || 0) + 1);
      }

      if (examples.length < 25) {
        examples.push(`${displayLeadLabel(lead)} | ${lead.id} | ${JSON.stringify(patch)}`);
      }

      if (!APPLY) {
        continue;
      }

      await prisma.lead.update({
        where: { id: lead.id },
        data: patch,
      });
    }
  }

  console.log(`[sanitize-legacy-leads] mode=${APPLY ? "apply" : "dry-run"} org=${ORG_ID || "all"} scanned=${scanned}`);
  console.log(`[sanitize-legacy-leads] leadsWithChanges=${changed}`);

  for (const [field, count] of fieldCounts.entries()) {
    console.log(`[sanitize-legacy-leads] field=${field} count=${count}`);
  }

  for (const example of examples) {
    console.log(`[sanitize-legacy-leads] example ${example}`);
  }
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
