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

export const dispatchScheduleChangeFields = [
  "scheduledDate",
  "scheduledStartTime",
  "scheduledEndTime",
] as const;

export type DispatchScheduleChangeField = (typeof dispatchScheduleChangeFields)[number];

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

export type DispatchSmsDeliveryState = "queued" | "sent" | "delivered" | "failed" | "suppressed";

export type DispatchSmsRemediationKind =
  | "retry_later"
  | "check_phone"
  | "opted_out"
  | "check_twilio"
  | "call_customer";

export type DispatchSmsRemediation = {
  kind: DispatchSmsRemediationKind;
  title: string;
  detail: string;
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function recordString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeDispatchIssueText(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

function dispatchIssueMentions(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => value.includes(pattern));
}

export function getDispatchScheduleChangeFields(metadata: unknown): DispatchScheduleChangeField[] {
  const record = asRecord(metadata);
  const rawChanges = record?.changes;
  if (!Array.isArray(rawChanges)) {
    return [];
  }

  const fields = new Set<DispatchScheduleChangeField>();
  for (const change of rawChanges) {
    const changeRecord = asRecord(change);
    const field = recordString(changeRecord, "field");
    if (
      field &&
      dispatchScheduleChangeFields.some((candidate) => candidate === field)
    ) {
      fields.add(field as DispatchScheduleChangeField);
    }
  }

  return [...fields];
}

export function isMeaningfulDispatchScheduleChange(metadata: unknown): boolean {
  return getDispatchScheduleChangeFields(metadata).length > 0;
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

export function getDispatchSmsDeliveryState(value: string | null | undefined): DispatchSmsDeliveryState | null {
  switch ((value || "").trim().toLowerCase()) {
    case "queued":
      return "queued";
    case "sent":
      return "sent";
    case "delivered":
      return "delivered";
    case "failed":
    case "undelivered":
      return "failed";
    case "suppressed":
      return "suppressed";
    default:
      return null;
  }
}

export function formatDispatchSmsDeliveryStateLabel(state: DispatchSmsDeliveryState): string {
  switch (state) {
    case "queued":
      return "Queued";
    case "sent":
      return "Sent";
    case "delivered":
      return "Delivered";
    case "failed":
      return "Failed";
    case "suppressed":
      return "Suppressed";
    default:
      return state;
  }
}

export function describeDispatchNotificationBlockedReason(input: {
  smsEnabled: boolean;
  canSend: boolean;
  notificationTypeEnabled: boolean;
  hasCustomerPhone: boolean;
  hasScheduledDate: boolean;
  optedOut: boolean;
  withinSendWindow: boolean;
}): string | null {
  if (!input.smsEnabled) {
    return "Dispatch SMS is disabled for this workspace.";
  }

  if (!input.canSend) {
    return "Dispatch SMS is not ready because Twilio is missing or paused.";
  }

  if (!input.notificationTypeEnabled) {
    return "This dispatch update type is disabled for customer SMS.";
  }

  if (!input.hasCustomerPhone) {
    return "Customer phone is missing.";
  }

  if (!input.hasScheduledDate) {
    return "Scheduled date is missing.";
  }

  if (input.optedOut) {
    return "Customer has opted out of SMS.";
  }

  if (!input.withinSendWindow) {
    return "Outside SMS send hours.";
  }

  return null;
}

export function describeDispatchSmsOperatorIssue(input: {
  deliveryState: DispatchSmsDeliveryState | null;
  providerStatus: string | null;
  blockedReason: string | null;
  failureReason: string | null;
  providerErrorCode?: string | null;
  providerErrorMessage?: string | null;
}): string | null {
  if (input.blockedReason) {
    return input.blockedReason;
  }

  const combinedText = [
    input.failureReason,
    input.providerErrorMessage,
    input.providerErrorCode ? `error ${input.providerErrorCode}` : null,
    input.providerStatus,
  ]
    .map((value) => normalizeDispatchIssueText(value))
    .filter(Boolean)
    .join(" ");

  if (
    dispatchIssueMentions(combinedText, [
      "opted out",
      "unsubscribed",
      "stop",
      "do not contact",
      "dnc",
    ])
  ) {
    return "Customer opted out of SMS.";
  }

  if (
    dispatchIssueMentions(combinedText, [
      "invalid",
      "not a valid phone number",
      "phone number",
      "landline",
      "unreachable destination handset",
      "unknown destination handset",
      "unavailable handset",
      "cannot route to this number",
      "not routable",
    ])
  ) {
    return "Customer phone number needs attention.";
  }

  if (
    dispatchIssueMentions(combinedText, [
      "twilio",
      "messaging service",
      "a2p",
      "auth token",
      "account",
      "workspace",
      "paused",
      "not configured",
    ])
  ) {
    return "Twilio or workspace SMS needs attention.";
  }

  if (input.deliveryState === "suppressed") {
    return "Customer update was suppressed before send.";
  }

  if (normalizeDispatchIssueText(input.providerStatus) === "undelivered") {
    return "Carrier could not deliver the customer update.";
  }

  if (input.deliveryState === "failed") {
    return "Customer update failed to send.";
  }

  return null;
}

export function getDispatchSmsRemediation(input: {
  deliveryState: DispatchSmsDeliveryState | null;
  providerStatus: string | null;
  blockedReason: string | null;
  failureReason: string | null;
  providerErrorCode?: string | null;
  providerErrorMessage?: string | null;
}): DispatchSmsRemediation | null {
  const combinedText = [
    input.blockedReason,
    input.failureReason,
    input.providerErrorMessage,
    input.providerErrorCode ? `error ${input.providerErrorCode}` : null,
    input.providerStatus,
  ]
    .map((value) => normalizeDispatchIssueText(value))
    .filter(Boolean)
    .join(" ");

  if (
    dispatchIssueMentions(combinedText, [
      "opted out",
      "unsubscribed",
      "stop",
      "do not contact",
      "dnc",
    ])
  ) {
    return {
      kind: "opted_out",
      title: "Customer opted out",
      detail: "Do not retry by SMS. Call the customer instead if this update is important.",
    };
  }

  if (
    dispatchIssueMentions(combinedText, [
      "invalid",
      "not a valid phone number",
      "phone number",
      "landline",
      "unreachable destination handset",
      "unknown destination handset",
      "unavailable handset",
      "cannot route to this number",
      "not routable",
    ])
  ) {
    return {
      kind: "check_phone",
      title: "Check customer phone number",
      detail: "Verify or correct the number before retrying. If timing is urgent, call the customer.",
    };
  }

  if (
    dispatchIssueMentions(combinedText, [
      "twilio",
      "messaging service",
      "a2p",
      "auth token",
      "account",
      "workspace",
      "paused",
      "not configured",
    ])
  ) {
    return {
      kind: "check_twilio",
      title: "Check Twilio or workspace SMS",
      detail: "Fix the workspace SMS setup before retrying this customer update.",
    };
  }

  if (normalizeDispatchIssueText(input.blockedReason) === "outside sms send hours.") {
    return {
      kind: "retry_later",
      title: "Retry during send hours",
      detail: "Wait until the workspace send window opens, or call the customer if the timing is urgent.",
    };
  }

  if (normalizeDispatchIssueText(input.providerStatus) === "undelivered") {
    return {
      kind: "call_customer",
      title: "Call customer instead",
      detail: "The carrier could not deliver this text. Calling is safer than repeating the same SMS.",
    };
  }

  if (input.deliveryState === "failed" || input.deliveryState === "suppressed") {
    return {
      kind: "retry_later",
      title: "Retry later",
      detail: "Retry once later if the issue clears, or call the customer if the update is time-sensitive.",
    };
  }

  return null;
}
