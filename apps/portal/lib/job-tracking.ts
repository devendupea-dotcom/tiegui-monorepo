import { randomBytes } from "node:crypto";
import { formatDispatchStatusLabel, type DispatchStatusValue } from "./dispatch";
import { hashToken } from "./tokens";

export const jobTrackingProgressKeys = ["scheduled", "on_the_way", "on_site", "completed"] as const;

export type JobTrackingProgressKey = (typeof jobTrackingProgressKeys)[number];
export type JobTrackingProgressState = "complete" | "current" | "upcoming";

export type JobTrackingProgressStep = {
  key: JobTrackingProgressKey;
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

export function formatJobTrackingStatusLabel(status: DispatchStatusValue): string {
  return formatDispatchStatusLabel(status);
}
