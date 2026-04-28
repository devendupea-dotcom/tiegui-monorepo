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
  classifyLeadCustomerBackfill,
  pickLeadCustomerBackfillName,
} = await import(new URL("../lib/lead-customer-backfill.ts", import.meta.url).href);

const prisma = new PrismaClient({
  ...(process.env.DATABASE_URL ? { datasources: { db: { url: process.env.DATABASE_URL } } } : {}),
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
});

const APPLY = process.argv.includes("--apply");
const LIMIT = Math.max(1, Math.min(5000, Number.parseInt(getArgValue("--limit") || "500", 10) || 500));
const SAMPLE_LIMIT = Math.max(1, Math.min(50, Number.parseInt(getArgValue("--sample-limit") || "25", 10) || 25));
const ORG_ID = getArgValue("--org-id");

type CandidateLead = {
  id: string;
  orgId: string;
  customerId: string | null;
  phoneE164: string;
  contactName: string | null;
  businessName: string | null;
  createdByUserId: string | null;
  createdAt: Date;
};

type CustomerRow = {
  id: string;
  orgId: string;
  phoneE164: string;
  name: string;
  createdAt: Date;
};

function buildPhoneKey(orgId: string, phoneE164: string) {
  return `${orgId}:${phoneE164}`;
}

function parsePhoneKey(key: string) {
  const separatorIndex = key.indexOf(":");
  return {
    orgId: key.slice(0, separatorIndex),
    phoneE164: key.slice(separatorIndex + 1),
  };
}

function pushMapValue<T>(map: Map<string, T[]>, key: string, value: T) {
  const existing = map.get(key);
  if (existing) {
    existing.push(value);
    return;
  }

  map.set(key, [value]);
}

function uniqueIds(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function formatSample(input: {
  phoneKey: string;
  decision: ReturnType<typeof classifyLeadCustomerBackfill>;
  candidateLeadIds: string[];
  relatedLeadIds: string[];
  exactCustomerIds: string[];
  conflictingCustomerIds: string[];
}) {
  return [
    `phone=${input.phoneKey}`,
    `decision=${input.decision.kind}`,
    `candidateLeads=${input.candidateLeadIds.length}`,
    `relatedLeads=${input.relatedLeadIds.length}`,
    `exactCustomers=${input.exactCustomerIds.join(",") || "none"}`,
    `conflictingCustomers=${input.conflictingCustomerIds.join(",") || "none"}`,
    `leadIds=${input.candidateLeadIds.join(",")}`,
  ].join(" | ");
}

async function main() {
  const candidateLeads: CandidateLead[] = await prisma.lead.findMany({
    where: {
      ...(ORG_ID ? { orgId: ORG_ID } : {}),
      customerId: null,
      communicationEvents: {
        some: {
          contactId: null,
        },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: LIMIT,
    select: {
      id: true,
      orgId: true,
      customerId: true,
      phoneE164: true,
      contactName: true,
      businessName: true,
      createdByUserId: true,
      createdAt: true,
    },
  });

  const candidateLeadIds = candidateLeads.map((lead) => lead.id);
  const phoneKeys = [...new Set(candidateLeads.map((lead) => buildPhoneKey(lead.orgId, lead.phoneE164)))];
  const phoneFilters = phoneKeys.map(parsePhoneKey);

  const [relatedLeads, exactPhoneCustomers, blockedCallers] = await Promise.all([
    phoneFilters.length === 0
      ? Promise.resolve([] as CandidateLead[])
      : prisma.lead.findMany({
          where: {
            OR: phoneFilters,
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            orgId: true,
            customerId: true,
            phoneE164: true,
            contactName: true,
            businessName: true,
            createdByUserId: true,
            createdAt: true,
          },
        }),
    phoneFilters.length === 0
      ? Promise.resolve([] as CustomerRow[])
      : prisma.customer.findMany({
          where: {
            OR: phoneFilters,
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            orgId: true,
            phoneE164: true,
            name: true,
            createdAt: true,
          },
        }),
    phoneFilters.length === 0
      ? Promise.resolve([] as Array<{ orgId: string; phoneE164: string }>)
      : prisma.blockedCaller.findMany({
          where: {
            OR: phoneFilters,
          },
          select: {
            orgId: true,
            phoneE164: true,
          },
        }),
  ]);

  const linkedCustomerIds = uniqueIds(relatedLeads.map((lead) => lead.customerId));
  const linkedCustomers: CustomerRow[] =
    linkedCustomerIds.length === 0
      ? []
      : await prisma.customer.findMany({
          where: {
            id: {
              in: linkedCustomerIds,
            },
          },
          select: {
            id: true,
            orgId: true,
            phoneE164: true,
            name: true,
            createdAt: true,
          },
        });

  const candidateLeadsByKey = new Map<string, CandidateLead[]>();
  for (const lead of candidateLeads) {
    pushMapValue(candidateLeadsByKey, buildPhoneKey(lead.orgId, lead.phoneE164), lead);
  }

  const relatedLeadsByKey = new Map<string, CandidateLead[]>();
  for (const lead of relatedLeads) {
    pushMapValue(relatedLeadsByKey, buildPhoneKey(lead.orgId, lead.phoneE164), lead);
  }

  const exactCustomersByKey = new Map<string, CustomerRow[]>();
  for (const customer of exactPhoneCustomers) {
    pushMapValue(exactCustomersByKey, buildPhoneKey(customer.orgId, customer.phoneE164), customer);
  }

  const linkedCustomerById = new Map(linkedCustomers.map((customer) => [customer.id, customer]));
  const blockedPhoneKeys = new Set(blockedCallers.map((entry) => buildPhoneKey(entry.orgId, entry.phoneE164)));

  let createdCustomers = 0;
  let linkedLeads = 0;
  const stats = new Map<string, number>();
  const samples: string[] = [];

  for (const phoneKey of phoneKeys) {
    const groupCandidateLeads = candidateLeadsByKey.get(phoneKey) || [];
    const groupRelatedLeads = relatedLeadsByKey.get(phoneKey) || groupCandidateLeads;
    const groupExactCustomers = exactCustomersByKey.get(phoneKey) || [];
    const exactCustomerIds = uniqueIds(groupExactCustomers.map((customer) => customer.id));
    const conflictingCustomerIds = uniqueIds(
      groupRelatedLeads.flatMap((lead) => {
        if (!lead.customerId) {
          return [];
        }

        const linkedCustomer = linkedCustomerById.get(lead.customerId);
        if (!linkedCustomer) {
          return [lead.customerId];
        }

        return linkedCustomer.orgId === lead.orgId && linkedCustomer.phoneE164 === lead.phoneE164 ? [] : [linkedCustomer.id];
      }),
    );
    const exactLinkedCustomerIds = uniqueIds(
      groupRelatedLeads.flatMap((lead) => {
        if (!lead.customerId) {
          return [];
        }

        const linkedCustomer = linkedCustomerById.get(lead.customerId);
        return linkedCustomer && linkedCustomer.orgId === lead.orgId && linkedCustomer.phoneE164 === lead.phoneE164
          ? [linkedCustomer.id]
          : [];
      }),
    );

    const decision = classifyLeadCustomerBackfill({
      phoneE164: groupCandidateLeads[0]?.phoneE164 || groupRelatedLeads[0]?.phoneE164 || null,
      blockedPhone: blockedPhoneKeys.has(phoneKey),
      exactCustomerIds: [...exactCustomerIds, ...exactLinkedCustomerIds],
      conflictingCustomerIds,
    });

    stats.set(decision.kind, (stats.get(decision.kind) || 0) + 1);

    if (samples.length < SAMPLE_LIMIT) {
      samples.push(
        formatSample({
          phoneKey,
          decision,
          candidateLeadIds: groupCandidateLeads.map((lead) => lead.id),
          relatedLeadIds: groupRelatedLeads.map((lead) => lead.id),
          exactCustomerIds: uniqueIds([...exactCustomerIds, ...exactLinkedCustomerIds]),
          conflictingCustomerIds,
        }),
      );
    }

    if (!APPLY || !decision.canApply) {
      continue;
    }

    const missingLeadIds = groupRelatedLeads.filter((lead) => !lead.customerId).map((lead) => lead.id);
    if (missingLeadIds.length === 0) {
      continue;
    }

    await prisma.$transaction(async (tx) => {
      let customerId = decision.kind === "attach_existing_customer" ? decision.customerId : null;

      if (decision.kind === "create_customer") {
        const created = await tx.customer.create({
          data: {
            orgId: groupRelatedLeads[0]!.orgId,
            createdByUserId:
              groupRelatedLeads.find((lead) => lead.createdByUserId)?.createdByUserId || null,
            name: pickLeadCustomerBackfillName({
              phoneE164: groupRelatedLeads[0]!.phoneE164,
              leads: groupRelatedLeads.map((lead) => ({
                id: lead.id,
                contactName: lead.contactName,
                businessName: lead.businessName,
                createdAt: lead.createdAt,
              })),
            }),
            phoneE164: groupRelatedLeads[0]!.phoneE164,
          },
          select: {
            id: true,
          },
        });

        customerId = created.id;
        createdCustomers += 1;
      }

      const result = await tx.lead.updateMany({
        where: {
          id: {
            in: missingLeadIds,
          },
          customerId: null,
        },
        data: {
          customerId,
        },
      });

      linkedLeads += result.count;
    });
  }

  console.log(
    [
      "[backfill-lead-customers]",
      `mode=${APPLY ? "apply" : "dry-run"}`,
      `org=${ORG_ID || "all"}`,
      `candidateLeads=${candidateLeadIds.length}`,
      `phoneGroups=${phoneKeys.length}`,
      `createdCustomers=${createdCustomers}`,
      `linkedLeads=${linkedLeads}`,
    ].join(" "),
  );

  for (const [kind, count] of stats.entries()) {
    console.log(`[backfill-lead-customers] ${kind} count=${count}`);
  }

  for (const sample of samples) {
    console.log(`[backfill-lead-customers] sample ${sample}`);
  }
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
