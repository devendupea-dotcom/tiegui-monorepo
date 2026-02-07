import type { EventType, LeadPriority, LeadStatus } from "@prisma/client";

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
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

export function toDateTimeLocalValue(value: Date | null | undefined): string {
  if (!value) return "";
  const iso = new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString();
  return iso.slice(0, 16);
}

export function isOverdueFollowUp(value: Date | null | undefined): boolean {
  if (!value) return false;
  return value.getTime() < Date.now();
}

export function startOfToday(date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

export function endOfToday(date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

export function endOfWeek(date = new Date()): Date {
  const day = date.getDay();
  const daysUntilSunday = (7 - day) % 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + daysUntilSunday, 23, 59, 59, 999);
}

export function formatLabel(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
