import type { LegacyCallBackfillRow, LegacyMessageBackfillRow } from "../lib/legacy-communication-backfill";
import { loadPrismaEnv } from "./load-prisma-env.mjs";

loadPrismaEnv();

const BATCH_SIZE = 100;
const { PrismaClient } = await import("@prisma/client");
const { mapLegacyCallToCommunicationEvent, mapLegacyMessageToCommunicationEvent } = await import(
  new URL("../lib/legacy-communication-backfill.ts", import.meta.url).href
);
const prisma = new PrismaClient({
  ...(process.env.DATABASE_URL ? { datasources: { db: { url: process.env.DATABASE_URL } } } : {}),
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
});

type SelectedLegacyCall = Omit<LegacyCallBackfillRow, "contactId" | "conversationId"> & {
  lead: {
    customerId: string | null;
    conversationState: {
      id: string;
    } | null;
  } | null;
};

type SelectedLegacyMessage = Omit<LegacyMessageBackfillRow, "contactId" | "conversationId"> & {
  lead: {
    customerId: string | null;
    conversationState: {
      id: string;
    } | null;
  } | null;
};

function buildPhoneLookupKey(orgId: string, phoneE164: string | null | undefined) {
  return phoneE164 ? `${orgId}:${phoneE164}` : null;
}

function contactPhoneForCall(call: {
  direction: "INBOUND" | "OUTBOUND";
  fromNumberE164: string;
  toNumberE164: string;
}) {
  return call.direction === "INBOUND" ? call.fromNumberE164 : call.toNumberE164;
}

function logReview(kind: "call" | "message", id: string, reasons: string[]) {
  if (!reasons.length) return;
  console.warn(`[backfill:communication-events] review ${kind}=${id} ${reasons.join(" | ")}`);
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

async function backfillCalls() {
  const total = await prisma.call.count();
  let cursor: string | null = null;
  let processed = 0;
  let created = 0;
  let skipped = 0;

  while (true) {
    const calls: SelectedLegacyCall[] = await prisma.call.findMany({
      take: BATCH_SIZE,
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

    const customerIdsByPhone = await resolveCustomerIdsByPhone(
      calls
        .filter((call) => !call.lead?.customerId)
        .map((call) => ({
          orgId: call.orgId,
          phoneE164: contactPhoneForCall(call),
        })),
    );

    const existingEvents: Array<{
      callId: string | null;
      providerCallSid: string | null;
    }> = await prisma.communicationEvent.findMany({
      where: {
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
      existingEvents.map((event) => event.callId).filter((value): value is string => Boolean(value)),
    );
    const existingCallSids = new Set(
      existingEvents.map((event) => event.providerCallSid).filter((value): value is string => Boolean(value)),
    );

    const operations = [];
    for (const call of calls) {
      processed += 1;

      if (existingCallIds.has(call.id) || (call.twilioCallSid && existingCallSids.has(call.twilioCallSid))) {
        skipped += 1;
        continue;
      }

      const contactId =
        call.lead?.customerId ||
        customerIdsByPhone.get(buildPhoneLookupKey(call.orgId, contactPhoneForCall(call)) || "") ||
        null;
      const conversationId = call.lead?.conversationState?.id || null;

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

      if (mapped.confidence !== "high") {
        logReview("call", call.id, mapped.reviewReasons);
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
      created += results.length;
    }

    cursor = calls[calls.length - 1]?.id || null;
    console.info(
      `[backfill:communication-events] calls processed=${processed}/${total} created=${created} skipped=${skipped}`,
    );
  }

  return { total, processed, created, skipped };
}

async function backfillMessages() {
  const total = await prisma.message.count();
  let cursor: string | null = null;
  let processed = 0;
  let created = 0;
  let skipped = 0;

  while (true) {
    const messages: SelectedLegacyMessage[] = await prisma.message.findMany({
      take: BATCH_SIZE,
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

    const customerIdsByPhone = await resolveCustomerIdsByPhone(
      messages
        .filter((message) => !message.lead?.customerId)
        .map((message) => ({
          orgId: message.orgId,
          phoneE164: message.direction === "INBOUND" ? message.fromNumberE164 : message.toNumberE164,
        })),
    );

    const existingEvents: Array<{
      messageId: string | null;
      providerMessageSid: string | null;
    }> = await prisma.communicationEvent.findMany({
      where: {
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
      existingEvents.map((event) => event.messageId).filter((value): value is string => Boolean(value)),
    );
    const existingMessageSids = new Set(
      existingEvents.map((event) => event.providerMessageSid).filter((value): value is string => Boolean(value)),
    );

    const operations = [];
    for (const message of messages) {
      processed += 1;

      if (
        existingMessageIds.has(message.id) ||
        (message.providerMessageSid && existingMessageSids.has(message.providerMessageSid))
      ) {
        skipped += 1;
        continue;
      }

      const contactId =
        message.lead?.customerId ||
        customerIdsByPhone.get(
          buildPhoneLookupKey(
            message.orgId,
            message.direction === "INBOUND" ? message.fromNumberE164 : message.toNumberE164,
          ) || "",
        ) ||
        null;
      const conversationId = message.lead?.conversationState?.id || null;

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

      if (mapped.confidence !== "high") {
        logReview("message", message.id, mapped.reviewReasons);
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
      created += results.length;
    }

    cursor = messages[messages.length - 1]?.id || null;
    console.info(
      `[backfill:communication-events] messages processed=${processed}/${total} created=${created} skipped=${skipped}`,
    );
  }

  return { total, processed, created, skipped };
}

async function main() {
  console.info("[backfill:communication-events] starting");
  const callResult = await backfillCalls();
  const messageResult = await backfillMessages();

  console.info("[backfill:communication-events] complete");
  console.info(
    JSON.stringify(
      {
        calls: callResult,
        messages: messageResult,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error("[backfill:communication-events] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
