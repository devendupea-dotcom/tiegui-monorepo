import { prisma } from "@/lib/prisma";
import {
  mapLegacyCallToCommunicationEvent,
  mapLegacyMessageToCommunicationEvent,
  type BackfillConfidence,
  type LegacyCallBackfillRow,
  type LegacyMessageBackfillRow,
} from "@/lib/legacy-communication-backfill";

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_SAMPLE_LIMIT = 12;

type LeadConversationRef = {
  id: string;
};

type LeadRepairRef = {
  id: string;
  orgId: string;
  customerId: string | null;
  conversationState: LeadConversationRef | null;
};

type SelectedLegacyCall = Omit<
  LegacyCallBackfillRow,
  "contactId" | "conversationId"
> & {
  lead: LeadRepairRef | null;
};

type SelectedLegacyMessage = Omit<
  LegacyMessageBackfillRow,
  "contactId" | "conversationId"
> & {
  lead: LeadRepairRef | null;
};

type LegacyBackfillSample = {
  kind: "call" | "message";
  legacyId: string;
  leadId: string | null;
  contactId: string | null;
  conversationId: string | null;
  occurredAt: string;
  providerCallSid: string | null;
  providerMessageSid: string | null;
  confidence: BackfillConfidence;
  reviewReasons: string[];
};

type LegacyBackfillSectionResult = {
  totalRows: number;
  scannedRows: number;
  candidateRows: number;
  createdRows: number;
  skippedExistingRows: number;
  truncated: boolean;
  samples: LegacyBackfillSample[];
};

export type CommunicationRepairField =
  | "leadId"
  | "contactId"
  | "conversationId";

export type CommunicationEventRepairPlan = {
  canRepair: boolean;
  missingFields: CommunicationRepairField[];
  repairedFields: CommunicationRepairField[];
  unresolvedFields: CommunicationRepairField[];
  nextLeadId: string | null;
  nextContactId: string | null;
  nextConversationId: string | null;
  needsConversationCreate: boolean;
};

export type CommunicationPartialLinkageSample = {
  eventId: string;
  type: string;
  occurredAt: string;
  leadId: string | null;
  contactId: string | null;
  conversationId: string | null;
  missingFields: CommunicationRepairField[];
  repairedFields: CommunicationRepairField[];
  unresolvedFields: CommunicationRepairField[];
};

type CommunicationPartialLinkageResult = {
  totalRows: number;
  scannedRows: number;
  repairableRows: number;
  unrepairedRows: number;
  repairedRows: number;
  truncated: boolean;
  samples: CommunicationPartialLinkageSample[];
};

export type CommunicationIntegrityRepairResult = {
  orgId: string;
  mode: "preview" | "apply";
  legacyCalls: LegacyBackfillSectionResult;
  legacyMessages: LegacyBackfillSectionResult;
  partialLinkage: CommunicationPartialLinkageResult;
};

function buildPhoneLookupKey(
  orgId: string,
  phoneE164: string | null | undefined,
) {
  return phoneE164 ? `${orgId}:${phoneE164}` : null;
}

function contactPhoneForCall(call: {
  direction: "INBOUND" | "OUTBOUND";
  fromNumberE164: string;
  toNumberE164: string;
}) {
  return call.direction === "INBOUND" ? call.fromNumberE164 : call.toNumberE164;
}

function pushLimited<T>(target: T[], value: T, limit: number) {
  if (target.length >= limit) {
    return;
  }
  target.push(value);
}

async function resolveCustomerIdsByPhone(
  rows: Array<{
    orgId: string;
    phoneE164: string | null;
  }>,
) {
  const uniqueKeys = new Set(
    rows
      .map((row) => buildPhoneLookupKey(row.orgId, row.phoneE164))
      .filter((value): value is string => Boolean(value)),
  );

  if (uniqueKeys.size === 0) {
    return new Map<string, string>();
  }

  const filters = [...uniqueKeys].map((key) => {
    const [orgId, phoneE164] = key.split(":");
    return {
      orgId,
      phoneE164,
    };
  });

  const customers = await prisma.customer.findMany({
    where: {
      OR: filters,
    },
    select: {
      id: true,
      orgId: true,
      phoneE164: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const resolved = new Map<string, string>();
  for (const customer of customers) {
    const key = buildPhoneLookupKey(customer.orgId, customer.phoneE164);
    if (key && !resolved.has(key)) {
      resolved.set(key, customer.id);
    }
  }
  return resolved;
}

async function ensureConversationIdsByLead(
  leads: Array<{
    leadId: string;
    orgId: string;
  }>,
) {
  const unique = new Map<string, string>();
  for (const lead of leads) {
    if (!unique.has(lead.leadId)) {
      unique.set(lead.leadId, lead.orgId);
    }
  }

  if (unique.size === 0) {
    return new Map<string, string>();
  }

  await prisma.leadConversationState.createMany({
    data: [...unique.entries()].map(([leadId, orgId]) => ({
      orgId,
      leadId,
    })),
    skipDuplicates: true,
  });

  const states = await prisma.leadConversationState.findMany({
    where: {
      leadId: {
        in: [...unique.keys()],
      },
    },
    select: {
      id: true,
      leadId: true,
    },
  });

  return new Map(states.map((state) => [state.leadId, state.id]));
}

export function deriveCommunicationEventRepairPlan(input: {
  leadId: string | null;
  contactId: string | null;
  conversationId: string | null;
  linkedLeadId?: string | null;
  leadCustomerId?: string | null;
  leadConversationId?: string | null;
}): CommunicationEventRepairPlan {
  const missingFields: CommunicationRepairField[] = [];
  if (!input.leadId) {
    missingFields.push("leadId");
  }
  if (!input.contactId) {
    missingFields.push("contactId");
  }
  if (!input.conversationId) {
    missingFields.push("conversationId");
  }

  const nextLeadId = input.leadId || input.linkedLeadId || null;
  const nextContactId = input.contactId || input.leadCustomerId || null;
  const nextConversationId =
    input.conversationId || input.leadConversationId || null;
  const needsConversationCreate =
    !input.conversationId && Boolean(nextLeadId) && !nextConversationId;

  const repairedFields: CommunicationRepairField[] = [];
  if (!input.leadId && nextLeadId) {
    repairedFields.push("leadId");
  }
  if (!input.contactId && nextContactId) {
    repairedFields.push("contactId");
  }
  if (!input.conversationId && nextLeadId) {
    repairedFields.push("conversationId");
  }

  const unresolvedFields: CommunicationRepairField[] = [];
  if (!input.leadId && !nextLeadId) {
    unresolvedFields.push("leadId");
  }
  if (!input.contactId && !nextContactId) {
    unresolvedFields.push("contactId");
  }
  if (!input.conversationId && !nextLeadId) {
    unresolvedFields.push("conversationId");
  }

  return {
    canRepair: repairedFields.length > 0,
    missingFields,
    repairedFields,
    unresolvedFields,
    nextLeadId,
    nextContactId,
    nextConversationId,
    needsConversationCreate,
  };
}

async function collectLegacyCallBackfill(input: {
  orgId: string;
  apply: boolean;
  rowLimit?: number | null;
  sampleLimit?: number;
  batchSize?: number;
}): Promise<LegacyBackfillSectionResult> {
  const sampleLimit = input.sampleLimit || DEFAULT_SAMPLE_LIMIT;
  const batchSize = input.batchSize || DEFAULT_BATCH_SIZE;
  const where = { orgId: input.orgId };
  const totalRows = await prisma.call.count({ where });
  const samples: LegacyBackfillSample[] = [];

  let cursor: string | null = null;
  let scannedRows = 0;
  let candidateRows = 0;
  let createdRows = 0;
  let skippedExistingRows = 0;
  let truncated = false;

  while (true) {
    const remaining =
      typeof input.rowLimit === "number"
        ? Math.max(0, input.rowLimit - scannedRows)
        : batchSize;
    if (remaining === 0) {
      truncated = true;
      break;
    }

    const calls: SelectedLegacyCall[] = await prisma.call.findMany({
      where,
      take: Math.min(batchSize, remaining),
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        orgId: true,
        leadId: true,
        twilioCallSid: true,
        direction: true,
        status: true,
        fromNumberE164: true,
        toNumberE164: true,
        trackingNumberE164: true,
        landingPageUrl: true,
        utmCampaign: true,
        gclid: true,
        attributionSource: true,
        startedAt: true,
        endedAt: true,
        lead: {
          select: {
            id: true,
            orgId: true,
            customerId: true,
            conversationState: {
              select: {
                id: true,
              },
            },
          },
        },
      },
    });

    if (calls.length === 0) {
      break;
    }

    scannedRows += calls.length;

    const customerIdsByPhone = await resolveCustomerIdsByPhone(
      calls
        .filter((call) => !call.lead?.customerId)
        .map((call) => ({
          orgId: call.orgId,
          phoneE164: contactPhoneForCall(call),
        })),
    );

    const existingEvents = await prisma.communicationEvent.findMany({
      where: {
        orgId: input.orgId,
        OR: [
          {
            callId: {
              in: calls.map((call) => call.id),
            },
          },
          {
            providerCallSid: {
              in: calls
                .map((call) => call.twilioCallSid)
                .filter((value): value is string => Boolean(value)),
            },
          },
        ],
      },
      select: {
        callId: true,
        providerCallSid: true,
      },
    });

    const existingCallIds = new Set(
      existingEvents
        .map((event) => event.callId)
        .filter((value): value is string => Boolean(value)),
    );
    const existingCallSids = new Set(
      existingEvents
        .map((event) => event.providerCallSid)
        .filter((value): value is string => Boolean(value)),
    );

    const leadIdsNeedingConversation = calls
      .filter(
        (call) =>
          call.lead?.id &&
          !call.lead.conversationState?.id &&
          !existingCallIds.has(call.id) &&
          !(call.twilioCallSid && existingCallSids.has(call.twilioCallSid)),
      )
      .map((call) => ({
        leadId: call.lead!.id,
        orgId: call.lead!.orgId,
      }));
    const createdConversationIdsByLead =
      input.apply && leadIdsNeedingConversation.length > 0
        ? await ensureConversationIdsByLead(leadIdsNeedingConversation)
        : new Map<string, string>();

    const operations = [];
    for (const call of calls) {
      if (
        existingCallIds.has(call.id) ||
        (call.twilioCallSid && existingCallSids.has(call.twilioCallSid))
      ) {
        skippedExistingRows += 1;
        continue;
      }

      candidateRows += 1;

      const contactId =
        call.lead?.customerId ||
        customerIdsByPhone.get(
          buildPhoneLookupKey(call.orgId, contactPhoneForCall(call)) || "",
        ) ||
        null;
      const conversationId =
        call.lead?.conversationState?.id ||
        (call.lead?.id
          ? createdConversationIdsByLead.get(call.lead.id)
          : null) ||
        null;

      const mapped = mapLegacyCallToCommunicationEvent({
        id: call.id,
        orgId: call.orgId,
        leadId: call.leadId,
        contactId,
        conversationId,
        twilioCallSid: call.twilioCallSid,
        direction: call.direction,
        status: call.status,
        fromNumberE164: call.fromNumberE164,
        toNumberE164: call.toNumberE164,
        trackingNumberE164: call.trackingNumberE164,
        landingPageUrl: call.landingPageUrl,
        utmCampaign: call.utmCampaign,
        gclid: call.gclid,
        attributionSource: `${call.attributionSource}`,
        startedAt: call.startedAt,
        endedAt: call.endedAt,
      } satisfies LegacyCallBackfillRow);

      pushLimited(
        samples,
        {
          kind: "call",
          legacyId: call.id,
          leadId: call.leadId,
          contactId,
          conversationId,
          occurredAt: call.startedAt.toISOString(),
          providerCallSid: call.twilioCallSid,
          providerMessageSid: null,
          confidence: mapped.confidence,
          reviewReasons: mapped.reviewReasons,
        },
        sampleLimit,
      );

      if (!input.apply) {
        continue;
      }

      operations.push(
        prisma.communicationEvent.upsert({
          where: {
            orgId_idempotencyKey: {
              orgId: call.orgId,
              idempotencyKey: mapped.idempotencyKey,
            },
          },
          update: {
            leadId: call.leadId,
            contactId,
            conversationId,
            callId: call.id,
            type: mapped.type,
            channel: mapped.channel,
            occurredAt: mapped.occurredAt,
            summary: mapped.summary,
            metadataJson: mapped.metadataJson,
            provider: mapped.provider,
            providerCallSid: mapped.providerCallSid,
            providerStatus: mapped.providerStatus,
          },
          create: {
            orgId: call.orgId,
            leadId: call.leadId,
            contactId,
            conversationId,
            callId: call.id,
            type: mapped.type,
            channel: mapped.channel,
            occurredAt: mapped.occurredAt,
            summary: mapped.summary,
            metadataJson: mapped.metadataJson,
            provider: mapped.provider,
            providerCallSid: mapped.providerCallSid,
            providerStatus: mapped.providerStatus,
            idempotencyKey: mapped.idempotencyKey,
          },
        }),
      );
    }

    if (operations.length > 0) {
      const results = await prisma.$transaction(operations);
      createdRows += results.length;
    }

    cursor = calls[calls.length - 1]?.id || null;
  }

  return {
    totalRows,
    scannedRows,
    candidateRows,
    createdRows,
    skippedExistingRows,
    truncated,
    samples,
  };
}

async function collectLegacyMessageBackfill(input: {
  orgId: string;
  apply: boolean;
  rowLimit?: number | null;
  sampleLimit?: number;
  batchSize?: number;
}): Promise<LegacyBackfillSectionResult> {
  const sampleLimit = input.sampleLimit || DEFAULT_SAMPLE_LIMIT;
  const batchSize = input.batchSize || DEFAULT_BATCH_SIZE;
  const where = { orgId: input.orgId };
  const totalRows = await prisma.message.count({ where });
  const samples: LegacyBackfillSample[] = [];

  let cursor: string | null = null;
  let scannedRows = 0;
  let candidateRows = 0;
  let createdRows = 0;
  let skippedExistingRows = 0;
  let truncated = false;

  while (true) {
    const remaining =
      typeof input.rowLimit === "number"
        ? Math.max(0, input.rowLimit - scannedRows)
        : batchSize;
    if (remaining === 0) {
      truncated = true;
      break;
    }

    const messages: SelectedLegacyMessage[] = await prisma.message.findMany({
      where,
      take: Math.min(batchSize, remaining),
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        orgId: true,
        leadId: true,
        direction: true,
        type: true,
        fromNumberE164: true,
        toNumberE164: true,
        body: true,
        provider: true,
        providerMessageSid: true,
        status: true,
        createdAt: true,
        lead: {
          select: {
            id: true,
            orgId: true,
            customerId: true,
            conversationState: {
              select: {
                id: true,
              },
            },
          },
        },
      },
    });

    if (messages.length === 0) {
      break;
    }

    scannedRows += messages.length;

    const customerIdsByPhone = await resolveCustomerIdsByPhone(
      messages
        .filter((message) => !message.lead?.customerId)
        .map((message) => ({
          orgId: message.orgId,
          phoneE164:
            message.direction === "INBOUND"
              ? message.fromNumberE164
              : message.toNumberE164,
        })),
    );

    const existingEvents = await prisma.communicationEvent.findMany({
      where: {
        orgId: input.orgId,
        OR: [
          {
            messageId: {
              in: messages.map((message) => message.id),
            },
          },
          {
            providerMessageSid: {
              in: messages
                .map((message) => message.providerMessageSid)
                .filter((value): value is string => Boolean(value)),
            },
          },
        ],
      },
      select: {
        messageId: true,
        providerMessageSid: true,
      },
    });

    const existingMessageIds = new Set(
      existingEvents
        .map((event) => event.messageId)
        .filter((value): value is string => Boolean(value)),
    );
    const existingMessageSids = new Set(
      existingEvents
        .map((event) => event.providerMessageSid)
        .filter((value): value is string => Boolean(value)),
    );

    const leadIdsNeedingConversation = messages
      .filter(
        (message) =>
          message.lead?.id &&
          !message.lead.conversationState?.id &&
          !existingMessageIds.has(message.id) &&
          !(
            message.providerMessageSid &&
            existingMessageSids.has(message.providerMessageSid)
          ),
      )
      .map((message) => ({
        leadId: message.lead!.id,
        orgId: message.lead!.orgId,
      }));
    const createdConversationIdsByLead =
      input.apply && leadIdsNeedingConversation.length > 0
        ? await ensureConversationIdsByLead(leadIdsNeedingConversation)
        : new Map<string, string>();

    const operations = [];
    for (const message of messages) {
      if (
        existingMessageIds.has(message.id) ||
        (message.providerMessageSid &&
          existingMessageSids.has(message.providerMessageSid))
      ) {
        skippedExistingRows += 1;
        continue;
      }

      candidateRows += 1;

      const contactId =
        message.lead?.customerId ||
        customerIdsByPhone.get(
          buildPhoneLookupKey(
            message.orgId,
            message.direction === "INBOUND"
              ? message.fromNumberE164
              : message.toNumberE164,
          ) || "",
        ) ||
        null;
      const conversationId =
        message.lead?.conversationState?.id ||
        (message.lead?.id
          ? createdConversationIdsByLead.get(message.lead.id)
          : null) ||
        null;

      const mapped = mapLegacyMessageToCommunicationEvent({
        id: message.id,
        orgId: message.orgId,
        leadId: message.leadId,
        contactId,
        conversationId,
        direction: message.direction,
        type: message.type,
        fromNumberE164: message.fromNumberE164,
        toNumberE164: message.toNumberE164,
        body: message.body,
        provider: message.provider,
        providerMessageSid: message.providerMessageSid,
        status: message.status,
        createdAt: message.createdAt,
      } satisfies LegacyMessageBackfillRow);

      pushLimited(
        samples,
        {
          kind: "message",
          legacyId: message.id,
          leadId: message.leadId,
          contactId,
          conversationId,
          occurredAt: message.createdAt.toISOString(),
          providerCallSid: null,
          providerMessageSid: message.providerMessageSid,
          confidence: mapped.confidence,
          reviewReasons: mapped.reviewReasons,
        },
        sampleLimit,
      );

      if (!input.apply) {
        continue;
      }

      operations.push(
        prisma.communicationEvent.upsert({
          where: {
            orgId_idempotencyKey: {
              orgId: message.orgId,
              idempotencyKey: mapped.idempotencyKey,
            },
          },
          update: {
            leadId: message.leadId,
            contactId,
            conversationId,
            messageId: message.id,
            type: mapped.type,
            channel: mapped.channel,
            occurredAt: mapped.occurredAt,
            summary: mapped.summary,
            metadataJson: mapped.metadataJson,
            provider: mapped.provider,
            providerMessageSid: mapped.providerMessageSid,
            providerStatus: mapped.providerStatus,
          },
          create: {
            orgId: message.orgId,
            leadId: message.leadId,
            contactId,
            conversationId,
            messageId: message.id,
            type: mapped.type,
            channel: mapped.channel,
            occurredAt: mapped.occurredAt,
            summary: mapped.summary,
            metadataJson: mapped.metadataJson,
            provider: mapped.provider,
            providerMessageSid: mapped.providerMessageSid,
            providerStatus: mapped.providerStatus,
            idempotencyKey: mapped.idempotencyKey,
          },
        }),
      );
    }

    if (operations.length > 0) {
      const results = await prisma.$transaction(operations);
      createdRows += results.length;
    }

    cursor = messages[messages.length - 1]?.id || null;
  }

  return {
    totalRows,
    scannedRows,
    candidateRows,
    createdRows,
    skippedExistingRows,
    truncated,
    samples,
  };
}

async function collectPartialLinkageRepairs(input: {
  orgId: string;
  apply: boolean;
  rowLimit?: number | null;
  sampleLimit?: number;
  batchSize?: number;
}): Promise<CommunicationPartialLinkageResult> {
  const sampleLimit = input.sampleLimit || DEFAULT_SAMPLE_LIMIT;
  const batchSize = input.batchSize || DEFAULT_BATCH_SIZE;
  const where = {
    orgId: input.orgId,
    OR: [{ leadId: null }, { contactId: null }, { conversationId: null }],
  };
  const totalRows = await prisma.communicationEvent.count({ where });
  const samples: CommunicationPartialLinkageSample[] = [];

  let cursor: string | null = null;
  let scannedRows = 0;
  let repairableRows = 0;
  let unrepairedRows = 0;
  let repairedRows = 0;
  let truncated = false;

  while (true) {
    const remaining =
      typeof input.rowLimit === "number"
        ? Math.max(0, input.rowLimit - scannedRows)
        : batchSize;
    if (remaining === 0) {
      truncated = true;
      break;
    }

    const events: Array<{
      id: string;
      orgId: string;
      type: string;
      occurredAt: Date;
      leadId: string | null;
      contactId: string | null;
      conversationId: string | null;
      callId: string | null;
      messageId: string | null;
      providerCallSid: string | null;
      providerMessageSid: string | null;
    }> = await prisma.communicationEvent.findMany({
      where,
      take: Math.min(batchSize, remaining),
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        orgId: true,
        type: true,
        occurredAt: true,
        leadId: true,
        contactId: true,
        conversationId: true,
        callId: true,
        messageId: true,
        providerCallSid: true,
        providerMessageSid: true,
      },
    });

    if (events.length === 0) {
      break;
    }

    scannedRows += events.length;

    const messageIds = events
      .map((event) => event.messageId)
      .filter((value): value is string => Boolean(value));
    const providerMessageSids = events
      .map((event) => event.providerMessageSid)
      .filter((value): value is string => Boolean(value));
    const callIds = events
      .map((event) => event.callId)
      .filter((value): value is string => Boolean(value));
    const providerCallSids = events
      .map((event) => event.providerCallSid)
      .filter((value): value is string => Boolean(value));

    const [messages, calls] = await Promise.all([
      messageIds.length > 0 || providerMessageSids.length > 0
        ? prisma.message.findMany({
            where: {
              orgId: input.orgId,
              OR: [
                ...(messageIds.length > 0 ? [{ id: { in: messageIds } }] : []),
                ...(providerMessageSids.length > 0
                  ? [{ providerMessageSid: { in: providerMessageSids } }]
                  : []),
              ],
            },
            select: {
              id: true,
              leadId: true,
              providerMessageSid: true,
            },
          })
        : Promise.resolve([]),
      callIds.length > 0 || providerCallSids.length > 0
        ? prisma.call.findMany({
            where: {
              orgId: input.orgId,
              OR: [
                ...(callIds.length > 0 ? [{ id: { in: callIds } }] : []),
                ...(providerCallSids.length > 0
                  ? [{ twilioCallSid: { in: providerCallSids } }]
                  : []),
              ],
            },
            select: {
              id: true,
              leadId: true,
              twilioCallSid: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const leadIds = new Set<string>();
    const messageLeadById = new Map<string, string>();
    const messageLeadBySid = new Map<string, string>();
    const callLeadById = new Map<string, string>();
    const callLeadBySid = new Map<string, string>();

    for (const message of messages) {
      if (!message.leadId) {
        continue;
      }
      leadIds.add(message.leadId);
      messageLeadById.set(message.id, message.leadId);
      if (message.providerMessageSid) {
        messageLeadBySid.set(message.providerMessageSid, message.leadId);
      }
    }

    for (const call of calls) {
      if (!call.leadId) {
        continue;
      }
      leadIds.add(call.leadId);
      callLeadById.set(call.id, call.leadId);
      if (call.twilioCallSid) {
        callLeadBySid.set(call.twilioCallSid, call.leadId);
      }
    }

    for (const event of events) {
      if (event.leadId) {
        leadIds.add(event.leadId);
      }
    }

    const leads =
      leadIds.size > 0
        ? await prisma.lead.findMany({
            where: {
              id: {
                in: [...leadIds],
              },
            },
            select: {
              id: true,
              orgId: true,
              customerId: true,
              conversationState: {
                select: {
                  id: true,
                },
              },
            },
          })
        : [];

    const leadById = new Map(leads.map((lead) => [lead.id, lead]));

    const leadsNeedingConversation = [];
    const plansByEventId = new Map<
      string,
      {
        plan: CommunicationEventRepairPlan;
        resolvedLead: LeadRepairRef | null;
      }
    >();

    for (const event of events) {
      const linkedLeadId =
        messageLeadById.get(event.messageId || "") ||
        messageLeadBySid.get(event.providerMessageSid || "") ||
        callLeadById.get(event.callId || "") ||
        callLeadBySid.get(event.providerCallSid || "") ||
        null;
      const resolvedLead =
        leadById.get(event.leadId || linkedLeadId || "") || null;
      const plan = deriveCommunicationEventRepairPlan({
        leadId: event.leadId,
        contactId: event.contactId,
        conversationId: event.conversationId,
        linkedLeadId,
        leadCustomerId: resolvedLead?.customerId || null,
        leadConversationId: resolvedLead?.conversationState?.id || null,
      });

      plansByEventId.set(event.id, { plan, resolvedLead });

      if (plan.canRepair) {
        repairableRows += 1;
        if (plan.needsConversationCreate && plan.nextLeadId && resolvedLead) {
          leadsNeedingConversation.push({
            leadId: plan.nextLeadId,
            orgId: resolvedLead.orgId,
          });
        }
      } else {
        unrepairedRows += 1;
      }

      pushLimited(
        samples,
        {
          eventId: event.id,
          type: event.type,
          occurredAt: event.occurredAt.toISOString(),
          leadId: event.leadId,
          contactId: event.contactId,
          conversationId: event.conversationId,
          missingFields: plan.missingFields,
          repairedFields: plan.repairedFields,
          unresolvedFields: plan.unresolvedFields,
        },
        sampleLimit,
      );
    }

    const ensuredConversationIdsByLead =
      input.apply && leadsNeedingConversation.length > 0
        ? await ensureConversationIdsByLead(leadsNeedingConversation)
        : new Map<string, string>();

    if (input.apply) {
      for (const event of events) {
        const entry = plansByEventId.get(event.id);
        if (!entry || !entry.plan.canRepair) {
          continue;
        }

        const resolvedConversationId =
          entry.plan.nextConversationId ||
          (entry.plan.nextLeadId
            ? ensuredConversationIdsByLead.get(entry.plan.nextLeadId) || null
            : null);

        const data: Record<string, string> = {};
        if (!event.leadId && entry.plan.nextLeadId) {
          data.leadId = entry.plan.nextLeadId;
        }
        if (!event.contactId && entry.plan.nextContactId) {
          data.contactId = entry.plan.nextContactId;
        }
        if (!event.conversationId && resolvedConversationId) {
          data.conversationId = resolvedConversationId;
        }

        if (Object.keys(data).length === 0) {
          continue;
        }

        await prisma.communicationEvent.update({
          where: { id: event.id },
          data,
        });
        repairedRows += 1;
      }
    }

    cursor = events[events.length - 1]?.id || null;
  }

  return {
    totalRows,
    scannedRows,
    repairableRows,
    unrepairedRows,
    repairedRows,
    truncated,
    samples,
  };
}

export async function runCommunicationIntegrityRepair(input: {
  orgId: string;
  apply?: boolean;
  rowLimit?: number | null;
  sampleLimit?: number;
  batchSize?: number;
}): Promise<CommunicationIntegrityRepairResult> {
  const apply = Boolean(input.apply);

  const [legacyCalls, legacyMessages, partialLinkage] = await Promise.all([
    collectLegacyCallBackfill({
      orgId: input.orgId,
      apply,
      rowLimit: input.rowLimit,
      sampleLimit: input.sampleLimit,
      batchSize: input.batchSize,
    }),
    collectLegacyMessageBackfill({
      orgId: input.orgId,
      apply,
      rowLimit: input.rowLimit,
      sampleLimit: input.sampleLimit,
      batchSize: input.batchSize,
    }),
    collectPartialLinkageRepairs({
      orgId: input.orgId,
      apply,
      rowLimit: input.rowLimit,
      sampleLimit: input.sampleLimit,
      batchSize: input.batchSize,
    }),
  ]);

  return {
    orgId: input.orgId,
    mode: apply ? "apply" : "preview",
    legacyCalls,
    legacyMessages,
    partialLinkage,
  };
}
