import { randomBytes } from "node:crypto";
import { formatDispatchStatusLabel, type DispatchStatusValue } from "./dispatch";
import { hashToken } from "./tokens";

export { formatOperationalJobStatusLabel } from "./job-tracking-format";

export const jobTrackingProgressKeys = ["scheduled", "on_the_way", "on_site", "completed"] as const;
export const builderTrackingProgressKeys = ["planning", "factory_build", "delivery_setup", "move_in"] as const;

export type JobTrackingProgressKey = (typeof jobTrackingProgressKeys)[number];
export type BuilderTrackingProgressKey = (typeof builderTrackingProgressKeys)[number];
export type JobTrackingProgressState = "complete" | "current" | "upcoming";

export type JobTrackingProgressStep = {
  key: JobTrackingProgressKey | BuilderTrackingProgressKey;
  label: string;
  state: JobTrackingProgressState;
};

export type JobTrackingTimelineItem = {
  id: string;
  kind: "job_event" | "communication";
  title: string;
  detail: string | null;
  occurredAt: string;
};

export type CustomerJobTrackingDetail = {
  jobId: string;
  trackingTitle: string;
  customerName: string;
  address: string;
  currentStatus: DispatchStatusValue;
  currentStatusLabel: string;
  vertical: "CONTRACTOR" | "HOMEBUILDER";
  trackingEyebrow: string;
  scheduleLabel: string;
  progressTitle: string;
  progressDescription: string;
  timelineDescription: string;
  scheduledDate: string | null;
  scheduledWindow: string;
  assignedCrewName: string | null;
  contractor: {
    name: string;
    phone: string;
    email: string;
    website: string;
  };
  progressSteps: JobTrackingProgressStep[];
  timeline: JobTrackingTimelineItem[];
};

const jobTrackingProgressLabels: Record<JobTrackingProgressKey, string> = {
  scheduled: "Scheduled",
  on_the_way: "On the Way",
  on_site: "In Progress",
  completed: "Completed",
};

const builderTrackingProgressLabels: Record<BuilderTrackingProgressKey, string> = {
  planning: "Planning",
  factory_build: "Factory Build",
  delivery_setup: "Delivery + Setup",
  move_in: "Move-In",
};

export function createJobTrackingToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("hex");
  return {
    token,
    tokenHash: hashToken(token),
  };
}

function normalizeProgressKey(status: DispatchStatusValue): JobTrackingProgressKey {
  if (status === "on_the_way") return "on_the_way";
  if (status === "on_site") return "on_site";
  if (status === "completed") return "completed";
  return "scheduled";
}

export function buildJobTrackingProgressSteps(status: DispatchStatusValue): JobTrackingProgressStep[] {
  const currentKey = normalizeProgressKey(status);
  const currentIndex = jobTrackingProgressKeys.indexOf(currentKey);

  return jobTrackingProgressKeys.map((key, index) => {
    let state: JobTrackingProgressState = "upcoming";
    if (index < currentIndex) {
      state = "complete";
    } else if (index === currentIndex) {
      state = "current";
    }

    return {
      key,
      label: jobTrackingProgressLabels[key],
      state,
    };
  });
}

function normalizeBuilderProgressKey(status: DispatchStatusValue): BuilderTrackingProgressKey {
  if (status === "on_site") return "delivery_setup";
  if (status === "completed") return "move_in";
  if (status === "on_the_way") return "factory_build";
  return "planning";
}

export function buildBuilderTrackingProgressSteps(status: DispatchStatusValue): JobTrackingProgressStep[] {
  const currentKey = normalizeBuilderProgressKey(status);
  const currentIndex = builderTrackingProgressKeys.indexOf(currentKey);

  return builderTrackingProgressKeys.map((key, index) => {
    let state: JobTrackingProgressState = "upcoming";
    if (index < currentIndex) {
      state = "complete";
    } else if (index === currentIndex) {
      state = "current";
    }

    return {
      key,
      label: builderTrackingProgressLabels[key],
      state,
    };
  });
}

export function formatJobTrackingStatusLabel(status: DispatchStatusValue): string {
  return formatDispatchStatusLabel(status);
}

export function formatBuilderTrackingStatusLabel(status: DispatchStatusValue): string {
  if (status === "on_the_way") return "Factory build / delivery coordination";
  if (status === "on_site") return "Setup in progress";
  if (status === "completed") return "Move-in ready";
  if (status === "rescheduled") return "Timeline updated";
  if (status === "canceled") return "Paused";
  return "Planning";
}

export function describeJobTrackingStatusChange(input: {
  statusKind?: string | null;
  nextStatusLabel: string;
}): {
  title: string;
  detail: string;
} {
  if (input.statusKind === "job") {
    return {
      title: "Job status updated",
      detail: `Internal status: ${input.nextStatusLabel}.`,
    };
  }

  return {
    title: "Status updated",
    detail: `Current status: ${input.nextStatusLabel}.`,
  };
}
