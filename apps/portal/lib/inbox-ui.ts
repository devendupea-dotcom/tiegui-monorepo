export type InboxTimelineEventLike = {
  id: string;
  createdAt: string;
};

function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

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
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}T${padDatePart(
    date.getHours(),
  )}:${padDatePart(date.getMinutes())}`;
}

export function fromDateTimeLocalInputValue(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
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
