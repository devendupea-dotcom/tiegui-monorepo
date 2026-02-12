import { Prisma, type GoogleSyncRunSource } from "@prisma/client";
import { addDays, addMinutes, parseISO } from "date-fns";
import { prisma } from "@/lib/prisma";
import { getOrgCalendarSettings, getWorkerCalendarTimeZone } from "@/lib/calendar/availability";
import { formatDateOnly, toUtcFromLocalDateTime } from "@/lib/calendar/dates";
import {
  disconnectGoogleAccount,
  getGoogleAccessTokenForAccount,
  getGoogleAccountBlockRules,
  getGoogleAccountByOrgUser,
  getGoogleAccountReadCalendarIds,
  hasGoogleWriteScope,
  markGoogleAccountSyncResult,
  normalizeReadCalendarIds,
  type GoogleCalendarBlockRules,
} from "./google-account-store";
import {
  GOOGLE_CALENDAR_WRITE_SCOPE,
  GoogleApiError,
  createGoogleCalendar,
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  listGoogleCalendarEventsInRange,
  listGoogleCalendars,
  refreshGoogleTokens,
  updateGoogleCalendarEvent,
} from "./googleClient";

type SyncJobAction = "UPSERT_EVENT" | "DELETE_EVENT" | "PULL_CALENDARS";
type SyncRunSource = GoogleSyncRunSource;

type ParsedDeletePayload = {
  googleEventId: string | null;
  googleCalendarId: string | null;
};

type ParsedGoogleRange = {
  startAtUtc: Date;
  endAtUtc: Date;
  allDay: boolean;
};

function getString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function parseDeletePayload(payload: Prisma.JsonValue | null | undefined): ParsedDeletePayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      googleEventId: null,
      googleCalendarId: null,
    };
  }
  const row = payload as Record<string, unknown>;
  return {
    googleEventId: getString(row.googleEventId),
    googleCalendarId: getString(row.googleCalendarId),
  };
}

function getRuleForCalendar(rules: GoogleCalendarBlockRules, calendarId: string) {
  const source = rules[calendarId];
  return {
    blockIfBusyOnly: source?.blockIfBusyOnly !== false,
    blockAllDay: source?.blockAllDay !== false,
  };
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof GoogleApiError) {
    return error.status === 429 || error.status >= 500;
  }
  return true;
}

function getRetryDelayMs(attemptCount: number): number {
  const base = 30_000;
  return Math.min(60 * 60 * 1000, base * 2 ** Math.max(0, attemptCount - 1));
}

function clampInt(value: number | null | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value ?? NaN)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(value as number)));
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string") {
    return error || fallback;
  }
  if (error instanceof Error) {
    return error.message || fallback;
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  return fallback;
}

async function createJobAttemptSnapshot(input: {
  jobId: string;
  orgId: string;
  userId: string;
  action: SyncJobAction;
  status: "DONE" | "ERROR";
  attemptNumber: number;
  retryable?: boolean | null;
  backoffMs?: number | null;
  nextRunAt?: Date | null;
  errorMessage?: string | null;
}) {
  await prisma.googleSyncJobAttempt.create({
    data: {
      jobId: input.jobId,
      orgId: input.orgId,
      userId: input.userId,
      action: input.action,
      status: input.status,
      attemptNumber: input.attemptNumber,
      retryable: input.retryable ?? null,
      backoffMs: input.backoffMs ?? null,
      nextRunAt: input.nextRunAt ?? null,
      errorMessage: input.errorMessage ? input.errorMessage.slice(0, 2000) : null,
    },
  });
}

function toGoogleBusyKey(calendarId: string, eventId: string): string {
  return `${calendarId}::${eventId}`;
}

function parseGoogleEventRange(input: {
  event: {
    startDateTime: string | null;
    endDateTime: string | null;
    startDate: string | null;
    endDate: string | null;
    startTimeZone: string | null;
  };
  fallbackTimeZone: string;
}): ParsedGoogleRange | null {
  const fromDateTime = input.event.startDateTime && input.event.endDateTime
    ? {
        startAtUtc: new Date(input.event.startDateTime),
        endAtUtc: new Date(input.event.endDateTime),
        allDay: false,
      }
    : null;

  if (
    fromDateTime &&
    Number.isFinite(fromDateTime.startAtUtc.getTime()) &&
    Number.isFinite(fromDateTime.endAtUtc.getTime())
  ) {
    if (fromDateTime.endAtUtc <= fromDateTime.startAtUtc) {
      fromDateTime.endAtUtc = addMinutes(fromDateTime.startAtUtc, 30);
    }
    return fromDateTime;
  }

  if (!input.event.startDate) {
    return null;
  }

  const timeZone = input.event.startTimeZone || input.fallbackTimeZone;
  const startAtUtc = toUtcFromLocalDateTime({
    date: input.event.startDate,
    time: "00:00",
    timeZone,
  });

  const endDate = input.event.endDate || formatDateOnly(addDays(parseISO(`${input.event.startDate}T00:00:00`), 1));
  let endAtUtc = toUtcFromLocalDateTime({
    date: endDate,
    time: "00:00",
    timeZone,
  });

  if (endAtUtc <= startAtUtc) {
    endAtUtc = addDays(startAtUtc, 1);
  }

  return {
    startAtUtc,
    endAtUtc,
    allDay: true,
  };
}

async function ensureGoogleBlockWorkerAssignment(input: {
  eventId: string;
  orgId: string;
  workerUserId: string;
}) {
  await prisma.calendarEventWorker.deleteMany({
    where: {
      eventId: input.eventId,
      workerUserId: {
        not: input.workerUserId,
      },
    },
  });

  await prisma.calendarEventWorker.upsert({
    where: {
      eventId_workerUserId: {
        eventId: input.eventId,
        workerUserId: input.workerUserId,
      },
    },
    update: {
      orgId: input.orgId,
    },
    create: {
      orgId: input.orgId,
      eventId: input.eventId,
      workerUserId: input.workerUserId,
    },
  });
}

async function upsertGoogleBusyBlock(input: {
  orgId: string;
  userId: string;
  calendarId: string;
  calendarSummary: string;
  event: {
    id: string;
    summary: string | null;
    description: string | null;
    location: string | null;
    status: string | null;
    transparency: string | null;
    startDateTime: string | null;
    endDateTime: string | null;
    startDate: string | null;
    endDate: string | null;
    startTimeZone: string | null;
  };
  fallbackTimeZone: string;
  blockRules: GoogleCalendarBlockRules;
}) {
  const key = toGoogleBusyKey(input.calendarId, input.event.id);
  const range = parseGoogleEventRange({
    event: input.event,
    fallbackTimeZone: input.fallbackTimeZone,
  });
  if (!range) {
    return { key, blocked: false };
  }

  const rule = getRuleForCalendar(input.blockRules, input.calendarId);
  const isCancelled = input.event.status === "cancelled";
  const isFree = input.event.transparency === "transparent";
  if (isCancelled) {
    return { key, blocked: false };
  }
  if (rule.blockIfBusyOnly && isFree) {
    return { key, blocked: false };
  }
  if (range.allDay && !rule.blockAllDay) {
    return { key, blocked: false };
  }

  const title = input.event.summary || "Google Busy";
  const details = [
    input.event.description || "",
    `Source: Google Calendar (${input.calendarSummary})`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const upserted = await prisma.event.upsert({
    where: {
      orgId_googleCalendarId_googleEventId: {
        orgId: input.orgId,
        googleCalendarId: input.calendarId,
        googleEventId: input.event.id,
      },
    },
    update: {
      type: "GCAL_BLOCK",
      provider: "GOOGLE",
      syncStatus: "OK",
      lastSyncedAt: new Date(),
      status: "CONFIRMED",
      busy: true,
      allDay: range.allDay,
      title,
      description: details || null,
      addressLine: input.event.location || null,
      startAt: range.startAtUtc,
      endAt: range.endAtUtc,
      assignedToUserId: input.userId,
      createdByUserId: null,
    },
    create: {
      orgId: input.orgId,
      type: "GCAL_BLOCK",
      provider: "GOOGLE",
      googleEventId: input.event.id,
      googleCalendarId: input.calendarId,
      syncStatus: "OK",
      lastSyncedAt: new Date(),
      status: "CONFIRMED",
      busy: true,
      allDay: range.allDay,
      title,
      description: details || null,
      addressLine: input.event.location || null,
      startAt: range.startAtUtc,
      endAt: range.endAtUtc,
      assignedToUserId: input.userId,
      createdByUserId: null,
    },
    select: {
      id: true,
    },
  });

  await ensureGoogleBlockWorkerAssignment({
    eventId: upserted.id,
    orgId: input.orgId,
    workerUserId: input.userId,
  });

  return { key, blocked: true };
}

async function markStaleGoogleBusyBlocks(input: {
  orgId: string;
  userId: string;
  readCalendarIds: string[];
  seenKeys: Set<string>;
}) {
  if (input.readCalendarIds.length === 0) return 0;

  const existing = await prisma.event.findMany({
    where: {
      orgId: input.orgId,
      provider: "GOOGLE",
      assignedToUserId: input.userId,
      googleCalendarId: {
        in: input.readCalendarIds,
      },
    },
    select: {
      id: true,
      googleCalendarId: true,
      googleEventId: true,
    },
  });

  let cancelled = 0;
  for (const row of existing) {
    if (!row.googleCalendarId || !row.googleEventId) continue;
    const key = toGoogleBusyKey(row.googleCalendarId, row.googleEventId);
    if (input.seenKeys.has(key)) continue;
    cancelled += 1;
    await prisma.event.update({
      where: { id: row.id },
      data: {
        status: "CANCELLED",
        busy: false,
        syncStatus: "OK",
        lastSyncedAt: new Date(),
      },
    });
  }

  return cancelled;
}

async function syncGoogleBusyBlocksForAccountId(accountId: string) {
  const tokenResult = await getGoogleAccessTokenForAccount({
    accountId,
    refresh: async (refreshToken) => refreshGoogleTokens(refreshToken),
  });

  const account = tokenResult.account;
  if (!account || !account.isEnabled || !account.accessTokenEncrypted) {
    return {
      accountId,
      calendars: 0,
      upserted: 0,
      cancelled: 0,
      skipped: true,
    };
  }

  const settings = await getOrgCalendarSettings(account.orgId);
  const accountTimeZone = await getWorkerCalendarTimeZone({
    workerUserId: account.userId,
    fallbackTimeZone: settings.calendarTimezone,
  });
  const readCalendarIds = getGoogleAccountReadCalendarIds(account);
  const blockRules = getGoogleAccountBlockRules(account);

  const calendarList = await listGoogleCalendars({
    accessToken: tokenResult.accessToken,
  });
  const calendarById = new Map(calendarList.map((item) => [item.id, item]));
  const primaryCalendar = calendarList.find((item) => item.primary);
  const primaryEmail =
    primaryCalendar && primaryCalendar.id.includes("@") ? primaryCalendar.id : account.googleEmail || null;

  if (primaryEmail && primaryEmail !== account.googleEmail) {
    await prisma.googleAccount.update({
      where: { id: account.id },
      data: {
        googleEmail: primaryEmail,
      },
    });
  }

  const timeMinUtc = addDays(new Date(), -7);
  const timeMaxUtc = addDays(new Date(), 90);
  const seenKeys = new Set<string>();
  let upserted = 0;

  for (const calendarId of readCalendarIds) {
    const events = await listGoogleCalendarEventsInRange({
      accessToken: tokenResult.accessToken,
      calendarId,
      timeMinUtc,
      timeMaxUtc,
    });

    const calendarSummary = calendarById.get(calendarId)?.summary || calendarId;

    for (const event of events) {
      const result = await upsertGoogleBusyBlock({
        orgId: account.orgId,
        userId: account.userId,
        calendarId,
        calendarSummary,
        event,
        fallbackTimeZone: accountTimeZone,
        blockRules,
      });
      seenKeys.add(result.key);
      if (result.blocked) {
        upserted += 1;
      }
    }
  }

  const cancelled = await markStaleGoogleBusyBlocks({
    orgId: account.orgId,
    userId: account.userId,
    readCalendarIds,
    seenKeys,
  });

  await markGoogleAccountSyncResult({
    accountId: account.id,
    ok: true,
  });

  return {
    accountId: account.id,
    calendars: readCalendarIds.length,
    upserted,
    cancelled,
    skipped: false,
  };
}

async function updateEventSyncError(eventId: string, error: string) {
  await prisma.event.updateMany({
    where: { id: eventId },
    data: {
      syncStatus: "ERROR",
      lastSyncedAt: new Date(),
    },
  });

  await prisma.googleSyncJob.updateMany({
    where: {
      eventId,
      status: "PROCESSING",
    },
    data: {
      lastError: error.slice(0, 1000),
    },
  });
}

async function processDeleteAction(input: {
  orgId: string;
  userId: string;
  googleCalendarId: string | null;
  googleEventId: string | null;
}) {
  if (!input.googleCalendarId || !input.googleEventId) {
    return;
  }

  const account = await getGoogleAccountByOrgUser({
    orgId: input.orgId,
    userId: input.userId,
  });
  if (!account || !account.accessTokenEncrypted) {
    return;
  }

  const tokenResult = await getGoogleAccessTokenForAccount({
    accountId: account.id,
    refresh: async (refreshToken) => refreshGoogleTokens(refreshToken),
  });

  try {
    await deleteGoogleCalendarEvent({
      accessToken: tokenResult.accessToken,
      calendarId: input.googleCalendarId,
      eventId: input.googleEventId,
    });
  } catch (error) {
    if (error instanceof GoogleApiError && error.status === 404) {
      return;
    }
    throw error;
  }
}

async function processUpsertEventJob(job: {
  id: string;
  orgId: string;
  userId: string;
  eventId: string | null;
}) {
  if (!job.eventId) return;

  const event = await prisma.event.findUnique({
    where: { id: job.eventId },
    select: {
      id: true,
      orgId: true,
      provider: true,
      type: true,
      status: true,
      title: true,
      description: true,
      addressLine: true,
      allDay: true,
      startAt: true,
      endAt: true,
      assignedToUserId: true,
      googleEventId: true,
      googleCalendarId: true,
      syncStatus: true,
    },
  });

  if (!event) {
    return;
  }

  if (event.provider === "GOOGLE" || event.type === "GCAL_BLOCK") {
    return;
  }

  if (!event.assignedToUserId || event.status === "CANCELLED") {
    await processDeleteAction({
      orgId: event.orgId,
      userId: job.userId,
      googleCalendarId: event.googleCalendarId,
      googleEventId: event.googleEventId,
    });

    await prisma.event.update({
      where: { id: event.id },
      data: {
        googleEventId: null,
        googleCalendarId: null,
        syncStatus: "OK",
        lastSyncedAt: new Date(),
      },
    });
    return;
  }

  const account = await getGoogleAccountByOrgUser({
    orgId: event.orgId,
    userId: event.assignedToUserId,
  });

  if (!account || !account.isEnabled || !account.writeCalendarId || !hasGoogleWriteScope(account.scopes)) {
    await updateEventSyncError(event.id, "Google write sync is not enabled for assigned worker.");
    return;
  }

  const tokenResult = await getGoogleAccessTokenForAccount({
    accountId: account.id,
    refresh: async (refreshToken) => refreshGoogleTokens(refreshToken),
  });
  const settings = await getOrgCalendarSettings(event.orgId);
  const workerTimeZone = await getWorkerCalendarTimeZone({
    workerUserId: event.assignedToUserId,
    fallbackTimeZone: settings.calendarTimezone,
  });
  const startAtUtc = event.startAt;
  const endAtUtc = event.endAt && event.endAt > startAtUtc ? event.endAt : addMinutes(startAtUtc, 30);

  const summary = event.title || "TieGui Job";
  const description = event.description || null;

  let nextGoogleEventId = event.googleEventId;
  let nextGoogleCalendarId = event.googleCalendarId || account.writeCalendarId;

  if (event.googleEventId && event.googleCalendarId === account.writeCalendarId) {
    try {
      await updateGoogleCalendarEvent({
        accessToken: tokenResult.accessToken,
        calendarId: account.writeCalendarId,
        eventId: event.googleEventId,
        summary,
        description,
        location: event.addressLine,
        startAtUtc,
        endAtUtc,
        allDay: event.allDay,
        timeZone: workerTimeZone,
      });
    } catch (error) {
      if (error instanceof GoogleApiError && error.status === 404) {
        nextGoogleEventId = null;
      } else {
        throw error;
      }
    }
  }

  if (!nextGoogleEventId) {
    const created = await createGoogleCalendarEvent({
      accessToken: tokenResult.accessToken,
      calendarId: account.writeCalendarId,
      summary,
      description,
      location: event.addressLine,
      startAtUtc,
      endAtUtc,
      allDay: event.allDay,
      timeZone: workerTimeZone,
    });
    nextGoogleEventId = created.id;
    nextGoogleCalendarId = account.writeCalendarId;
  }

  await prisma.event.update({
    where: { id: event.id },
    data: {
      provider: "LOCAL",
      googleEventId: nextGoogleEventId,
      googleCalendarId: nextGoogleCalendarId,
      syncStatus: "OK",
      lastSyncedAt: new Date(),
    },
  });
}

async function processDeleteEventJob(job: {
  id: string;
  orgId: string;
  userId: string;
  eventId: string | null;
  payloadJson: Prisma.JsonValue | null;
}) {
  const payload = parseDeletePayload(job.payloadJson);

  let targetUserId = job.userId;
  let targetCalendarId = payload.googleCalendarId;
  let targetEventId = payload.googleEventId;

  if (job.eventId) {
    const event = await prisma.event.findUnique({
      where: { id: job.eventId },
      select: {
        assignedToUserId: true,
        googleCalendarId: true,
        googleEventId: true,
      },
    });
    if (event?.assignedToUserId) {
      targetUserId = event.assignedToUserId;
    }
    targetCalendarId = event?.googleCalendarId || targetCalendarId;
    targetEventId = event?.googleEventId || targetEventId;
  }

  await processDeleteAction({
    orgId: job.orgId,
    userId: targetUserId,
    googleCalendarId: targetCalendarId,
    googleEventId: targetEventId,
  });

  if (job.eventId) {
    await prisma.event.updateMany({
      where: { id: job.eventId },
      data: {
        googleEventId: null,
        googleCalendarId: null,
        syncStatus: "OK",
        lastSyncedAt: new Date(),
      },
    });
  }
}

async function processPullCalendarsJob(job: {
  userId: string;
  orgId: string;
}) {
  const account = await getGoogleAccountByOrgUser({
    orgId: job.orgId,
    userId: job.userId,
  });
  if (!account) return;
  await syncGoogleBusyBlocksForAccountId(account.id);
}

export async function enqueueGoogleSyncJob(input: {
  orgId: string;
  userId?: string | null;
  eventId?: string | null;
  action: SyncJobAction;
  payloadJson?: Prisma.JsonValue | null;
}) {
  if (!input.userId) {
    return null;
  }

  return prisma.googleSyncJob.create({
    data: {
      orgId: input.orgId,
      userId: input.userId,
      eventId: input.eventId || null,
      action: input.action,
      payloadJson:
        input.payloadJson === undefined
          ? undefined
          : input.payloadJson === null
            ? Prisma.JsonNull
            : input.payloadJson,
      status: "PENDING",
      runAfter: new Date(),
    },
  });
}

export async function processGoogleSyncJobs(input?: { limit?: number }) {
  const limit = Math.max(1, Math.min(100, input?.limit || 25));
  const now = new Date();

  const jobs = await prisma.googleSyncJob.findMany({
    where: {
      OR: [{ status: "PENDING" }, { status: "ERROR" }],
      runAfter: {
        lte: now,
      },
    },
    orderBy: [{ runAfter: "asc" }, { createdAt: "asc" }],
    take: limit,
  });

  let completed = 0;
  let failed = 0;

  for (const job of jobs) {
    const claim = await prisma.googleSyncJob.updateMany({
      where: {
        id: job.id,
        OR: [{ status: "PENDING" }, { status: "ERROR" }],
      },
      data: {
        status: "PROCESSING",
        attemptCount: {
          increment: 1,
        },
        backoffMs: 0,
        updatedAt: new Date(),
      },
    });

    if (claim.count === 0) {
      continue;
    }

    const claimed = await prisma.googleSyncJob.findUnique({
      where: { id: job.id },
      select: {
        id: true,
        orgId: true,
        userId: true,
        eventId: true,
        action: true,
        payloadJson: true,
        attemptCount: true,
      },
    });

    if (!claimed) {
      continue;
    }

    try {
      if (claimed.action === "UPSERT_EVENT") {
        await processUpsertEventJob(claimed);
      } else if (claimed.action === "DELETE_EVENT") {
        await processDeleteEventJob(claimed);
      } else if (claimed.action === "PULL_CALENDARS") {
        await processPullCalendarsJob(claimed);
      }

      await prisma.googleSyncJob.update({
        where: { id: claimed.id },
        data: {
          status: "DONE",
          backoffMs: 0,
          lastError: null,
        },
      });
      await createJobAttemptSnapshot({
        jobId: claimed.id,
        orgId: claimed.orgId,
        userId: claimed.userId,
        action: claimed.action as SyncJobAction,
        status: "DONE",
        attemptNumber: claimed.attemptCount,
      });
      completed += 1;
    } catch (error) {
      const retryable = isRetryableError(error);
      const message = toErrorMessage(error, "Google sync job failed.");
      const backoffMs = retryable ? getRetryDelayMs(claimed.attemptCount) : 24 * 60 * 60 * 1000;
      const nextRunAfter = new Date(Date.now() + backoffMs);

      await prisma.googleSyncJob.update({
        where: { id: claimed.id },
        data: {
          status: "ERROR",
          runAfter: nextRunAfter,
          backoffMs,
          lastError: message.slice(0, 1000),
        },
      });
      await createJobAttemptSnapshot({
        jobId: claimed.id,
        orgId: claimed.orgId,
        userId: claimed.userId,
        action: claimed.action as SyncJobAction,
        status: "ERROR",
        attemptNumber: claimed.attemptCount,
        retryable,
        backoffMs,
        nextRunAt: nextRunAfter,
        errorMessage: message,
      });

      if (claimed.eventId) {
        await updateEventSyncError(claimed.eventId, message);
      }

      failed += 1;
    }
  }

  return {
    processed: jobs.length,
    completed,
    failed,
  };
}

export async function syncDueGoogleAccounts(input?: { maxAccounts?: number }) {
  const maxAccounts = Math.max(1, Math.min(100, input?.maxAccounts || 20));
  const staleCutoff = new Date(Date.now() - 5 * 60 * 1000);

  const accounts = await prisma.googleAccount.findMany({
    where: {
      isEnabled: true,
      accessTokenEncrypted: {
        not: "",
      },
      OR: [{ lastSyncAt: null }, { lastSyncAt: { lte: staleCutoff } }],
    },
    orderBy: [{ lastSyncAt: "asc" }, { connectedAt: "asc" }],
    take: maxAccounts,
    select: { id: true },
  });

  const results: Array<Record<string, unknown>> = [];

  for (const account of accounts) {
    try {
      const result = await syncGoogleBusyBlocksForAccountId(account.id);
      results.push({
        ok: true,
        ...result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Google read sync failed.";
      await markGoogleAccountSyncResult({
        accountId: account.id,
        ok: false,
        error: message,
      });
      results.push({
        accountId: account.id,
        ok: false,
        error: message,
      });
    }
  }

  return {
    processed: accounts.length,
    results,
  };
}

export async function syncGoogleBusyBlocksForOrgUser(input: { orgId: string; userId: string }) {
  const account = await getGoogleAccountByOrgUser({
    orgId: input.orgId,
    userId: input.userId,
  });
  if (!account) {
    throw new Error("Google account is not connected for this user.");
  }

  try {
    const result = await syncGoogleBusyBlocksForAccountId(account.id);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google read sync failed.";
    await markGoogleAccountSyncResult({
      accountId: account.id,
      ok: false,
      error: message,
    });
    throw error;
  }
}

export async function fetchGoogleCalendarsForOrgUser(input: { orgId: string; userId: string }) {
  const account = await getGoogleAccountByOrgUser({
    orgId: input.orgId,
    userId: input.userId,
  });

  if (!account || !account.accessTokenEncrypted) {
    return {
      connected: false,
      account: null,
      calendars: [] as Array<{ id: string; summary: string; primary: boolean; accessRole: string; timeZone: string | null }>,
      hasWriteScope: false,
    };
  }

  const tokenResult = await getGoogleAccessTokenForAccount({
    accountId: account.id,
    refresh: async (refreshToken) => refreshGoogleTokens(refreshToken),
  });
  const calendars = await listGoogleCalendars({
    accessToken: tokenResult.accessToken,
  });

  return {
    connected: true,
    account: tokenResult.account,
    calendars,
    hasWriteScope: hasGoogleWriteScope(tokenResult.account?.scopes || []),
  };
}

export async function createTieGuiGoogleCalendar(input: {
  orgId: string;
  userId: string;
  summary: string;
  timeZone: string;
}) {
  const account = await getGoogleAccountByOrgUser({
    orgId: input.orgId,
    userId: input.userId,
  });
  if (!account || !account.accessTokenEncrypted) {
    throw new Error("Google account is not connected.");
  }
  if (!hasGoogleWriteScope(account.scopes)) {
    throw new Error("Google write scope is not enabled. Reconnect with write access.");
  }

  const tokenResult = await getGoogleAccessTokenForAccount({
    accountId: account.id,
    refresh: async (refreshToken) => refreshGoogleTokens(refreshToken),
  });
  const created = await createGoogleCalendar({
    accessToken: tokenResult.accessToken,
    summary: input.summary,
    timeZone: input.timeZone,
  });

  const readCalendarIds = normalizeReadCalendarIds(account.readCalendarIdsJson);
  if (!readCalendarIds.includes(created.id)) {
    readCalendarIds.push(created.id);
  }

  await prisma.googleAccount.update({
    where: { id: account.id },
    data: {
      writeCalendarId: created.id,
      readCalendarIdsJson: readCalendarIds,
      syncStatus: "IDLE",
      syncError: null,
    },
  });

  return created;
}

export async function runGoogleSyncCycle(input?: {
  maxJobs?: number;
  maxAccounts?: number;
  source?: SyncRunSource;
  triggeredByUserId?: string | null;
}) {
  const maxJobs = clampInt(input?.maxJobs, 40, 1, 300);
  const maxAccounts = clampInt(input?.maxAccounts, 20, 1, 200);
  const source = input?.source || "SYSTEM";
  const startedAt = new Date();

  const run = await prisma.googleSyncRun.create({
    data: {
      source,
      status: "RUNNING",
      triggeredByUserId: input?.triggeredByUserId || null,
      maxJobs,
      maxAccounts,
      startedAt,
    },
    select: { id: true },
  });

  try {
    const [jobs, readSync] = await Promise.all([
      processGoogleSyncJobs({ limit: maxJobs }),
      syncDueGoogleAccounts({ maxAccounts }),
    ]);

    const accountsFailed = readSync.results.filter((item) => item?.ok === false).length;
    const runStatus = jobs.failed > 0 || accountsFailed > 0 ? "ERROR" : "OK";

    await prisma.googleSyncRun.update({
      where: { id: run.id },
      data: {
        status: runStatus,
        jobsProcessed: jobs.processed,
        jobsCompleted: jobs.completed,
        jobsFailed: jobs.failed,
        accountsProcessed: readSync.processed,
        accountsFailed,
        finishedAt: new Date(),
        lastError:
          runStatus === "ERROR"
            ? toErrorMessage(
                readSync.results.find((item) => item?.ok === false)?.error || "Google sync run completed with failures.",
                "Google sync run completed with failures.",
              ).slice(0, 1500)
            : null,
      },
    });

    return {
      runId: run.id,
      jobs,
      readSync,
    };
  } catch (error) {
    const message = toErrorMessage(error, "Google sync run failed.");
    await prisma.googleSyncRun.update({
      where: { id: run.id },
      data: {
        status: "ERROR",
        finishedAt: new Date(),
        lastError: message.slice(0, 1500),
      },
    });
    throw error;
  }
}

export async function retryFailedGoogleSyncJobs(input?: { limit?: number }) {
  const limit = clampInt(input?.limit, 100, 1, 2000);
  const failedJobs = await prisma.googleSyncJob.findMany({
    where: {
      status: "ERROR",
    },
    orderBy: [{ runAfter: "asc" }, { updatedAt: "asc" }],
    take: limit,
    select: {
      id: true,
    },
  });

  if (failedJobs.length === 0) {
    return {
      selected: 0,
      retried: 0,
    };
  }

  const now = new Date();
  const retried = await prisma.googleSyncJob.updateMany({
    where: {
      id: {
        in: failedJobs.map((job) => job.id),
      },
    },
    data: {
      status: "PENDING",
      runAfter: now,
      backoffMs: 0,
      lastError: null,
    },
  });

  return {
    selected: failedJobs.length,
    retried: retried.count,
  };
}

export async function clearStuckGoogleSyncJobs(input?: { stuckMinutes?: number; limit?: number }) {
  const stuckMinutes = clampInt(input?.stuckMinutes, 30, 5, 24 * 60);
  const limit = clampInt(input?.limit, 100, 1, 1000);
  const cutoff = new Date(Date.now() - stuckMinutes * 60 * 1000);

  const stuckJobs = await prisma.googleSyncJob.findMany({
    where: {
      status: "PROCESSING",
      updatedAt: {
        lte: cutoff,
      },
    },
    orderBy: [{ updatedAt: "asc" }],
    take: limit,
    select: {
      id: true,
      orgId: true,
      userId: true,
      action: true,
      attemptCount: true,
    },
  });

  let cleared = 0;
  for (const job of stuckJobs) {
    const now = new Date();
    const message = `Marked as stuck after ${stuckMinutes} minutes in PROCESSING; reset for retry.`;
    const updated = await prisma.googleSyncJob.updateMany({
      where: {
        id: job.id,
        status: "PROCESSING",
      },
      data: {
        status: "ERROR",
        runAfter: now,
        backoffMs: 0,
        lastError: message,
      },
    });

    if (updated.count === 0) {
      continue;
    }

    await createJobAttemptSnapshot({
      jobId: job.id,
      orgId: job.orgId,
      userId: job.userId,
      action: job.action as SyncJobAction,
      status: "ERROR",
      attemptNumber: Math.max(1, job.attemptCount),
      retryable: true,
      backoffMs: 0,
      nextRunAt: now,
      errorMessage: message,
    });
    cleared += 1;
  }

  return {
    stuckMinutes,
    selected: stuckJobs.length,
    cleared,
    cutoffAt: cutoff.toISOString(),
  };
}

export async function getGoogleSyncHealthSnapshot(input?: {
  windowHours?: number;
  errorLimit?: number;
  stuckMinutes?: number;
}) {
  const now = new Date();
  const windowHours = clampInt(input?.windowHours, 24, 1, 24 * 14);
  const errorLimit = clampInt(input?.errorLimit, 20, 1, 100);
  const stuckMinutes = clampInt(input?.stuckMinutes, 30, 5, 24 * 60);
  const since = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  const stuckCutoff = new Date(now.getTime() - stuckMinutes * 60 * 1000);

  const [
    readyQueueDepth,
    delayedQueueDepth,
    processingQueueDepth,
    failedQueueDepth,
    stuckQueueDepth,
    jobSuccessCount,
    jobErrorCount,
    cronSuccessCount,
    cronErrorCount,
    lastCronRun,
    lastRun,
    recentErrors,
  ] = await Promise.all([
    prisma.googleSyncJob.count({
      where: {
        status: {
          in: ["PENDING", "ERROR"],
        },
        runAfter: {
          lte: now,
        },
      },
    }),
    prisma.googleSyncJob.count({
      where: {
        status: {
          in: ["PENDING", "ERROR"],
        },
        runAfter: {
          gt: now,
        },
      },
    }),
    prisma.googleSyncJob.count({
      where: {
        status: "PROCESSING",
      },
    }),
    prisma.googleSyncJob.count({
      where: {
        status: "ERROR",
      },
    }),
    prisma.googleSyncJob.count({
      where: {
        status: "PROCESSING",
        updatedAt: {
          lte: stuckCutoff,
        },
      },
    }),
    prisma.googleSyncJobAttempt.count({
      where: {
        status: "DONE",
        createdAt: {
          gte: since,
        },
      },
    }),
    prisma.googleSyncJobAttempt.count({
      where: {
        status: "ERROR",
        createdAt: {
          gte: since,
        },
      },
    }),
    prisma.googleSyncRun.count({
      where: {
        source: "CRON",
        status: "OK",
        startedAt: {
          gte: since,
        },
      },
    }),
    prisma.googleSyncRun.count({
      where: {
        source: "CRON",
        status: "ERROR",
        startedAt: {
          gte: since,
        },
      },
    }),
    prisma.googleSyncRun.findFirst({
      where: {
        source: "CRON",
      },
      orderBy: {
        startedAt: "desc",
      },
      select: {
        id: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        jobsProcessed: true,
        jobsCompleted: true,
        jobsFailed: true,
        accountsProcessed: true,
        accountsFailed: true,
        lastError: true,
      },
    }),
    prisma.googleSyncRun.findFirst({
      orderBy: {
        startedAt: "desc",
      },
      select: {
        id: true,
        source: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        jobsProcessed: true,
        jobsCompleted: true,
        jobsFailed: true,
        accountsProcessed: true,
        accountsFailed: true,
        lastError: true,
      },
    }),
    prisma.googleSyncJobAttempt.findMany({
      where: {
        status: "ERROR",
        errorMessage: {
          not: null,
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: errorLimit,
      select: {
        id: true,
        jobId: true,
        action: true,
        attemptNumber: true,
        retryable: true,
        backoffMs: true,
        nextRunAt: true,
        errorMessage: true,
        createdAt: true,
        org: {
          select: {
            id: true,
            name: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        job: {
          select: {
            status: true,
            runAfter: true,
            attemptCount: true,
            backoffMs: true,
          },
        },
      },
    }),
  ]);

  return {
    generatedAt: now.toISOString(),
    windowHours,
    errorLimit,
    stuckMinutes,
    queueDepth: {
      ready: readyQueueDepth,
      delayed: delayedQueueDepth,
      processing: processingQueueDepth,
      failed: failedQueueDepth,
      stuck: stuckQueueDepth,
      totalOpen: readyQueueDepth + delayedQueueDepth + processingQueueDepth,
    },
    counts: {
      jobSuccess: jobSuccessCount,
      jobError: jobErrorCount,
      cronSuccess: cronSuccessCount,
      cronError: cronErrorCount,
    },
    lastCronRun,
    lastRun,
    recentErrors,
  };
}

export async function getGoogleSyncAlertState(input?: {
  cronStaleMinutes?: number;
  queueDepthThreshold?: number;
  errorRateThreshold?: number;
  errorRateWindowMinutes?: number;
  dedupeWindowMinutes?: number;
}) {
  const now = new Date();
  const cronStaleMinutes = clampInt(input?.cronStaleMinutes, 15, 5, 24 * 60);
  const queueDepthThreshold = clampInt(input?.queueDepthThreshold, 80, 1, 100_000);
  const errorRateWindowMinutes = clampInt(input?.errorRateWindowMinutes, 60, 5, 24 * 60);
  const errorRateThreshold = Number.isFinite(input?.errorRateThreshold ?? NaN)
    ? Math.max(0, Math.min(1, Number(input?.errorRateThreshold)))
    : 0.25;
  const dedupeWindowMinutes = clampInt(input?.dedupeWindowMinutes, 10, 1, 24 * 60);
  const since = new Date(now.getTime() - errorRateWindowMinutes * 60 * 1000);

  const [readyQueueDepth, delayedQueueDepth, processingQueueDepth, lastCronRun, recentSuccessCount, recentErrorCount] =
    await Promise.all([
      prisma.googleSyncJob.count({
        where: {
          status: {
            in: ["PENDING", "ERROR"],
          },
          runAfter: {
            lte: now,
          },
        },
      }),
      prisma.googleSyncJob.count({
        where: {
          status: {
            in: ["PENDING", "ERROR"],
          },
          runAfter: {
            gt: now,
          },
        },
      }),
      prisma.googleSyncJob.count({
        where: {
          status: "PROCESSING",
        },
      }),
      prisma.googleSyncRun.findFirst({
        where: {
          source: "CRON",
        },
        orderBy: {
          startedAt: "desc",
        },
        select: {
          id: true,
          status: true,
          startedAt: true,
          finishedAt: true,
          lastError: true,
        },
      }),
      prisma.googleSyncJobAttempt.count({
        where: {
          status: "DONE",
          createdAt: {
            gte: since,
          },
        },
      }),
      prisma.googleSyncJobAttempt.count({
        where: {
          status: "ERROR",
          createdAt: {
            gte: since,
          },
        },
      }),
    ]);

  const totalOpenQueue = readyQueueDepth + delayedQueueDepth + processingQueueDepth;
  const recentAttempts = recentSuccessCount + recentErrorCount;
  const recentErrorRate = recentAttempts > 0 ? recentErrorCount / recentAttempts : 0;
  const lastCronRunAt = lastCronRun?.startedAt || null;
  const lastCronMinutesAgo = lastCronRunAt
    ? Math.max(0, Math.floor((now.getTime() - lastCronRunAt.getTime()) / (60 * 1000)))
    : null;

  const staleCron = !lastCronRunAt || (lastCronMinutesAgo !== null && lastCronMinutesAgo > cronStaleMinutes);
  const queueDepthExceeded = totalOpenQueue > queueDepthThreshold;
  const errorRateExceeded = recentAttempts > 0 && recentErrorRate > errorRateThreshold;
  const showBanner = staleCron || queueDepthExceeded || errorRateExceeded;

  const metricsSnapshot = {
    generatedAt: now.toISOString(),
    thresholds: {
      cronStaleMinutes,
      queueDepthThreshold,
      errorRateThreshold,
      errorRateWindowMinutes,
      dedupeWindowMinutes,
    },
    queueDepth: {
      ready: readyQueueDepth,
      delayed: delayedQueueDepth,
      processing: processingQueueDepth,
      totalOpen: totalOpenQueue,
    },
    recent: {
      attempts: recentAttempts,
      successes: recentSuccessCount,
      errors: recentErrorCount,
      errorRate: recentErrorRate,
      windowMinutes: errorRateWindowMinutes,
    },
    lastCronRun: lastCronRun
      ? {
          id: lastCronRun.id,
          status: lastCronRun.status,
          startedAt: lastCronRun.startedAt.toISOString(),
          finishedAt: lastCronRun.finishedAt ? lastCronRun.finishedAt.toISOString() : null,
          lastError: lastCronRun.lastError,
        }
      : null,
    lastCronRunAt: lastCronRunAt ? lastCronRunAt.toISOString() : null,
    lastCronMinutesAgo,
    flags: {
      cronStale: staleCron,
      queueHigh: queueDepthExceeded,
      errorRateHigh: errorRateExceeded,
    },
  };

  if (showBanner) {
    const cutoff = new Date(now.getTime() - dedupeWindowMinutes * 60 * 1000);
    const reasonFilters: Prisma.GoogleSyncHealthAlertWhereInput[] = [];
    if (staleCron) {
      reasonFilters.push({ cronStale: true });
    }
    if (queueDepthExceeded) {
      reasonFilters.push({ queueHigh: true });
    }
    if (errorRateExceeded) {
      reasonFilters.push({ errorRateHigh: true });
    }

    const recentReasonLogs =
      reasonFilters.length > 0
        ? await prisma.googleSyncHealthAlert.findMany({
            where: {
              createdAt: {
                gte: cutoff,
              },
              OR: reasonFilters,
            },
            select: {
              cronStale: true,
              queueHigh: true,
              errorRateHigh: true,
            },
            orderBy: {
              createdAt: "desc",
            },
            take: 100,
          })
        : [];

    const cronAlreadyLogged = staleCron && recentReasonLogs.some((item) => item.cronStale);
    const queueAlreadyLogged = queueDepthExceeded && recentReasonLogs.some((item) => item.queueHigh);
    const errorRateAlreadyLogged = errorRateExceeded && recentReasonLogs.some((item) => item.errorRateHigh);
    const shouldLog =
      (staleCron && !cronAlreadyLogged) ||
      (queueDepthExceeded && !queueAlreadyLogged) ||
      (errorRateExceeded && !errorRateAlreadyLogged);

    if (shouldLog) {
      await prisma.googleSyncHealthAlert.create({
        data: {
          cronStale: staleCron,
          queueHigh: queueDepthExceeded,
          errorRateHigh: errorRateExceeded,
          metricsSnapshot,
        },
      });
    }
  }

  return {
    generatedAt: now.toISOString(),
    thresholds: {
      cronStaleMinutes,
      queueDepthThreshold,
        errorRateThreshold,
        errorRateWindowMinutes,
        dedupeWindowMinutes,
      },
    queueDepth: {
      ready: readyQueueDepth,
      delayed: delayedQueueDepth,
      processing: processingQueueDepth,
      totalOpen: totalOpenQueue,
    },
    recent: {
      attempts: recentAttempts,
      successes: recentSuccessCount,
      errors: recentErrorCount,
      errorRate: recentErrorRate,
      windowMinutes: errorRateWindowMinutes,
    },
    lastCronRun: lastCronRun
      ? {
          id: lastCronRun.id,
          status: lastCronRun.status,
          startedAt: lastCronRun.startedAt,
          finishedAt: lastCronRun.finishedAt,
          lastError: lastCronRun.lastError,
        }
      : null,
    lastCronRunAt,
    lastCronMinutesAgo,
    flags: {
      staleCron,
      queueDepthExceeded,
      errorRateExceeded,
    },
    showBanner,
  };
}

export async function disconnectGoogleForOrgUser(input: { orgId: string; userId: string }) {
  await disconnectGoogleAccount({
    orgId: input.orgId,
    userId: input.userId,
  });
}

export function hasWritePermissionFromScopes(scopes: string[]) {
  return scopes.includes(GOOGLE_CALENDAR_WRITE_SCOPE);
}
