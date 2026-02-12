import {
  addDays,
  addMinutes,
  endOfMonth,
  endOfWeek,
  format,
  isValid,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";

export const DEFAULT_CALENDAR_TIMEZONE = "America/Los_Angeles";
export const DEFAULT_SLOT_MINUTES = 30;
const TIMEZONE_CACHE = new Map<string, boolean>();

export type CalendarView = "day" | "week" | "month";

export function clampSlotMinutes(value: number | null | undefined): 15 | 30 | 60 | 90 {
  if (value === 15 || value === 60 || value === 90) {
    return value;
  }
  return 30;
}

export function clampWeekStartsOn(value: number | null | undefined): 0 | 1 {
  return value === 1 ? 1 : 0;
}

export function ensureTimeZone(value: string | null | undefined): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    return DEFAULT_CALENDAR_TIMEZONE;
  }
  return isValidTimeZone(trimmed) ? trimmed : DEFAULT_CALENDAR_TIMEZONE;
}

export function isValidTimeZone(value: string | null | undefined): boolean {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return false;
  if (TIMEZONE_CACHE.has(trimmed)) {
    return TIMEZONE_CACHE.get(trimmed) || false;
  }

  let valid = false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: trimmed });
    valid = true;
  } catch {
    valid = false;
  }

  TIMEZONE_CACHE.set(trimmed, valid);
  return valid;
}

export function parseUtcDateTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/(?:[zZ]|[+-]\d{2}:\d{2})$/.test(trimmed)) {
    return null;
  }
  const parsed = new Date(trimmed);
  if (!isValid(parsed)) {
    return null;
  }
  return new Date(parsed.toISOString());
}

export function parseIsoDateOnly(value: string): Date | null {
  const parsed = parseISO(value);
  if (!isValid(parsed)) {
    return null;
  }
  return parsed;
}

export function formatDateOnly(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function isoToZonedDate(utcDate: Date, timeZone: string): Date {
  return toZonedTime(utcDate, ensureTimeZone(timeZone));
}

export function zonedDateString(utcDate: Date, timeZone: string): string {
  return formatInTimeZone(utcDate, ensureTimeZone(timeZone), "yyyy-MM-dd");
}

export function zonedTimeString(utcDate: Date, timeZone: string): string {
  return formatInTimeZone(utcDate, ensureTimeZone(timeZone), "HH:mm");
}

export function zonedDateTimeLabel(utcDate: Date, timeZone: string): string {
  return formatInTimeZone(utcDate, ensureTimeZone(timeZone), "MMM d, yyyy h:mm a");
}

export function toUtcFromLocalDateTime(input: { date: string; time: string; timeZone: string }): Date {
  return fromZonedTime(`${input.date}T${input.time}:00`, ensureTimeZone(input.timeZone));
}

export function addDuration(startUtc: Date, durationMinutes: number): Date {
  return addMinutes(startUtc, durationMinutes);
}

export function getUtcRangeForDate(input: { date: string; timeZone: string }): { startUtc: Date; endUtc: Date } {
  const startUtc = fromZonedTime(`${input.date}T00:00:00`, ensureTimeZone(input.timeZone));
  const nextDayUtc = fromZonedTime(
    `${formatDateOnly(addDays(parseISO(`${input.date}T00:00:00`), 1))}T00:00:00`,
    ensureTimeZone(input.timeZone),
  );
  return {
    startUtc,
    endUtc: nextDayUtc,
  };
}

export function getVisibleRange(input: {
  view: CalendarView;
  date: Date;
  weekStartsOn: 0 | 1;
}): { rangeStart: Date; rangeEnd: Date } {
  if (input.view === "day") {
    const dayStart = startOfDay(input.date);
    return {
      rangeStart: dayStart,
      rangeEnd: addDays(dayStart, 1),
    };
  }

  if (input.view === "week") {
    const weekStart = startOfWeek(input.date, { weekStartsOn: input.weekStartsOn });
    return {
      rangeStart: weekStart,
      rangeEnd: addDays(weekStart, 7),
    };
  }

  const monthStart = startOfMonth(input.date);
  const monthEnd = endOfMonth(input.date);
  const rangeStart = startOfWeek(monthStart, { weekStartsOn: input.weekStartsOn });
  const rangeEnd = addDays(endOfWeek(monthEnd, { weekStartsOn: input.weekStartsOn }), 1);
  return { rangeStart, rangeEnd };
}

export function getMonthGridDays(input: { date: Date; weekStartsOn: 0 | 1 }): Date[] {
  const monthStart = startOfMonth(input.date);
  const monthEnd = endOfMonth(input.date);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: input.weekStartsOn });
  const gridEndExclusive = addDays(endOfWeek(monthEnd, { weekStartsOn: input.weekStartsOn }), 1);
  const days: Date[] = [];
  let cursor = gridStart;
  while (cursor < gridEndExclusive) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

export function getLocalMinutesInDay(utcDate: Date, timeZone: string): number {
  const local = toZonedTime(utcDate, ensureTimeZone(timeZone));
  return local.getHours() * 60 + local.getMinutes();
}

export function minutesToHHmm(minutes: number): string {
  const safe = Math.max(0, Math.min(23 * 60 + 59, minutes));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export function startOfLocalDate(date: Date, timeZone: string): Date {
  const localDate = formatInTimeZone(date, ensureTimeZone(timeZone), "yyyy-MM-dd");
  return fromZonedTime(`${localDate}T00:00:00`, ensureTimeZone(timeZone));
}

export function localDateFromUtc(dateUtc: Date, timeZone: string): string {
  return formatInTimeZone(dateUtc, ensureTimeZone(timeZone), "yyyy-MM-dd");
}

export function moveUtcDatePreservingLocalTime(input: {
  sourceUtc: Date;
  targetDate: string;
  timeZone: string;
}): Date {
  const localTime = formatInTimeZone(input.sourceUtc, ensureTimeZone(input.timeZone), "HH:mm");
  return fromZonedTime(`${input.targetDate}T${localTime}:00`, ensureTimeZone(input.timeZone));
}
