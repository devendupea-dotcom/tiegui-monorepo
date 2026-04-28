import { formatInTimeZone } from "date-fns-tz";
import {
  DEFAULT_CALENDAR_TIMEZONE,
  addDaysToDateKey,
  ensureTimeZone,
  formatDateTimeForDisplay,
  localDateFromUtc,
  parseIsoDateOnly,
  startOfTimeZoneDay,
  toUtcFromLocalDateTime,
} from "./calendar/dates";

type TimeParts = {
  hour: number;
  minute: number;
};

function parseTimeParts(text: string): TimeParts {
  const match = text.match(/(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!match) {
    return { hour: 9, minute: 0 };
  }

  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3]?.toLowerCase();

  if (Number.isNaN(hour) || Number.isNaN(minute) || minute < 0 || minute > 59) {
    return { hour: 9, minute: 0 };
  }

  if (meridiem === "pm" && hour < 12) {
    hour += 12;
  } else if (meridiem === "am" && hour === 12) {
    hour = 0;
  }

  if (!meridiem && hour >= 1 && hour <= 7) {
    hour += 12;
  }

  if (hour < 0 || hour > 23) {
    return { hour: 9, minute: 0 };
  }

  return { hour, minute };
}

function startOfDay(date: Date, timeZone: string): Date {
  return startOfTimeZoneDay(date, timeZone);
}

function timePartsLabel(timeParts: TimeParts): string {
  return `${String(timeParts.hour).padStart(2, "0")}:${String(timeParts.minute).padStart(2, "0")}`;
}

function withTime(baseDate: Date, timeParts: TimeParts, timeZone: string): Date {
  return toUtcFromLocalDateTime({
    date: localDateFromUtc(baseDate, timeZone),
    time: timePartsLabel(timeParts),
    timeZone,
  });
}

function buildValidatedDateKey(year: number, month: number, day: number): string | null {
  const dateKey = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return parseIsoDateOnly(dateKey) ? dateKey : null;
}

function parseWeekdayBase(text: string, now: Date, timeZone: string): Date | null {
  const weekMap: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };

  for (const [name, weekday] of Object.entries(weekMap)) {
    if (text.includes(name)) {
      const isoWeekday = Number(formatInTimeZone(now, timeZone, "i"));
      const todayWeekday = isoWeekday === 7 ? 0 : Math.max(0, isoWeekday - 1);
      let delta = (weekday - todayWeekday + 7) % 7;
      if (delta === 0) {
        delta = 7;
      }
      const resultDateKey = addDaysToDateKey(localDateFromUtc(now, timeZone), delta);
      return toUtcFromLocalDateTime({
        date: resultDateKey,
        time: "00:00",
        timeZone,
      });
    }
  }

  return null;
}

export function formatCallbackTime(
  value: Date,
  locale: "EN" | "ES",
  timeZone?: string,
): string {
  return formatDateTimeForDisplay(value, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }, {
    locale: locale === "ES" ? "es-US" : "en-US",
    timeZone: timeZone || DEFAULT_CALENDAR_TIMEZONE,
  });
}

export function parsePreferredCallbackAt(
  text: string,
  now = new Date(),
  timeZone = DEFAULT_CALENDAR_TIMEZONE,
): Date | null {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const resolvedTimeZone = ensureTimeZone(timeZone);
  const timeParts = parseTimeParts(normalized);
  let baseDate: Date | null = null;

  const isoMatch = normalized.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    const dateKey = buildValidatedDateKey(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
    if (dateKey) {
      baseDate = toUtcFromLocalDateTime({
        date: dateKey,
        time: "00:00",
        timeZone: resolvedTimeZone,
      });
    }
  }

  if (!baseDate) {
    const usMatch = normalized.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (usMatch) {
      const month = Number(usMatch[1]);
      const day = Number(usMatch[2]);
      let year = usMatch[3] ? Number(usMatch[3]) : Number(localDateFromUtc(now, resolvedTimeZone).slice(0, 4));
      if (year < 100) {
        year += 2000;
      }
      const dateKey = buildValidatedDateKey(year, month, day);
      if (dateKey) {
        baseDate = toUtcFromLocalDateTime({
          date: dateKey,
          time: "00:00",
          timeZone: resolvedTimeZone,
        });
      }
      if (!usMatch[3] && baseDate && baseDate < startOfDay(now, resolvedTimeZone)) {
        const nextYearDateKey = buildValidatedDateKey(year + 1, month, day);
        if (nextYearDateKey) {
          baseDate = toUtcFromLocalDateTime({
            date: nextYearDateKey,
            time: "00:00",
            timeZone: resolvedTimeZone,
          });
        }
      }
    }
  }

  if (!baseDate) {
    if (normalized.includes("tomorrow")) {
      baseDate = toUtcFromLocalDateTime({
        date: addDaysToDateKey(localDateFromUtc(now, resolvedTimeZone), 1),
        time: "00:00",
        timeZone: resolvedTimeZone,
      });
    } else if (normalized.includes("today")) {
      baseDate = startOfDay(now, resolvedTimeZone);
    } else {
      baseDate = parseWeekdayBase(normalized, now, resolvedTimeZone);
    }
  }

  if (!baseDate || Number.isNaN(baseDate.getTime())) {
    return null;
  }

  let result = withTime(baseDate, timeParts, resolvedTimeZone);
  if (result <= now) {
    if (normalized.includes("today")) {
      result = toUtcFromLocalDateTime({
        date: addDaysToDateKey(localDateFromUtc(now, resolvedTimeZone), 1),
        time: timePartsLabel(timeParts),
        timeZone: resolvedTimeZone,
      });
    } else if (!normalized.includes("/") && !normalized.includes("-")) {
      result = toUtcFromLocalDateTime({
        date: addDaysToDateKey(localDateFromUtc(baseDate, resolvedTimeZone), 7),
        time: timePartsLabel(timeParts),
        timeZone: resolvedTimeZone,
      });
    }
  }

  if (result <= now) {
    return null;
  }

  return result;
}
