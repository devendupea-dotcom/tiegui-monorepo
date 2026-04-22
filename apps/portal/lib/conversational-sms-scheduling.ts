import { getLocalMinutesInDay } from "@/lib/calendar/dates";

export type ConversationalSmsSlotCandidate = {
  workerUserId: string;
  startAt: Date;
  endAt: Date;
};

function parseTimeWindowMinutes(value: string | null | undefined): number | null {
  const trimmed = (value || "").trim();
  const match = trimmed.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function isMinuteInsideWindow(localMinute: number, startMinute: number, endMinute: number): boolean {
  if (startMinute === endMinute) return true;
  if (startMinute < endMinute) {
    return localMinute >= startMinute && localMinute < endMinute;
  }
  return localMinute >= startMinute || localMinute < endMinute;
}

export function rankConversationalSmsSlotCandidates(input: {
  candidates: ConversationalSmsSlotCandidate[];
  timeZone: string;
  preferredWindowStart: string | null | undefined;
  preferredWindowEnd: string | null | undefined;
  limit?: number;
}): ConversationalSmsSlotCandidate[] {
  const startMinute = parseTimeWindowMinutes(input.preferredWindowStart);
  const endMinute = parseTimeWindowMinutes(input.preferredWindowEnd);
  const hasWindow = startMinute !== null && endMinute !== null;

  const ranked = [...input.candidates].sort((left, right) => {
    if (hasWindow) {
      const leftMinute = getLocalMinutesInDay(left.startAt, input.timeZone);
      const rightMinute = getLocalMinutesInDay(right.startAt, input.timeZone);
      const leftInWindow = isMinuteInsideWindow(leftMinute, startMinute, endMinute);
      const rightInWindow = isMinuteInsideWindow(rightMinute, startMinute, endMinute);
      if (leftInWindow !== rightInWindow) {
        return leftInWindow ? -1 : 1;
      }
    }

    return left.startAt.getTime() - right.startAt.getTime();
  });

  return ranked.slice(0, Math.max(1, input.limit ?? 3));
}
