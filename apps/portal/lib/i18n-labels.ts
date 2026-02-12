import { formatLabel } from "./hq";

type TranslationFn = (key: string) => string;

const STATUS_KEY_MAP: Record<string, string> = {
  NEW: "status.new",
  CALLED_NO_ANSWER: "status.called_no_answer",
  VOICEMAIL: "status.voicemail",
  INTERESTED: "status.interested",
  FOLLOW_UP: "status.follow_up",
  BOOKED: "status.booked",
  NOT_INTERESTED: "status.not_interested",
  DNC: "status.dnc",
  JOB: "status.job",
  ESTIMATE: "status.estimate",
  CALL: "status.call",
  BLOCK: "status.block",
  ADMIN: "status.admin",
  TRAVEL: "status.travel",
  DEMO: "status.demo",
  ONBOARDING: "status.onboarding",
  TASK: "status.task",
  GCAL_BLOCK: "status.gcal_block",
  SCHEDULED: "status.scheduled",
  CONFIRMED: "status.confirmed",
  EN_ROUTE: "status.en_route",
  ON_SITE: "status.on_site",
  IN_PROGRESS: "status.in_progress",
  COMPLETED: "status.completed",
  CANCELLED: "status.cancelled",
  NO_SHOW: "status.no_show",
  OVERDUE: "status.overdue",
  DRAFT: "status.draft",
  SENT: "status.sent",
  PAID: "status.paid",
  PARTIAL: "status.partial",
  ANSWERED: "status.answered",
  MISSED: "status.missed",
  RINGING: "status.ringing",
  ORGANIC: "status.organic",
  UNKNOWN: "status.unknown",
};

const PRIORITY_KEY_MAP: Record<string, string> = {
  HIGH: "priority.high",
  MEDIUM: "priority.medium",
  LOW: "priority.low",
};

function normalizeEnumValue(value: string): string {
  return value.trim().toUpperCase();
}

export function translateStatusLabel(value: string, t: TranslationFn): string {
  const normalized = normalizeEnumValue(value);
  const key = STATUS_KEY_MAP[normalized];
  return key ? t(key) : formatLabel(normalized);
}

export function translatePriorityLabel(value: string, t: TranslationFn): string {
  const normalized = normalizeEnumValue(value);
  const key = PRIORITY_KEY_MAP[normalized];
  return key ? t(key) : formatLabel(normalized);
}
