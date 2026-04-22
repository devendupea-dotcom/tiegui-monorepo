import type {
  CalendarEventStatus,
  DispatchJobStatus,
  EstimateStatus,
  EventProvider,
  EventType,
} from "@prisma/client";
import { activeBookingEventStatuses } from "@/lib/booking-read-model";

const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const LEGACY_STATUS_NOTE_WINDOW_MS = 60 * 1000;

export type LegacySyntheticStatusEventCandidate = {
  id: string;
  leadId: string | null;
  type: EventType;
  provider: EventProvider;
  status: CalendarEventStatus;
  title: string;
  googleEventId: string | null;
  googleCalendarId: string | null;
  startAt: Date;
  endAt: Date | null;
  assignedToUserId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  lead: {
    contactName: string | null;
    businessName: string | null;
  } | null;
};

export type LegacySyntheticStatusLeadNoteCandidate = {
  leadId: string;
  createdByUserId: string | null;
  body: string;
  createdAt: Date;
};

export type LegacyJobBookingMirrorDriftKind =
  | "orphaned_schedule_mirror_job"
  | "job_schedule_mirror_needs_booking_link_backfill"
  | "job_execution_state_without_booking"
  | "job_execution_state_needs_booking_link_backfill";

export type LegacyJobBookingMirrorDrift = {
  kind: LegacyJobBookingMirrorDriftKind;
  canRepair: boolean;
};

export type LegacyJobBookingMirrorCandidate = {
  dispatchStatus: DispatchJobStatus;
  scheduledDate: Date | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  crewOrder: number | null;
  linkedBookingEventCount: number;
  activeLeadBookingEventCount: number;
};

export type LegacyEstimateShareLinkCandidate = {
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  firstViewedAt: Date | null;
  lastViewedAt: Date | null;
  approvedAt: Date | null;
  declinedAt: Date | null;
};

export type LegacyDraftEstimateShareCandidate = {
  status: EstimateStatus;
  sharedAt: Date | null;
  shareExpiresAt: Date | null;
  sentAt: Date | null;
  viewedAt: Date | null;
  customerViewedAt: Date | null;
  approvedAt: Date | null;
  declinedAt: Date | null;
  customerDecisionAt: Date | null;
  shareLinks: LegacyEstimateShareLinkCandidate[];
};

export type LegacyDraftEstimateShareRepair = {
  targetStatus: EstimateStatus;
  reason: "shared" | "viewed" | "approved" | "declined";
  data: {
    status: EstimateStatus;
    sharedAt?: Date;
    shareExpiresAt?: Date;
    sentAt?: Date;
    viewedAt?: Date;
    customerViewedAt?: Date;
    approvedAt?: Date;
    declinedAt?: Date;
    customerDecisionAt?: Date;
  };
};

const dispatchExecutionWithoutBookingStatuses: DispatchJobStatus[] = ["ON_THE_WAY", "ON_SITE"];

function isExactThirtyMinuteWindow(startAt: Date, endAt: Date | null) {
  return Boolean(endAt) && endAt!.getTime() - startAt.getTime() === THIRTY_MINUTES_MS;
}

function isWithinLegacyStatusNoteWindow(left: Date, right: Date) {
  return Math.abs(left.getTime() - right.getTime()) <= LEGACY_STATUS_NOTE_WINDOW_MS;
}

function minDate(values: Array<Date | null | undefined>) {
  const filtered = values.filter((value): value is Date => value instanceof Date);
  if (filtered.length === 0) {
    return null;
  }

  return filtered.reduce((earliest, value) => (value.getTime() < earliest.getTime() ? value : earliest));
}

function maxDate(values: Array<Date | null | undefined>) {
  const filtered = values.filter((value): value is Date => value instanceof Date);
  if (filtered.length === 0) {
    return null;
  }

  return filtered.reduce((latest, value) => (value.getTime() > latest.getTime() ? value : latest));
}

export function buildLegacyStatusUpdateEventTitle(input: {
  contactName?: string | null;
  businessName?: string | null;
}) {
  return `${input.contactName || input.businessName || "Job"} status update`;
}

export function buildLegacyStatusUpdateNoteBody(status: CalendarEventStatus) {
  return `Job status updated to ${status.replaceAll("_", " ")}.`;
}

export function findMatchingLegacyStatusUpdateNote(input: {
  event: Pick<LegacySyntheticStatusEventCandidate, "leadId" | "status" | "createdByUserId" | "createdAt">;
  notes: LegacySyntheticStatusLeadNoteCandidate[];
}) {
  if (!input.event.leadId) {
    return false;
  }

  const expectedBody = buildLegacyStatusUpdateNoteBody(input.event.status);
  return input.notes.some(
    (note) =>
      note.leadId === input.event.leadId
      && note.createdByUserId === input.event.createdByUserId
      && note.body === expectedBody
      && isWithinLegacyStatusNoteWindow(note.createdAt, input.event.createdAt),
  );
}

export function isLegacySyntheticStatusUpdateEvent(input: {
  event: LegacySyntheticStatusEventCandidate;
  matchingLeadNote: boolean;
}) {
  const { event } = input;
  if (!event.leadId || !event.lead) {
    return false;
  }

  return (
    event.type === "JOB"
    && event.provider === "LOCAL"
    && !event.googleEventId
    && !event.googleCalendarId
    && event.createdByUserId !== null
    && event.createdByUserId === event.assignedToUserId
    && event.title === buildLegacyStatusUpdateEventTitle(event.lead)
    && isExactThirtyMinuteWindow(event.startAt, event.endAt)
    && input.matchingLeadNote
  );
}

export function isLegacySyntheticStatusUpdateEventRepairableStatus(status: CalendarEventStatus) {
  return activeBookingEventStatuses.includes(status);
}

export function hasJobScheduleMirror(input: {
  scheduledDate: Date | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  crewOrder: number | null;
}) {
  return Boolean(input.scheduledDate || input.scheduledStartTime || input.scheduledEndTime || input.crewOrder !== null);
}

export function classifyLegacyJobBookingMirrorDrift(
  input: LegacyJobBookingMirrorCandidate,
): LegacyJobBookingMirrorDrift | null {
  if (input.linkedBookingEventCount > 0) {
    return null;
  }

  const hasScheduleMirror = hasJobScheduleMirror(input);
  const hasExecutionState = dispatchExecutionWithoutBookingStatuses.includes(input.dispatchStatus);

  if (hasExecutionState) {
    return input.activeLeadBookingEventCount > 0
      ? {
          kind: "job_execution_state_needs_booking_link_backfill",
          canRepair: false,
        }
      : {
          kind: "job_execution_state_without_booking",
          canRepair: false,
        };
  }

  if (!hasScheduleMirror) {
    return null;
  }

  return input.activeLeadBookingEventCount > 0
    ? {
        kind: "job_schedule_mirror_needs_booking_link_backfill",
        canRepair: false,
      }
    : {
        kind: "orphaned_schedule_mirror_job",
        canRepair: true,
      };
}

export function deriveLegacyDraftEstimateShareRepair(
  input: LegacyDraftEstimateShareCandidate,
): LegacyDraftEstimateShareRepair | null {
  if (input.status !== "DRAFT") {
    return null;
  }

  const shareCreatedAt = minDate(input.shareLinks.map((shareLink) => shareLink.createdAt));
  const shareExpiresAt = maxDate([input.shareExpiresAt, ...input.shareLinks.map((shareLink) => shareLink.expiresAt)]);
  const viewedAt = minDate([
    input.viewedAt,
    input.customerViewedAt,
    ...input.shareLinks.flatMap((shareLink) => [shareLink.firstViewedAt, shareLink.lastViewedAt]),
  ]);
  const approvedAt = maxDate([input.approvedAt, ...input.shareLinks.map((shareLink) => shareLink.approvedAt)]);
  const declinedAt = maxDate([input.declinedAt, ...input.shareLinks.map((shareLink) => shareLink.declinedAt)]);
  const sentAt = minDate([input.sentAt, input.sharedAt, shareCreatedAt]);

  if (!sentAt && !viewedAt && !approvedAt && !declinedAt) {
    return null;
  }

  const data: Omit<LegacyDraftEstimateShareRepair["data"], "status"> & { status?: EstimateStatus } = {};

  if (!input.sharedAt && sentAt) {
    data.sharedAt = sentAt;
  }
  if (!input.sentAt && sentAt) {
    data.sentAt = sentAt;
  }
  if (!input.shareExpiresAt && shareExpiresAt) {
    data.shareExpiresAt = shareExpiresAt;
  }
  if (!input.viewedAt && viewedAt) {
    data.viewedAt = viewedAt;
  }
  if (!input.customerViewedAt && viewedAt) {
    data.customerViewedAt = viewedAt;
  }

  if (approvedAt && (!declinedAt || approvedAt.getTime() >= declinedAt.getTime())) {
    data.status = "APPROVED";
    if (!input.approvedAt) {
      data.approvedAt = approvedAt;
    }
    if (!input.customerDecisionAt) {
      data.customerDecisionAt = approvedAt;
    }

    return {
      targetStatus: "APPROVED",
      reason: "approved",
      data: data as LegacyDraftEstimateShareRepair["data"],
    };
  }

  if (declinedAt) {
    data.status = "DECLINED";
    if (!input.declinedAt) {
      data.declinedAt = declinedAt;
    }
    if (!input.customerDecisionAt) {
      data.customerDecisionAt = declinedAt;
    }

    return {
      targetStatus: "DECLINED",
      reason: "declined",
      data: data as LegacyDraftEstimateShareRepair["data"],
    };
  }

  if (viewedAt) {
    data.status = "VIEWED";
    return {
      targetStatus: "VIEWED",
      reason: "viewed",
      data: data as LegacyDraftEstimateShareRepair["data"],
    };
  }

  data.status = "SENT";
  return {
    targetStatus: "SENT",
    reason: "shared",
    data: data as LegacyDraftEstimateShareRepair["data"],
  };
}
