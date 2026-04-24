import { NextResponse } from "next/server";
import { isValidCronSecret } from "@/lib/cron-auth";
import {
  deriveInvoiceCollectionsQueueState,
} from "@/lib/invoice-collections";
import {
  recordInvoiceCollectionAttempt,
  sendInvoiceDelivery,
} from "@/lib/invoice-delivery";
import { normalizeEnvValue } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { getBaseUrlFromRequest } from "@/lib/urls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 50;
const MAX_SCAN_LIMIT = 1000;
const MAX_PRE_DUE_WINDOW_DAYS = 30;
const ROUTE = "/api/cron/invoice-collections";

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
) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function parseBooleanQuery(value: string | null): boolean {
  const normalized = (value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
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

  if (!isValidCronSecret(req, expected)) {
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

async function handleInvoiceCollectionsCron(req: Request) {
  const authError = validateCronAuth(req);
  if (authError) {
    return authError;
  }

  const url = new URL(req.url);
  const limit = clampInt(url.searchParams.get("limit"), {
    fallback: DEFAULT_LIMIT,
    min: 1,
    max: 200,
  });
  const scanLimit = clampInt(url.searchParams.get("scanLimit"), {
    fallback: Math.min(MAX_SCAN_LIMIT, limit * 4),
    min: 1,
    max: MAX_SCAN_LIMIT,
  });
  const dryRun = parseBooleanQuery(url.searchParams.get("dryRun"));
  const now = new Date();
  const baseUrl = getBaseUrlFromRequest(req);
  const dueCutoff = new Date(now.getTime() + MAX_PRE_DUE_WINDOW_DAYS * DAY_MS);

  const cronLog = await prisma.internalCronRunLog.create({
    data: {
      route: ROUTE,
      status: "OK",
      startedAt: now,
      metricsJson: {
        limit,
        scanLimit,
        dryRun,
        dueCutoff: dueCutoff.toISOString(),
      },
    },
    select: {
      id: true,
    },
  });

  try {
    const invoices = await prisma.invoice.findMany({
      where: {
        status: { in: ["SENT", "PARTIAL", "OVERDUE"] },
        balanceDue: { gt: 0 },
        dueDate: { lte: dueCutoff },
        org: {
          invoiceCollectionsEnabled: true,
          invoiceCollectionsAutoSendEnabled: true,
        },
      },
      select: {
        id: true,
        orgId: true,
        status: true,
        balanceDue: true,
        dueDate: true,
        sentAt: true,
        lastReminderSentAt: true,
        reminderCount: true,
        customer: {
          select: {
            email: true,
          },
        },
        org: {
          select: {
            invoiceCollectionsEnabled: true,
            invoiceCollectionsAutoSendEnabled: true,
            invoiceFirstReminderLeadDays: true,
            invoiceOverdueReminderCadenceDays: true,
            invoiceCollectionsMaxReminders: true,
          },
        },
      },
      orderBy: [{ dueDate: "asc" }, { updatedAt: "asc" }],
      take: scanLimit,
    });

    let dueNowCount = 0;
    let upcomingCount = 0;
    let maxedCount = 0;
    let attemptedCount = 0;
    let sentCount = 0;
    let failureCount = 0;
    let skippedMissingEmailCount = 0;
    let deferredDueNowCount = 0;

    for (const invoice of invoices) {
      const queueState = deriveInvoiceCollectionsQueueState({
        status: invoice.status,
        balanceDue: invoice.balanceDue,
        dueDate: invoice.dueDate,
        sentAt: invoice.sentAt,
        lastReminderSentAt: invoice.lastReminderSentAt,
        reminderCount: invoice.reminderCount,
        settings: {
          enabled: invoice.org.invoiceCollectionsEnabled,
          firstReminderLeadDays: invoice.org.invoiceFirstReminderLeadDays,
          overdueReminderCadenceDays:
            invoice.org.invoiceOverdueReminderCadenceDays,
          maxReminders: invoice.org.invoiceCollectionsMaxReminders,
        },
        now,
      });

      if (queueState.stage === "upcoming") {
        upcomingCount += 1;
        continue;
      }

      if (queueState.stage === "maxed") {
        maxedCount += 1;
        continue;
      }

      if (queueState.stage !== "due_now") {
        continue;
      }

      dueNowCount += 1;

      if (attemptedCount >= limit) {
        deferredDueNowCount += 1;
        continue;
      }

      if (!invoice.customer.email?.trim()) {
        skippedMissingEmailCount += 1;
        attemptedCount += 1;
        if (dryRun) {
          continue;
        }
        await recordInvoiceCollectionAttempt({
          orgId: invoice.orgId,
          invoiceId: invoice.id,
          source: "AUTOMATION",
          outcome: "SKIPPED",
          reason:
            "Customer email is missing, so the automated reminder was not sent.",
          metadataJson: {
            route: ROUTE,
            queueStage: queueState.stage,
          },
          dedupeWindowMinutes: 720,
        });
        continue;
      }

      attemptedCount += 1;

      if (dryRun) {
        continue;
      }

      try {
        await sendInvoiceDelivery({
          invoiceId: invoice.id,
          baseUrl,
          sendMode: "reminder",
          source: "AUTOMATION",
        });
        sentCount += 1;
      } catch (error) {
        failureCount += 1;
        await recordInvoiceCollectionAttempt({
          orgId: invoice.orgId,
          invoiceId: invoice.id,
          source: "AUTOMATION",
          outcome: "FAILED",
          reason:
            error instanceof Error
              ? error.message
              : "Automated reminder failed to send.",
          metadataJson: {
            route: ROUTE,
            queueStage: queueState.stage,
          },
        });
      }
    }

    await prisma.internalCronRunLog.update({
      where: {
        id: cronLog.id,
      },
      data: {
        status: failureCount > 0 ? "ERROR" : "OK",
        finishedAt: new Date(),
        processedCount: invoices.length,
        successCount: sentCount,
        failureCount,
        metricsJson: {
          limit,
          scanLimit,
          dryRun,
          scanned: invoices.length,
          dueNowCount,
          upcomingCount,
          maxedCount,
          attemptedCount,
          sentCount,
          failureCount,
          skippedMissingEmailCount,
          deferredDueNowCount,
        },
      },
    });

    return NextResponse.json({
      ok: true,
      processedAt: now.toISOString(),
      limit,
      scanLimit,
      dryRun,
      scanned: invoices.length,
      dueNowCount,
      upcomingCount,
      maxedCount,
      attemptedCount,
      sentCount,
      failureCount,
      skippedMissingEmailCount,
      deferredDueNowCount,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Invoice collections cron failed.";

    await prisma.internalCronRunLog.update({
      where: {
        id: cronLog.id,
      },
      data: {
        status: "ERROR",
        finishedAt: new Date(),
        errorMessage: message,
      },
    });

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  return handleInvoiceCollectionsCron(req);
}

export async function POST(req: Request) {
  return handleInvoiceCollectionsCron(req);
}
