import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { normalizeEnvValue } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_LIMIT = 200;
const REMINDER_EVENT_TITLE = "Invoice follow-up";

function clampInt(
  value: string | null,
  {
    fallback,
    min,
    max,
  }: {
    fallback: number;
    min: number;
    max: number;
  },
): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function getBearerToken(headerValue: string | null): string | null {
  if (!headerValue) {
    return null;
  }
  const trimmed = headerValue.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  const token = trimmed.slice(7).trim();
  return token || null;
}

function getCronSecret(req: Request): string | null {
  const headerSecret = req.headers.get("x-cron-secret")?.trim();
  if (headerSecret) {
    return headerSecret;
  }
  return getBearerToken(req.headers.get("authorization"));
}

function validateCronAuth(req: Request): NextResponse | null {
  const expected = normalizeEnvValue(process.env.CRON_SECRET);
  if (!expected) {
    return NextResponse.json(
      {
        ok: false,
        error: "CRON_SECRET is not configured.",
      },
      { status: 500 },
    );
  }

  const provided = getCronSecret(req);
  if (!provided || provided !== expected) {
    return NextResponse.json(
      {
        ok: false,
        error: "Unauthorized",
      },
      { status: 401 },
    );
  }

  return null;
}

function formatCurrencyFromCents(value: number | null | undefined): string {
  if (!value) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value / 100);
}

function buildInvoiceDraft({
  leadLabel,
  phoneE164,
  estimatedRevenueCents,
  notes,
  measurements,
}: {
  leadLabel: string;
  phoneE164: string;
  estimatedRevenueCents: number | null;
  notes: Array<{ body: string }>;
  measurements: Array<{ label: string; value: string; unit: string | null; notes: string | null }>;
}): string {
  const lines: string[] = [
    `Invoice Draft - ${leadLabel}`,
    "",
    "Scope Summary:",
    `- Job / Lead: ${leadLabel}`,
    `- Contact Number: ${phoneE164}`,
  ];

  if (measurements.length > 0) {
    lines.push("", "Measurements:");
    for (const row of measurements) {
      const unitLabel = row.unit ? ` ${row.unit}` : "";
      const noteLabel = row.notes ? ` (${row.notes})` : "";
      lines.push(`- ${row.label}: ${row.value}${unitLabel}${noteLabel}`);
    }
  }

  if (notes.length > 0) {
    lines.push("", "Recent Field Notes:");
    for (const note of notes) {
      lines.push(`- ${note.body}`);
    }
  }

  lines.push(
    "",
    "Recommended Line Items:",
    "- Labor",
    "- Materials",
    "- Travel / Mobilization",
    "- Optional extras",
  );

  if (estimatedRevenueCents) {
    lines.push("", `Target Total: ${formatCurrencyFromCents(estimatedRevenueCents)}`);
  }

  return lines.join("\n");
}

export async function POST(req: Request) {
  const authError = validateCronAuth(req);
  if (authError) {
    return authError;
  }

  const url = new URL(req.url);
  const windowDays = clampInt(url.searchParams.get("windowDays"), {
    fallback: DEFAULT_WINDOW_DAYS,
    min: 1,
    max: 120,
  });
  const limit = clampInt(url.searchParams.get("limit"), {
    fallback: DEFAULT_LIMIT,
    min: 1,
    max: 1000,
  });

  const now = new Date();
  const since = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const staleReminderThreshold = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const leads = await prisma.lead.findMany({
    where: {
      status: "BOOKED",
      invoiceStatus: { not: "SENT" },
      updatedAt: { gte: since },
    },
    select: {
      id: true,
      orgId: true,
      contactName: true,
      businessName: true,
      phoneE164: true,
      estimatedRevenueCents: true,
      invoiceStatus: true,
      invoiceDraftText: true,
      invoiceDueAt: true,
      invoiceLastAutoTaskAt: true,
      leadNotes: {
        orderBy: { createdAt: "desc" },
        take: 6,
        select: { body: true },
      },
      measurements: {
        orderBy: { createdAt: "desc" },
        take: 12,
        select: { label: true, value: true, unit: true, notes: true },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });

  let draftsGenerated = 0;
  let remindersCreated = 0;
  let leadsTouched = 0;

  for (const lead of leads) {
    const leadLabel = lead.contactName || lead.businessName || lead.phoneE164;
    const updateData: Prisma.LeadUpdateInput = {};

    if (!lead.invoiceDraftText) {
      updateData.invoiceDraftText = buildInvoiceDraft({
        leadLabel,
        phoneE164: lead.phoneE164,
        estimatedRevenueCents: lead.estimatedRevenueCents,
        notes: lead.leadNotes,
        measurements: lead.measurements,
      });

      if (lead.invoiceStatus === "NONE") {
        updateData.invoiceStatus = "DRAFT_READY";
      }

      if (!lead.invoiceDueAt) {
        updateData.invoiceDueAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      }

      draftsGenerated += 1;
    }

    const shouldRefreshReminder =
      !lead.invoiceLastAutoTaskAt || lead.invoiceLastAutoTaskAt < staleReminderThreshold;

    if (shouldRefreshReminder) {
      const existingReminder = await prisma.event.findFirst({
        where: {
          orgId: lead.orgId,
          leadId: lead.id,
          type: "TASK",
          title: REMINDER_EVENT_TITLE,
          startAt: { gte: staleReminderThreshold },
        },
        select: { id: true },
      });

      if (!existingReminder) {
        await prisma.event.create({
          data: {
            orgId: lead.orgId,
            leadId: lead.id,
            type: "TASK",
            title: REMINDER_EVENT_TITLE,
            description: "Auto-created by invoice assist cron.",
            startAt: new Date(now.getTime() + 60 * 60 * 1000),
          },
        });
        remindersCreated += 1;
      }

      updateData.invoiceLastAutoTaskAt = now;
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: updateData,
      });
      leadsTouched += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    processedAt: now.toISOString(),
    windowDays,
    limit,
    leadsScanned: leads.length,
    leadsTouched,
    draftsGenerated,
    remindersCreated,
  });
}
