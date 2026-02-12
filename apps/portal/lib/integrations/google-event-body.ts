import { addDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

type JsonObject = Record<string, unknown>;

export function buildGoogleEventBody(input: {
  summary: string;
  description?: string | null;
  location?: string | null;
  startAtUtc: Date;
  endAtUtc: Date;
  allDay: boolean;
  timeZone: string;
}): JsonObject {
  if (input.allDay) {
    const startDate = formatInTimeZone(input.startAtUtc, input.timeZone, "yyyy-MM-dd");
    let endDate = formatInTimeZone(input.endAtUtc, input.timeZone, "yyyy-MM-dd");

    if (endDate <= startDate) {
      endDate = formatInTimeZone(addDays(input.startAtUtc, 1), input.timeZone, "yyyy-MM-dd");
    }

    return {
      summary: input.summary,
      description: input.description || undefined,
      location: input.location || undefined,
      start: {
        date: startDate,
        timeZone: input.timeZone,
      },
      end: {
        date: endDate,
        timeZone: input.timeZone,
      },
    };
  }

  return {
    summary: input.summary,
    description: input.description || undefined,
    location: input.location || undefined,
    start: {
      dateTime: input.startAtUtc.toISOString(),
      timeZone: input.timeZone,
    },
    end: {
      dateTime: input.endAtUtc.toISOString(),
      timeZone: input.timeZone,
    },
  };
}
