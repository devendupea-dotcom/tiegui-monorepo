import { addDays, format, parseISO } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { ensureTimeZone } from "@/lib/calendar/dates";

export const DEFAULT_SMS_SEND_WINDOW_START_MINUTE = 8 * 60;
export const DEFAULT_SMS_SEND_WINDOW_END_MINUTE = 20 * 60;

function clampMinute(value: number | null | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1439, Math.floor(value as number)));
}

function minuteToLocalTime(minute: number): string {
  const safeMinute = Math.max(0, Math.min(1439, Math.floor(minute)));
  const hour = Math.floor(safeMinute / 60);
  const min = safeMinute % 60;
  return `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function localDateKey(date: Date, timeZone: string): string {
  return formatInTimeZone(date, timeZone, "yyyy-MM-dd");
}

function localMinuteOfDay(date: Date, timeZone: string): number {
  const hour = Number.parseInt(formatInTimeZone(date, timeZone, "H"), 10);
  const minute = Number.parseInt(formatInTimeZone(date, timeZone, "m"), 10);
  return hour * 60 + minute;
}

function addLocalDays(dateKey: string, days: number): string {
  const date = parseISO(`${dateKey}T00:00:00`);
  return format(addDays(date, days), "yyyy-MM-dd");
}

export function isMinuteInsideSendWindow(minute: number, startMinute: number, endMinute: number): boolean {
  if (startMinute === endMinute) {
    return true;
  }
  if (startMinute < endMinute) {
    return minute >= startMinute && minute < endMinute;
  }
  return minute >= startMinute || minute < endMinute;
}

export function isWithinSmsSendWindow(input: {
  at?: Date;
  timeZone: string | null | undefined;
  startMinute?: number | null;
  endMinute?: number | null;
}): boolean {
  const at = input.at || new Date();
  const timeZone = ensureTimeZone(input.timeZone);
  const startMinute = clampMinute(input.startMinute, DEFAULT_SMS_SEND_WINDOW_START_MINUTE);
  const endMinute = clampMinute(input.endMinute, DEFAULT_SMS_SEND_WINDOW_END_MINUTE);
  return isMinuteInsideSendWindow(localMinuteOfDay(at, timeZone), startMinute, endMinute);
}

export function nextSmsSendWindowStartUtc(input: {
  at?: Date;
  timeZone: string | null | undefined;
  startMinute?: number | null;
  endMinute?: number | null;
}): Date {
  const at = input.at || new Date();
  const timeZone = ensureTimeZone(input.timeZone);
  const startMinute = clampMinute(input.startMinute, DEFAULT_SMS_SEND_WINDOW_START_MINUTE);
  const endMinute = clampMinute(input.endMinute, DEFAULT_SMS_SEND_WINDOW_END_MINUTE);

  if (startMinute === endMinute) {
    return at;
  }

  const currentMinute = localMinuteOfDay(at, timeZone);
  if (isMinuteInsideSendWindow(currentMinute, startMinute, endMinute)) {
    return at;
  }

  const todayKey = localDateKey(at, timeZone);
  const nextStartDateKey =
    startMinute < endMinute && currentMinute >= endMinute ? addLocalDays(todayKey, 1) : todayKey;
  return fromZonedTime(`${nextStartDateKey}T${minuteToLocalTime(startMinute)}:00`, timeZone);
}
