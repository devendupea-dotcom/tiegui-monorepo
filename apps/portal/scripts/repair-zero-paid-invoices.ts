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
const { deriveInvoiceStatus, recomputeInvoiceTotals } = await import(new URL("../lib/invoices.ts", import.meta.url).href);

const prisma = new PrismaClient({
  ...(process.env.DATABASE_URL ? { datasources: { db: { url: process.env.DATABASE_URL } } } : {}),
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
});

const ZERO = new Prisma.Decimal(0);
const APPLY = process.argv.includes("--apply");
const LIMIT = Math.max(1, Math.min(5000, Number.parseInt(getArgValue("--limit") || "500", 10) || 500));
const ORG_ID = getArgValue("--org-id");
const BATCH_SIZE = 100;

type CandidateInvoice = {
  id: string;
  orgId: string;
  invoiceNumber: string;
  status: "DRAFT" | "SENT" | "PARTIAL" | "PAID" | "OVERDUE";
  total: Prisma.Decimal;
  amountPaid: Prisma.Decimal;
  balanceDue: Prisma.Decimal;
  dueDate: Date;
};

function baseWhere(): Prisma.InvoiceWhereInput {
  return {
    ...(ORG_ID ? { orgId: ORG_ID } : {}),
    total: { lte: ZERO },
    status: { in: ["PAID", "PARTIAL", "OVERDUE"] },
  };
}

function formatMoney(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

function formatCandidate(invoice: CandidateInvoice, nextStatus: string) {
  return [
    invoice.invoiceNumber,
    invoice.id,
    `${invoice.status} -> ${nextStatus}`,
    `total=${formatMoney(invoice.total)}`,
    `paid=${formatMoney(invoice.amountPaid)}`,
    `balance=${formatMoney(invoice.balanceDue)}`,
  ].join(" | ");
}

async function main() {
  let cursor: string | null = null;
  let scanned = 0;
  let candidates = 0;
  let changed = 0;
  const examples: string[] = [];
  const transitions = new Map<string, number>();

  while (candidates < LIMIT) {
    const remaining = LIMIT - candidates;
    const rows: CandidateInvoice[] = await prisma.invoice.findMany({
      where: baseWhere(),
      orderBy: { id: "asc" },
      take: Math.min(BATCH_SIZE, remaining),
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
      select: {
        id: true,
        orgId: true,
        invoiceNumber: true,
        status: true,
        total: true,
        amountPaid: true,
        balanceDue: true,
        dueDate: true,
      },
    });

    if (rows.length === 0) {
      break;
    }

    cursor = rows[rows.length - 1]?.id || null;

    for (const invoice of rows) {
      scanned += 1;
      candidates += 1;
      const predictedStatus = deriveInvoiceStatus({
        currentStatus: invoice.status,
        dueDate: invoice.dueDate,
        total: invoice.total,
        amountPaid: invoice.amountPaid,
      });

      if (predictedStatus !== invoice.status) {
        changed += 1;
        const key = `${invoice.status}->${predictedStatus}`;
        transitions.set(key, (transitions.get(key) || 0) + 1);
        if (examples.length < 25) {
          examples.push(formatCandidate(invoice, predictedStatus));
        }
      }

      if (!APPLY) {
        continue;
      }

      await prisma.$transaction(async (tx) => {
        await recomputeInvoiceTotals(tx, invoice.id);
      });
    }
  }

  console.log(`[repair-zero-paid-invoices] mode=${APPLY ? "apply" : "dry-run"} org=${ORG_ID || "all"} scanned=${scanned}`);
  console.log(`[repair-zero-paid-invoices] candidates=${candidates} predictedChanges=${changed}`);

  if (transitions.size > 0) {
    for (const [transition, count] of transitions.entries()) {
      console.log(`[repair-zero-paid-invoices] ${transition} count=${count}`);
    }
  }

  for (const example of examples) {
    console.log(`[repair-zero-paid-invoices] example ${example}`);
  }
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
