import type { EventType, LeadPriority, LeadStatus } from "@prisma/client";
import {
  endOfTimeZoneDay,
  endOfTimeZoneWeek,
  formatDateTimeForDisplay,
  formatDateTimeLocalInputValue,
  startOfTimeZoneDay,
} from "@/lib/calendar/dates";

export const leadStatusOptions: LeadStatus[] = [
  "NEW",
  "CALLED_NO_ANSWER",
  "VOICEMAIL",
  "INTERESTED",
  "FOLLOW_UP",
  "BOOKED",
  "NOT_INTERESTED",
  "DNC",
];

export const leadPriorityOptions: LeadPriority[] = ["HIGH", "MEDIUM", "LOW"];

export const eventTypeOptions: EventType[] = ["FOLLOW_UP", "DEMO", "ONBOARDING", "TASK"];

export function formatDateTime(value: Date | null | undefined): string {
  if (!value) return "-";
  return formatDateTimeForDisplay(value, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function toDateTimeLocalValue(value: Date | null | undefined): string {
  return formatDateTimeLocalInputValue(value);
}

export function isOverdueFollowUp(value: Date | null | undefined): boolean {
  if (!value) return false;
  return value.getTime() < Date.now();
}

export function startOfToday(date = new Date()): Date {
  return startOfTimeZoneDay(date);
}

export function endOfToday(date = new Date()): Date {
  return endOfTimeZoneDay(date);
}

export function endOfWeek(date = new Date()): Date {
  return endOfTimeZoneWeek(date);
}

export function formatLabel(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
