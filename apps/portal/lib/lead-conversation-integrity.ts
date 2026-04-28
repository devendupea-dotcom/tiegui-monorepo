import type { Prisma } from "@prisma/client";
import { isBookingEventType as isLeadBookingEvent } from "@/lib/booking-read-model";
import { prisma } from "@/lib/prisma";

const INBOUND_CONVERSATION_EVENT_TYPES = ["INBOUND_SMS_RECEIVED", "INBOUND_CALL_RECEIVED", "VOICEMAIL_LEFT"] as const;
const OUTBOUND_CONVERSATION_EVENT_TYPES = ["OUTBOUND_SMS_SENT"] as const;

export const leadConversationIntegrityStateSelect = {
  id: true,
  orgId: true,
  leadId: true,
  stage: true,
  lastInboundAt: true,
  lastOutboundAt: true,
  bookedCalendarEventId: true,
  bookedStartAt: true,
  bookedEndAt: true,
} satisfies Prisma.LeadConversationStateSelect;

export const leadConversationIntegrityEventSelect = {
  id: true,
  orgId: true,
  leadId: true,
  type: true,
  status: true,
  startAt: true,
  endAt: true,
} satisfies Prisma.EventSelect;

export type LeadConversationIntegrityStateRecord = Prisma.LeadConversationStateGetPayload<{
  select: typeof leadConversationIntegrityStateSelect;
}>;

export type LeadConversationIntegrityEventRecord = Prisma.EventGetPayload<{
  select: typeof leadConversationIntegrityEventSelect;
}>;

export type LeadConversationIntegrityIssueKind =
  | "booked_stage_missing_event_snapshot"
  | "booked_snapshot_event_missing"
  | "booked_snapshot_event_lead_mismatch"
  | "booked_snapshot_event_not_booking"
  | "booked_snapshot_time_mismatch"
  | "conversation_last_inbound_stale"
  | "conversation_last_outbound_stale"
  | "communication_event_missing_conversation_link";

export type LeadConversationIntegrityIssue = {
  kind: LeadConversationIntegrityIssueKind;
  orgId: string;
  stateId: string;
  leadId: string;
  stage: string;
  bookedCalendarEventId: string | null;
  currentBookedStartAt: Date | null;
  currentBookedEndAt: Date | null;
  eventId?: string | null;
  eventLeadId?: string | null;
  eventType?: string | null;
  eventStatus?: string | null;
  eventStartAt?: Date | null;
  eventEndAt?: Date | null;
  latestInboundAt?: Date | null;
  latestOutboundAt?: Date | null;
  missingConversationLinkCount?: number;
  latestMissingConversationLinkAt?: Date | null;
};

export type LeadConversationIntegrityDiagnostics = {
  scannedStates: number;
  repairableSnapshots: number;
  countsByKind: Array<{
    kind: LeadConversationIntegrityIssueKind;
    count: number;
  }>;
  samples: LeadConversationIntegrityIssue[];
};

export type LeadConversationIntegrityRepairResult = {
  scannedStates: number;
  repairableSnapshots: number;
  repairedSnapshots: number;
  samples: Array<{
    stateId: string;
    leadId: string;
    bookedCalendarEventId: string;
    bookedStartAt: Date;
    bookedEndAt: Date | null;
  }>;
};

export type ConservativeBookedSnapshotRepair = {
  canRepair: boolean;
  bookedCalendarEventId: string | null;
  bookedStartAt: Date | null;
  bookedEndAt: Date | null;
  reason: "event_match" | "none";
};

type LeadConversationCommunicationSnapshot = {
  latestInboundAt: Date | null;
  latestOutboundAt: Date | null;
  missingConversationLinkCount: number;
  latestMissingConversationLinkAt: Date | null;
};

function sameTimestamp(left: Date | null, right: Date | null) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return left.getTime() === right.getTime();
}

export function resolveConservativeBookedSnapshotRepair(input: {
  state: LeadConversationIntegrityStateRecord;
  bookedEvent: LeadConversationIntegrityEventRecord | null;
}): ConservativeBookedSnapshotRepair {
  const { state, bookedEvent } = input;

  if (
    state.bookedCalendarEventId
    && bookedEvent
    && bookedEvent.leadId === state.leadId
    && isLeadBookingEvent(bookedEvent.type)
    && (!sameTimestamp(state.bookedStartAt, bookedEvent.startAt) || !sameTimestamp(state.bookedEndAt, bookedEvent.endAt))
  ) {
    return {
      canRepair: true,
      bookedCalendarEventId: bookedEvent.id,
      bookedStartAt: bookedEvent.startAt,
      bookedEndAt: bookedEvent.endAt,
      reason: "event_match",
    };
  }

  return {
    canRepair: false,
    bookedCalendarEventId: state.bookedCalendarEventId,
    bookedStartAt: state.bookedStartAt,
    bookedEndAt: state.bookedEndAt,
    reason: "none",
  };
}

export function analyzeLeadConversationIntegrity(input: {
  state: LeadConversationIntegrityStateRecord;
  bookedEvent: LeadConversationIntegrityEventRecord | null;
  communication: LeadConversationCommunicationSnapshot;
}): {
  issues: LeadConversationIntegrityIssue[];
  repair: ConservativeBookedSnapshotRepair;
} {
  const { state, bookedEvent, communication } = input;
  const issues: LeadConversationIntegrityIssue[] = [];
  const repair = resolveConservativeBookedSnapshotRepair({
    state,
    bookedEvent,
  });

  const baseIssue = {
    orgId: state.orgId,
    stateId: state.id,
    leadId: state.leadId,
    stage: state.stage,
    bookedCalendarEventId: state.bookedCalendarEventId,
    currentBookedStartAt: state.bookedStartAt,
    currentBookedEndAt: state.bookedEndAt,
  };

  if (state.stage === "BOOKED" && !state.bookedCalendarEventId) {
    issues.push({
      ...baseIssue,
      kind: "booked_stage_missing_event_snapshot",
    });
  }

  if (state.bookedCalendarEventId && !bookedEvent) {
    issues.push({
      ...baseIssue,
      kind: "booked_snapshot_event_missing",
      eventId: state.bookedCalendarEventId,
    });
  }

  if (state.bookedCalendarEventId && bookedEvent) {
    if (bookedEvent.leadId !== state.leadId) {
      issues.push({
        ...baseIssue,
        kind: "booked_snapshot_event_lead_mismatch",
        eventId: bookedEvent.id,
        eventLeadId: bookedEvent.leadId,
        eventType: bookedEvent.type,
        eventStatus: bookedEvent.status,
      });
    }

    if (!isLeadBookingEvent(bookedEvent.type)) {
      issues.push({
        ...baseIssue,
        kind: "booked_snapshot_event_not_booking",
        eventId: bookedEvent.id,
        eventLeadId: bookedEvent.leadId,
        eventType: bookedEvent.type,
        eventStatus: bookedEvent.status,
      });
    }

    if (!sameTimestamp(state.bookedStartAt, bookedEvent.startAt) || !sameTimestamp(state.bookedEndAt, bookedEvent.endAt)) {
      issues.push({
        ...baseIssue,
        kind: "booked_snapshot_time_mismatch",
        eventId: bookedEvent.id,
        eventLeadId: bookedEvent.leadId,
        eventType: bookedEvent.type,
        eventStatus: bookedEvent.status,
        eventStartAt: bookedEvent.startAt,
        eventEndAt: bookedEvent.endAt,
      });
    }
  }

  if (
    communication.latestInboundAt
    && (!state.lastInboundAt || communication.latestInboundAt.getTime() > state.lastInboundAt.getTime())
  ) {
    issues.push({
      ...baseIssue,
      kind: "conversation_last_inbound_stale",
      latestInboundAt: communication.latestInboundAt,
    });
  }

  if (
    communication.latestOutboundAt
    && (!state.lastOutboundAt || communication.latestOutboundAt.getTime() > state.lastOutboundAt.getTime())
  ) {
    issues.push({
      ...baseIssue,
      kind: "conversation_last_outbound_stale",
      latestOutboundAt: communication.latestOutboundAt,
    });
  }

  if (communication.missingConversationLinkCount > 0) {
    issues.push({
      ...baseIssue,
      kind: "communication_event_missing_conversation_link",
      missingConversationLinkCount: communication.missingConversationLinkCount,
      latestMissingConversationLinkAt: communication.latestMissingConversationLinkAt,
    });
  }

  return {
    issues,
    repair,
  };
}

function issueSort(left: LeadConversationIntegrityIssueKind, right: LeadConversationIntegrityIssueKind) {
  return left.localeCompare(right);
}

async function scanLeadConversationStates(input: {
  orgId?: string | null;
  limit: number;
  onState: (
    state: LeadConversationIntegrityStateRecord,
    related: {
      bookedEvent: LeadConversationIntegrityEventRecord | null;
      communication: LeadConversationCommunicationSnapshot;
    },
  ) => Promise<void> | void;
}) {
  let cursor: string | null = null;
  let scannedStates = 0;
  const batchSize = 100;

  while (scannedStates < input.limit) {
    const remaining = input.limit - scannedStates;
    const states: LeadConversationIntegrityStateRecord[] = await prisma.leadConversationState.findMany({
      where: {
        ...(input.orgId ? { orgId: input.orgId } : {}),
      },
      orderBy: [{ id: "asc" }],
      take: Math.min(batchSize, remaining),
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
      select: leadConversationIntegrityStateSelect,
    });

    if (states.length === 0) {
      break;
    }

    cursor = states[states.length - 1]?.id || null;
    const eventIds = [...new Set(states.map((state) => state.bookedCalendarEventId).filter((value): value is string => Boolean(value)))];
    const leadIds = [...new Set(states.map((state) => state.leadId))];

    const [events, latestInboundRows, latestOutboundRows, missingConversationLinkRows] = await Promise.all([
      eventIds.length > 0
        ? prisma.event.findMany({
            where: {
              id: { in: eventIds },
            },
            select: leadConversationIntegrityEventSelect,
          })
        : Promise.resolve([]),
      leadIds.length > 0
        ? prisma.communicationEvent.groupBy({
            by: ["orgId", "leadId"],
            where: {
              ...(input.orgId ? { orgId: input.orgId } : {}),
              leadId: { in: leadIds },
              type: { in: [...INBOUND_CONVERSATION_EVENT_TYPES] },
            },
            _max: {
              occurredAt: true,
            },
          })
        : Promise.resolve([]),
      leadIds.length > 0
        ? prisma.communicationEvent.groupBy({
            by: ["orgId", "leadId"],
            where: {
              ...(input.orgId ? { orgId: input.orgId } : {}),
              leadId: { in: leadIds },
              type: { in: [...OUTBOUND_CONVERSATION_EVENT_TYPES] },
            },
            _max: {
              occurredAt: true,
            },
          })
        : Promise.resolve([]),
      leadIds.length > 0
        ? prisma.communicationEvent.groupBy({
            by: ["orgId", "leadId"],
            where: {
              ...(input.orgId ? { orgId: input.orgId } : {}),
              leadId: { in: leadIds },
              conversationId: null,
            },
            _count: {
              _all: true,
            },
            _max: {
              occurredAt: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const eventMap = new Map(events.map((event) => [event.id, event]));
    const inboundMap = new Map(
      latestInboundRows.map((row) => [`${row.orgId}:${row.leadId}`, row._max.occurredAt || null]),
    );
    const outboundMap = new Map(
      latestOutboundRows.map((row) => [`${row.orgId}:${row.leadId}`, row._max.occurredAt || null]),
    );
    const missingConversationLinkMap = new Map(
      missingConversationLinkRows.map((row) => [
        `${row.orgId}:${row.leadId}`,
        {
          count: row._count._all,
          latestOccurredAt: row._max.occurredAt || null,
        },
      ]),
    );

    for (const state of states) {
      scannedStates += 1;
      const key = `${state.orgId}:${state.leadId}`;
      const missingConversationLink = missingConversationLinkMap.get(key);
      await input.onState(state, {
        bookedEvent: state.bookedCalendarEventId ? eventMap.get(state.bookedCalendarEventId) || null : null,
        communication: {
          latestInboundAt: inboundMap.get(key) || null,
          latestOutboundAt: outboundMap.get(key) || null,
          missingConversationLinkCount: missingConversationLink?.count || 0,
          latestMissingConversationLinkAt: missingConversationLink?.latestOccurredAt || null,
        },
      });
    }
  }

  return {
    scannedStates,
  };
}

export async function getLeadConversationIntegrityDiagnostics(input: {
  orgId?: string | null;
  limit?: number;
  sampleLimit?: number;
}): Promise<LeadConversationIntegrityDiagnostics> {
  const limit = Math.max(1, Math.min(5000, input.limit || 500));
  const sampleLimit = Math.max(1, Math.min(100, input.sampleLimit || 25));
  const counts = new Map<LeadConversationIntegrityIssueKind, number>();
  const samples: LeadConversationIntegrityIssue[] = [];
  let repairableSnapshots = 0;

  const { scannedStates } = await scanLeadConversationStates({
    orgId: input.orgId || null,
    limit,
    onState(state, related) {
      const analysis = analyzeLeadConversationIntegrity({
        state,
        bookedEvent: related.bookedEvent,
        communication: related.communication,
      });

      if (analysis.repair.canRepair) {
        repairableSnapshots += 1;
      }

      for (const issue of analysis.issues) {
        counts.set(issue.kind, (counts.get(issue.kind) || 0) + 1);
        if (samples.length < sampleLimit) {
          samples.push(issue);
        }
      }
    },
  });

  return {
    scannedStates,
    repairableSnapshots,
    countsByKind: [...counts.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((left, right) => issueSort(left.kind, right.kind)),
    samples,
  };
}

export async function repairLeadConversationBookedSnapshots(input: {
  orgId?: string | null;
  limit?: number;
  sampleLimit?: number;
  apply?: boolean;
}): Promise<LeadConversationIntegrityRepairResult> {
  const limit = Math.max(1, Math.min(5000, input.limit || 500));
  const sampleLimit = Math.max(1, Math.min(100, input.sampleLimit || 25));
  const apply = input.apply === true;
  let repairableSnapshots = 0;
  let repairedSnapshots = 0;
  const samples: LeadConversationIntegrityRepairResult["samples"] = [];

  const { scannedStates } = await scanLeadConversationStates({
    orgId: input.orgId || null,
    limit,
    async onState(state, related) {
      const repair = resolveConservativeBookedSnapshotRepair({
        state,
        bookedEvent: related.bookedEvent,
      });

      if (!repair.canRepair || !repair.bookedCalendarEventId || !repair.bookedStartAt) {
        return;
      }

      repairableSnapshots += 1;
      if (samples.length < sampleLimit) {
        samples.push({
          stateId: state.id,
          leadId: state.leadId,
          bookedCalendarEventId: repair.bookedCalendarEventId,
          bookedStartAt: repair.bookedStartAt,
          bookedEndAt: repair.bookedEndAt,
        });
      }

      if (!apply) {
        return;
      }

      const updated = await prisma.leadConversationState.updateMany({
        where: {
          id: state.id,
          orgId: state.orgId,
          leadId: state.leadId,
          bookedCalendarEventId: repair.bookedCalendarEventId,
        },
        data: {
          bookedStartAt: repair.bookedStartAt,
          bookedEndAt: repair.bookedEndAt,
        },
      });

      if (updated.count === 1) {
        repairedSnapshots += 1;
      }
    },
  });

  return {
    scannedStates,
    repairableSnapshots,
    repairedSnapshots,
    samples,
  };
}
