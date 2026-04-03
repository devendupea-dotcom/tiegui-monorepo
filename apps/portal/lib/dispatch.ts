import { addDays } from "date-fns";
import type { DispatchJobStatus } from "@prisma/client";

export const DEFAULT_DISPATCH_CREW_NAMES = ["Crew 1", "Crew 2", "Crew 3"] as const;

export const dispatchStatusValues = [
  "scheduled",
  "on_the_way",
  "on_site",
  "completed",
  "rescheduled",
  "canceled",
] as const;

export type DispatchStatusValue = (typeof dispatchStatusValues)[number];

export const dispatchStatusLabels: Record<DispatchStatusValue, string> = {
  scheduled: "Scheduled",
  on_the_way: "On the way",
  on_site: "On site",
  completed: "Completed",
  rescheduled: "Rescheduled",
  canceled: "Canceled",
};

const dispatchStatusToDbMap: Record<DispatchStatusValue, DispatchJobStatus> = {
  scheduled: "SCHEDULED",
  on_the_way: "ON_THE_WAY",
  on_site: "ON_SITE",
  completed: "COMPLETED",
  rescheduled: "RESCHEDULED",
  canceled: "CANCELED",
};

const dispatchStatusFromDbMap: Record<DispatchJobStatus, DispatchStatusValue> = {
  SCHEDULED: "scheduled",
  ON_THE_WAY: "on_the_way",
  ON_SITE: "on_site",
  COMPLETED: "completed",
  RESCHEDULED: "rescheduled",
  CANCELED: "canceled",
};

export const dispatchPriorityValues = ["low", "medium", "high", "urgent"] as const;

export type DispatchPriorityValue = (typeof dispatchPriorityValues)[number];

export const dispatchPriorityLabels: Record<DispatchPriorityValue, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export const DISPATCH_CUSTOMER_NAME_MAX = 160;
export const DISPATCH_PHONE_MAX = 40;
export const DISPATCH_SERVICE_TYPE_MAX = 160;
export const DISPATCH_ADDRESS_MAX = 240;
export const DISPATCH_NOTES_MAX = 4000;
export const DISPATCH_PRIORITY_MAX = 40;

export type DispatchCrewSummary = {
  id: string;
  name: string;
  active: boolean;
  jobCount: number;
};

export type DispatchCrewManagementItem = {
  id: string;
  name: string;
  active: boolean;
  openJobCount: number;
};

export type DispatchNotificationSettings = {
  smsEnabled: boolean;
  notifyScheduled: boolean;
  notifyOnTheWay: boolean;
  notifyRescheduled: boolean;
  notifyCompleted: boolean;
  canSend: boolean;
};

export type DispatchCustomerLookupItem = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
};

export type DispatchLeadLookupItem = {
  id: string;
  label: string;
  phone: string | null;
  serviceType: string | null;
  address: string | null;
  customerId: string | null;
  customerName: string | null;
};

export type DispatchEstimateSummary = {
  id: string;
  estimateNumber: string;
  title: string;
  status: string;
  total: number;
};

export type DispatchCommunicationItem = {
  id: string;
  summary: string;
  channel: string;
  type: string;
  occurredAt: string;
  leadLabel: string | null;
};

export type DispatchJobSummary = {
  id: string;
  customerId: string | null;
  customerLabel: string | null;
  leadId: string | null;
  leadLabel: string | null;
  customerName: string;
  phone: string | null;
  serviceType: string;
  address: string;
  scheduledDate: string;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  status: DispatchStatusValue;
  assignedCrewId: string | null;
  assignedCrewName: string | null;
  crewOrder: number | null;
  notes: string | null;
  priority: string | null;
  linkedEstimateId: string | null;
  isOverdue: boolean;
  updatedAt: string;
};

export type DispatchJobDetail = DispatchJobSummary & {
  linkedEstimate: DispatchEstimateSummary | null;
  recentCommunication: DispatchCommunicationItem[];
};

export type DispatchDaySnapshot = {
  date: string;
  crews: DispatchCrewSummary[];
  jobs: DispatchJobSummary[];
  counts: {
    total: number;
    unassigned: number;
    completed: number;
    overdue: number;
  };
};

export function isDispatchStatusValue(value: string): value is DispatchStatusValue {
  return dispatchStatusValues.some((option) => option === value);
}

export function dispatchStatusToDb(value: DispatchStatusValue): DispatchJobStatus {
  return dispatchStatusToDbMap[value];
}

export function dispatchStatusFromDb(value: DispatchJobStatus): DispatchStatusValue {
  return dispatchStatusFromDbMap[value];
}

export function formatDispatchStatusLabel(value: DispatchStatusValue): string {
  return dispatchStatusLabels[value];
}

export function isDispatchPriorityValue(value: string): value is DispatchPriorityValue {
  return dispatchPriorityValues.some((option) => option === value);
}

export function formatDispatchPriorityLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (isDispatchPriorityValue(normalized)) {
    return dispatchPriorityLabels[normalized];
  }
  return value
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function isDispatchFinalStatus(value: DispatchStatusValue): boolean {
  return value === "completed" || value === "rescheduled" || value === "canceled";
}

export function formatDispatchDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function formatDispatchLocalDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getDispatchTodayDateKey(now: Date = new Date()): string {
  return formatDispatchLocalDateKey(now);
}

export function parseDispatchDateKey(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return null;
  }

  const parsed = new Date(`${value.trim()}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeDispatchDateKey(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = parseDispatchDateKey(value.trim());
  return parsed ? formatDispatchDateKey(parsed) : null;
}

export function nextDispatchDateKey(value: string): string | null {
  const parsed = parseDispatchDateKey(value);
  if (!parsed) return null;
  return formatDispatchDateKey(addDays(parsed, 1));
}

export function formatDispatchScheduledWindow(startTime: string | null, endTime: string | null): string {
  if (startTime && endTime) return `${startTime} - ${endTime}`;
  if (startTime) return `Starts ${startTime}`;
  if (endTime) return `By ${endTime}`;
  return "Any time";
}

export function compareDispatchJobs(
  left: Pick<DispatchJobSummary, "crewOrder" | "scheduledStartTime" | "customerName" | "id">,
  right: Pick<DispatchJobSummary, "crewOrder" | "scheduledStartTime" | "customerName" | "id">,
): number {
  const leftOrder = left.crewOrder ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = right.crewOrder ?? Number.MAX_SAFE_INTEGER;
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  const leftTime = left.scheduledStartTime || "99:99";
  const rightTime = right.scheduledStartTime || "99:99";
  if (leftTime !== rightTime) {
    return leftTime.localeCompare(rightTime);
  }

  const nameDiff = left.customerName.localeCompare(right.customerName);
  if (nameDiff !== 0) {
    return nameDiff;
  }

  return left.id.localeCompare(right.id);
}

function formatDispatchSmsDate(dateKey: string, timeZone: string): string {
  const [year = 0, month = 1, day = 1] = dateKey.split("-").map((part) => Number.parseInt(part, 10));
  const date = new Date(Date.UTC(year, (month || 1) - 1, day || 1, 12, 0, 0));
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone,
  }).format(date);
}

function buildScheduledWindowLabel(startTime: string | null, endTime: string | null): string {
  if (startTime && endTime) {
    return ` between ${startTime} and ${endTime}`;
  }
  if (startTime) {
    return ` around ${startTime}`;
  }
  if (endTime) {
    return ` by ${endTime}`;
  }
  return "";
}

export function formatDispatchCustomerSms(input: {
  orgName: string;
  serviceType: string;
  scheduledDate: string;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  status: DispatchStatusValue;
  timeZone: string;
}): string {
  const orgName = input.orgName.trim() || "TieGui";
  const serviceType = input.serviceType.trim() || "your job";
  const dateLabel = formatDispatchSmsDate(input.scheduledDate, input.timeZone);
  const windowLabel = buildScheduledWindowLabel(input.scheduledStartTime, input.scheduledEndTime);

  switch (input.status) {
    case "scheduled":
      return `${orgName}: ${serviceType} is scheduled for ${dateLabel}${windowLabel}. Reply here if anything changes.`;
    case "on_the_way":
      return `${orgName}: we're on the way for ${serviceType}. See you${windowLabel || " soon"}.`;
    case "rescheduled":
      return `${orgName}: ${serviceType} was moved to ${dateLabel}${windowLabel}. Reply if you need to adjust anything.`;
    case "completed":
      return `${orgName}: ${serviceType} is marked complete. Reply here if you want us to double-check anything.`;
    default:
      return `${orgName}: ${serviceType} was updated.`;
  }
}

export function serializeDispatchNotificationSettings(
  settings:
    | {
        dispatchSmsEnabled: boolean;
        dispatchSmsScheduled: boolean;
        dispatchSmsOnTheWay: boolean;
        dispatchSmsRescheduled: boolean;
        dispatchSmsCompleted: boolean;
      }
    | null
    | undefined,
  canSend: boolean,
): DispatchNotificationSettings {
  return {
    smsEnabled: settings?.dispatchSmsEnabled ?? false,
    notifyScheduled: settings?.dispatchSmsScheduled ?? true,
    notifyOnTheWay: settings?.dispatchSmsOnTheWay ?? true,
    notifyRescheduled: settings?.dispatchSmsRescheduled ?? true,
    notifyCompleted: settings?.dispatchSmsCompleted ?? true,
    canSend,
  };
}

export function shouldSendDispatchStatusNotification(
  settings: DispatchNotificationSettings,
  status: DispatchStatusValue,
): boolean {
  if (!settings.smsEnabled) {
    return false;
  }

  switch (status) {
    case "scheduled":
      return settings.notifyScheduled;
    case "on_the_way":
      return settings.notifyOnTheWay;
    case "rescheduled":
      return settings.notifyRescheduled;
    case "completed":
      return settings.notifyCompleted;
    default:
      return false;
  }
}
