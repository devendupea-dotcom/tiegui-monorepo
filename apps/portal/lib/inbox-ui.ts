import {
  DEFAULT_CALENDAR_TIMEZONE,
  formatDateTimeLocalInputValue,
  toUtcFromLocalDateTime,
} from "@/lib/calendar/dates";

export type InboxTimelineEventLike = {
  id: string;
  createdAt: string;
};

export function mergeInboxTimelineEvents<T extends InboxTimelineEventLike>(serverEvents: T[], optimisticEvents: T[]): T[] {
  const merged = new Map<string, T>();

  for (const event of serverEvents) {
    merged.set(event.id, event);
  }

  for (const event of optimisticEvents) {
    merged.set(event.id, event);
  }

  return [...merged.values()].sort((left, right) => {
    const timeDiff = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    if (timeDiff !== 0) {
      return timeDiff;
    }
    return left.id.localeCompare(right.id);
  });
}

export function toDateTimeLocalInputValue(value: string | null | undefined): string {
  return formatDateTimeLocalInputValue(value, DEFAULT_CALENDAR_TIMEZONE);
}

export function fromDateTimeLocalInputValue(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const [date, timeWithMaybeSeconds] = trimmed.split("T");
  const time = (timeWithMaybeSeconds || "").slice(0, 5);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    return null;
  }

  try {
    return toUtcFromLocalDateTime({
      date,
      time,
      timeZone: DEFAULT_CALENDAR_TIMEZONE,
    }).toISOString();
  } catch {
    return null;
  }
}

export function formatRevenueInputCents(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "";
  }

  return (value / 100).toFixed(2).replace(/\.00$/, "");
}

export function parseRevenueInputToCents(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const normalized = trimmed.replace(/[$,\s]/g, "");
  if (!normalized) return null;

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return Number.NaN;
  }

  return Math.round(parsed * 100);
}

export function buildInboxHistoryUrl(input: {
  pathname: string;
  search: string;
  orgId: string;
  internalUser: boolean;
  leadId?: string | null;
  openContextEditor?: boolean;
}): string {
  const params = new URLSearchParams(
    input.search.startsWith("?") ? input.search.slice(1) : input.search,
  );

  if (input.internalUser) {
    params.set("orgId", input.orgId);
  }

  if (input.leadId) {
    params.set("leadId", input.leadId);
  } else {
    params.delete("leadId");
  }

  if (input.openContextEditor && input.leadId) {
    params.set("context", "edit");
  } else {
    params.delete("context");
  }

  const query = params.toString();
  return query ? `${input.pathname}?${query}` : input.pathname;
}
