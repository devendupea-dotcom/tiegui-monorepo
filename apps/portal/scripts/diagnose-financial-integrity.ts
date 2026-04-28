import { Prisma } from "@prisma/client";
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

const prisma = new PrismaClient({
  ...(process.env.DATABASE_URL
    ? { datasources: { db: { url: process.env.DATABASE_URL } } }
    : {}),
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
});

const ORG_ID = getArgValue("--org-id");
const SAMPLE_LIMIT = Math.max(
  1,
  Math.min(100, Number.parseInt(getArgValue("--sample-limit") || "10", 10) || 10),
);

type CountRow = {
  count: string | number | bigint;
};

type Issue = {
  key: string;
  description: string;
  countSql: Prisma.Sql;
  sampleSql: Prisma.Sql;
};

function toCount(value: CountRow["count"]): number {
  return Number.parseInt(String(value), 10) || 0;
}

function orgFilter(alias: string) {
  return ORG_ID
    ? Prisma.sql`AND ${Prisma.raw(alias)}."orgId" = ${ORG_ID}`
    : Prisma.empty;
}

async function getCount(sql: Prisma.Sql) {
  const rows = await prisma.$queryRaw<CountRow[]>(sql);
  return toCount(rows[0]?.count || 0);
}

function printSample(issueKey: string, row: Record<string, unknown>) {
  const details = Object.entries(row)
    .map(([key, value]) => `${key}=${value === null ? "null" : String(value)}`)
    .join(" | ");
  console.log(`[diagnose-financial-integrity] sample ${issueKey} ${details}`);
}

function moneyDriftBase(whereSql: Prisma.Sql) {
  return Prisma.sql`
    WITH computed AS (
      SELECT
        i."id",
        i."orgId",
        i."invoiceNumber",
        i."status",
        i."subtotal",
        i."taxRate",
        i."taxAmount",
        i."total",
        i."amountPaid",
        i."balanceDue",
        COALESCE(line_totals."subtotal", 0)::numeric(12,2) AS "computedSubtotal",
        ROUND(COALESCE(line_totals."subtotal", 0) * i."taxRate", 2)::numeric(12,2) AS "computedTaxAmount",
        ROUND(
          COALESCE(line_totals."subtotal", 0)
          + ROUND(COALESCE(line_totals."subtotal", 0) * i."taxRate", 2),
          2
        )::numeric(12,2) AS "computedTotal",
        COALESCE(payment_totals."amountPaid", 0)::numeric(12,2) AS "computedAmountPaid"
      FROM "Invoice" i
      LEFT JOIN (
        SELECT "invoiceId", SUM("lineTotal") AS "subtotal"
        FROM "InvoiceLineItem"
        GROUP BY "invoiceId"
      ) line_totals ON line_totals."invoiceId" = i."id"
      LEFT JOIN (
        SELECT "invoiceId", SUM("amount") AS "amountPaid"
        FROM "InvoicePayment"
        GROUP BY "invoiceId"
      ) payment_totals ON payment_totals."invoiceId" = i."id"
      WHERE 1 = 1
      ${orgFilter("i")}
    ),
    checked AS (
      SELECT
        computed.*,
        GREATEST(
          ROUND(computed."computedTotal" - computed."computedAmountPaid", 2),
          0
        )::numeric(12,2) AS "computedBalanceDue"
      FROM computed
    )
    ${whereSql}
  `;
}

function statusDriftBase(whereSql: Prisma.Sql) {
  return Prisma.sql`
    WITH checked AS (
      SELECT
        i."id",
        i."orgId",
        i."invoiceNumber",
        i."status",
        i."total",
        i."amountPaid",
        i."balanceDue",
        i."dueDate",
        CASE
          WHEN i."total" <= 0 THEN CASE WHEN i."status" = 'DRAFT' THEN 'DRAFT' ELSE 'SENT' END
          WHEN i."amountPaid" >= i."total" THEN 'PAID'
          WHEN i."amountPaid" > 0 THEN 'PARTIAL'
          WHEN i."status" = 'DRAFT' THEN 'DRAFT'
          WHEN i."dueDate" < NOW() THEN 'OVERDUE'
          ELSE 'SENT'
        END AS "expectedStatus"
      FROM "Invoice" i
      WHERE 1 = 1
      ${orgFilter("i")}
    )
    ${whereSql}
  `;
}

const issues: Issue[] = [
  {
    key: "invoice_customer_org_mismatch",
    description: "Invoices whose required customer belongs to another organization.",
    countSql: Prisma.sql`
      SELECT COUNT(*)::text AS count
      FROM "Invoice" i
      LEFT JOIN "Customer" c ON c."id" = i."customerId"
      WHERE (c."id" IS NULL OR c."orgId" <> i."orgId")
      ${orgFilter("i")}
    `,
    sampleSql: Prisma.sql`
      SELECT
        i."id" AS "invoiceId",
        i."orgId" AS "invoiceOrgId",
        i."invoiceNumber",
        i."customerId",
        c."orgId" AS "customerOrgId"
      FROM "Invoice" i
      LEFT JOIN "Customer" c ON c."id" = i."customerId"
      WHERE (c."id" IS NULL OR c."orgId" <> i."orgId")
      ${orgFilter("i")}
      ORDER BY i."createdAt" DESC
      LIMIT ${SAMPLE_LIMIT}
    `,
  },
  {
    key: "invoice_lead_org_mismatch",
    description: "Invoices whose CRM lead context belongs to another organization.",
    countSql: Prisma.sql`
      SELECT COUNT(*)::text AS count
      FROM "Invoice" i
      LEFT JOIN "Lead" l ON l."id" = i."jobId"
      WHERE i."jobId" IS NOT NULL
        AND (l."id" IS NULL OR l."orgId" <> i."orgId")
      ${orgFilter("i")}
    `,
    sampleSql: Prisma.sql`
      SELECT
        i."id" AS "invoiceId",
        i."orgId" AS "invoiceOrgId",
        i."invoiceNumber",
        i."jobId" AS "legacyLeadId",
        l."orgId" AS "leadOrgId"
      FROM "Invoice" i
      LEFT JOIN "Lead" l ON l."id" = i."jobId"
      WHERE i."jobId" IS NOT NULL
        AND (l."id" IS NULL OR l."orgId" <> i."orgId")
      ${orgFilter("i")}
      ORDER BY i."createdAt" DESC
      LIMIT ${SAMPLE_LIMIT}
    `,
  },
  {
    key: "invoice_source_estimate_org_mismatch",
    description: "Invoices whose source estimate belongs to another organization.",
    countSql: Prisma.sql`
      SELECT COUNT(*)::text AS count
      FROM "Invoice" i
      LEFT JOIN "Estimate" e ON e."id" = i."sourceEstimateId"
      WHERE i."sourceEstimateId" IS NOT NULL
        AND (e."id" IS NULL OR e."orgId" <> i."orgId")
      ${orgFilter("i")}
    `,
    sampleSql: Prisma.sql`
      SELECT
        i."id" AS "invoiceId",
        i."orgId" AS "invoiceOrgId",
        i."invoiceNumber",
        i."sourceEstimateId",
        e."orgId" AS "estimateOrgId"
      FROM "Invoice" i
      LEFT JOIN "Estimate" e ON e."id" = i."sourceEstimateId"
      WHERE i."sourceEstimateId" IS NOT NULL
        AND (e."id" IS NULL OR e."orgId" <> i."orgId")
      ${orgFilter("i")}
      ORDER BY i."createdAt" DESC
      LIMIT ${SAMPLE_LIMIT}
    `,
  },
  {
    key: "invoice_source_job_org_mismatch",
    description: "Invoices whose operational source job belongs to another organization.",
    countSql: Prisma.sql`
      SELECT COUNT(*)::text AS count
      FROM "Invoice" i
      LEFT JOIN "Job" j ON j."id" = i."sourceJobId"
      WHERE i."sourceJobId" IS NOT NULL
        AND (j."id" IS NULL OR j."orgId" <> i."orgId")
      ${orgFilter("i")}
    `,
    sampleSql: Prisma.sql`
      SELECT
        i."id" AS "invoiceId",
        i."orgId" AS "invoiceOrgId",
        i."invoiceNumber",
        i."sourceJobId",
        j."orgId" AS "jobOrgId"
      FROM "Invoice" i
      LEFT JOIN "Job" j ON j."id" = i."sourceJobId"
      WHERE i."sourceJobId" IS NOT NULL
        AND (j."id" IS NULL OR j."orgId" <> i."orgId")
      ${orgFilter("i")}
      ORDER BY i."createdAt" DESC
      LIMIT ${SAMPLE_LIMIT}
    `,
  },
  {
    key: "collection_attempt_invoice_org_mismatch",
    description: "Invoice collection attempts whose invoice belongs to another organization.",
    countSql: Prisma.sql`
      SELECT COUNT(*)::text AS count
      FROM "InvoiceCollectionAttempt" a
      LEFT JOIN "Invoice" i ON i."id" = a."invoiceId"
      WHERE (i."id" IS NULL OR i."orgId" <> a."orgId")
      ${orgFilter("a")}
    `,
    sampleSql: Prisma.sql`
      SELECT
        a."id" AS "attemptId",
        a."orgId" AS "attemptOrgId",
        a."invoiceId",
        i."orgId" AS "invoiceOrgId",
        a."source",
        a."outcome"
      FROM "InvoiceCollectionAttempt" a
      LEFT JOIN "Invoice" i ON i."id" = a."invoiceId"
      WHERE (i."id" IS NULL OR i."orgId" <> a."orgId")
      ${orgFilter("a")}
      ORDER BY a."createdAt" DESC
      LIMIT ${SAMPLE_LIMIT}
    `,
  },
  {
    key: "recurring_plan_customer_org_mismatch",
    description: "Recurring service plans whose customer belongs to another organization.",
    countSql: Prisma.sql`
      SELECT COUNT(*)::text AS count
      FROM "RecurringServicePlan" p
      LEFT JOIN "Customer" c ON c."id" = p."customerId"
      WHERE (c."id" IS NULL OR c."orgId" <> p."orgId")
      ${orgFilter("p")}
    `,
    sampleSql: Prisma.sql`
      SELECT
        p."id" AS "planId",
        p."orgId" AS "planOrgId",
        p."customerId",
        c."orgId" AS "customerOrgId",
        p."name",
        p."status"
      FROM "RecurringServicePlan" p
      LEFT JOIN "Customer" c ON c."id" = p."customerId"
      WHERE (c."id" IS NULL OR c."orgId" <> p."orgId")
      ${orgFilter("p")}
      ORDER BY p."createdAt" DESC
      LIMIT ${SAMPLE_LIMIT}
    `,
  },
  {
    key: "invoice_money_drift",
    description: "Invoices whose cached totals no longer match line items, payments, tax, or balance due.",
    countSql: moneyDriftBase(Prisma.sql`
      SELECT COUNT(*)::text AS count
      FROM checked
      WHERE "subtotal" IS DISTINCT FROM "computedSubtotal"
        OR "taxAmount" IS DISTINCT FROM "computedTaxAmount"
        OR "total" IS DISTINCT FROM "computedTotal"
        OR "amountPaid" IS DISTINCT FROM "computedAmountPaid"
        OR "balanceDue" IS DISTINCT FROM "computedBalanceDue"
    `),
    sampleSql: moneyDriftBase(Prisma.sql`
      SELECT
        "id" AS "invoiceId",
        "orgId",
        "invoiceNumber",
        "subtotal",
        "computedSubtotal",
        "taxAmount",
        "computedTaxAmount",
        "total",
        "computedTotal",
        "amountPaid",
        "computedAmountPaid",
        "balanceDue",
        "computedBalanceDue"
      FROM checked
      WHERE "subtotal" IS DISTINCT FROM "computedSubtotal"
        OR "taxAmount" IS DISTINCT FROM "computedTaxAmount"
        OR "total" IS DISTINCT FROM "computedTotal"
        OR "amountPaid" IS DISTINCT FROM "computedAmountPaid"
        OR "balanceDue" IS DISTINCT FROM "computedBalanceDue"
      ORDER BY "id" ASC
      LIMIT ${SAMPLE_LIMIT}
    `),
  },
  {
    key: "invoice_status_drift",
    description: "Invoices whose cached status disagrees with due date, total, and amount paid.",
    countSql: statusDriftBase(Prisma.sql`
      SELECT COUNT(*)::text AS count
      FROM checked
      WHERE "status"::text <> "expectedStatus"
    `),
    sampleSql: statusDriftBase(Prisma.sql`
      SELECT
        "id" AS "invoiceId",
        "orgId",
        "invoiceNumber",
        "status",
        "expectedStatus",
        "total",
        "amountPaid",
        "balanceDue",
        "dueDate"
      FROM checked
      WHERE "status"::text <> "expectedStatus"
      ORDER BY "dueDate" ASC
      LIMIT ${SAMPLE_LIMIT}
    `),
  },
  {
    key: "stale_open_invoice_checkout_session",
    description: "Open hosted checkout links whose amount no longer matches the invoice balance.",
    countSql: Prisma.sql`
      SELECT COUNT(*)::text AS count
      FROM "InvoiceCheckoutSession" s
      INNER JOIN "Invoice" i ON i."id" = s."invoiceId"
      WHERE s."status" = 'OPEN'
        AND (s."expiresAt" IS NULL OR s."expiresAt" > NOW())
        AND (
          i."balanceDue" <= 0
          OR s."amount" IS DISTINCT FROM i."balanceDue"
        )
      ${orgFilter("i")}
    `,
    sampleSql: Prisma.sql`
      SELECT
        s."id" AS "checkoutSessionId",
        s."invoiceId",
        i."orgId",
        i."invoiceNumber",
        i."status" AS "invoiceStatus",
        s."amount" AS "checkoutAmount",
        i."balanceDue",
        s."expiresAt"
      FROM "InvoiceCheckoutSession" s
      INNER JOIN "Invoice" i ON i."id" = s."invoiceId"
      WHERE s."status" = 'OPEN'
        AND (s."expiresAt" IS NULL OR s."expiresAt" > NOW())
        AND (
          i."balanceDue" <= 0
          OR s."amount" IS DISTINCT FROM i."balanceDue"
        )
      ${orgFilter("i")}
      ORDER BY s."createdAt" DESC
      LIMIT ${SAMPLE_LIMIT}
    `,
  },
  {
    key: "negative_financial_amount",
    description: "Financial rows with negative stored amounts that would break reporting trust.",
    countSql: Prisma.sql`
      SELECT COUNT(*)::text AS count
      FROM (
        SELECT i."id"
        FROM "Invoice" i
        WHERE (
          i."subtotal" < 0
          OR i."taxRate" < 0
          OR i."taxAmount" < 0
          OR i."total" < 0
          OR i."amountPaid" < 0
          OR i."balanceDue" < 0
        )
        ${orgFilter("i")}
        UNION ALL
        SELECT p."id"
        FROM "InvoicePayment" p
        INNER JOIN "Invoice" i ON i."id" = p."invoiceId"
        WHERE p."amount" < 0
        ${orgFilter("i")}
        UNION ALL
        SELECT s."id"
        FROM "InvoiceCheckoutSession" s
        INNER JOIN "Invoice" i ON i."id" = s."invoiceId"
        WHERE s."amount" < 0
        ${orgFilter("i")}
        UNION ALL
        SELECT rp."id"
        FROM "RecurringServicePlan" rp
        WHERE (rp."amount" < 0 OR rp."intervalCount" < 1)
        ${orgFilter("rp")}
      ) negative_rows
    `,
    sampleSql: Prisma.sql`
      SELECT *
      FROM (
        SELECT
          'invoice' AS "kind",
          i."id",
          i."orgId",
          i."invoiceNumber" AS "label",
          i."total"::text AS "amount"
        FROM "Invoice" i
        WHERE (
          i."subtotal" < 0
          OR i."taxRate" < 0
          OR i."taxAmount" < 0
          OR i."total" < 0
          OR i."amountPaid" < 0
          OR i."balanceDue" < 0
        )
        ${orgFilter("i")}
        UNION ALL
        SELECT
          'invoice_payment' AS "kind",
          p."id",
          i."orgId",
          i."invoiceNumber" AS "label",
          p."amount"::text AS "amount"
        FROM "InvoicePayment" p
        INNER JOIN "Invoice" i ON i."id" = p."invoiceId"
        WHERE p."amount" < 0
        ${orgFilter("i")}
        UNION ALL
        SELECT
          'invoice_checkout_session' AS "kind",
          s."id",
          i."orgId",
          i."invoiceNumber" AS "label",
          s."amount"::text AS "amount"
        FROM "InvoiceCheckoutSession" s
        INNER JOIN "Invoice" i ON i."id" = s."invoiceId"
        WHERE s."amount" < 0
        ${orgFilter("i")}
        UNION ALL
        SELECT
          'recurring_service_plan' AS "kind",
          rp."id",
          rp."orgId",
          rp."name" AS "label",
          rp."amount"::text AS "amount"
        FROM "RecurringServicePlan" rp
        WHERE (rp."amount" < 0 OR rp."intervalCount" < 1)
        ${orgFilter("rp")}
      ) negative_rows
      LIMIT ${SAMPLE_LIMIT}
    `,
  },
];

async function main() {
  let totalIssues = 0;

  console.log(
    `[diagnose-financial-integrity] org=${ORG_ID || "all"} sampleLimit=${SAMPLE_LIMIT}`,
  );

  for (const issue of issues) {
    const count = await getCount(issue.countSql);
    totalIssues += count;
    console.log(
      `[diagnose-financial-integrity] issue ${issue.key} count=${count} description="${issue.description}"`,
    );

    if (count === 0) {
      continue;
    }

    const samples = await prisma.$queryRaw<Record<string, unknown>[]>(issue.sampleSql);
    for (const sample of samples) {
      printSample(issue.key, sample);
    }
  }

  console.log(`[diagnose-financial-integrity] totalIssues=${totalIssues}`);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
