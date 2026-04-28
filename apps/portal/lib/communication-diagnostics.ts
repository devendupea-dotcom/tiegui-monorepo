import { prisma } from "@/lib/prisma";

type CountRow = {
  count: bigint | number | string;
};

function toNumber(value: bigint | number | string | null | undefined) {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export type CommunicationDiagnosticsSummary = {
  orgId: string;
  totalCommunicationEvents: number;
  totalLegacyCallsWithoutCommunicationEvents: number;
  totalLegacyMessagesWithoutCommunicationEvents: number;
  voicemailArtifactCount: number;
  missingLeadIdCount: number;
  missingContactIdCount: number;
  missingEitherLinkCount: number;
  countsByTypeAndStatus: Array<{
    type: string;
    providerStatus: string | null;
    count: number;
  }>;
  linkingGapSamples: Array<{
    id: string;
    type: string;
    providerCallSid: string | null;
    providerMessageSid: string | null;
    occurredAt: string;
    leadId: string | null;
    contactId: string | null;
  }>;
};

export function normalizeCommunicationProviderStatus(value: string | null | undefined): string | null {
  const normalized = `${value || ""}`.trim().toUpperCase();
  return normalized || null;
}

export function aggregateCommunicationStatusCounts(
  rows: Array<{
    type: string;
    providerStatus: string | null;
    count: number;
  }>,
) {
  const totals = new Map<string, { type: string; providerStatus: string | null; count: number }>();

  for (const row of rows) {
    const providerStatus = normalizeCommunicationProviderStatus(row.providerStatus);
    const key = `${row.type}:${providerStatus || ""}`;
    const existing = totals.get(key);
    if (existing) {
      existing.count += row.count;
      continue;
    }
    totals.set(key, {
      type: row.type,
      providerStatus,
      count: row.count,
    });
  }

  return [...totals.values()].sort((left, right) => {
    const typeCompare = left.type.localeCompare(right.type);
    if (typeCompare !== 0) {
      return typeCompare;
    }
    return (left.providerStatus || "").localeCompare(right.providerStatus || "");
  });
}

export async function getCommunicationDiagnostics(orgId: string): Promise<CommunicationDiagnosticsSummary> {
  const [
    totalCommunicationEvents,
    voicemailArtifactCount,
    missingLeadIdCount,
    missingContactIdCount,
    missingEitherLinkCount,
    countsByTypeAndStatus,
    linkingGapSamples,
    unmatchedLegacyCallsRows,
    unmatchedLegacyMessagesRows,
  ] = await Promise.all([
    prisma.communicationEvent.count({ where: { orgId } }),
    prisma.voicemailArtifact.count({ where: { orgId } }),
    prisma.communicationEvent.count({ where: { orgId, leadId: null } }),
    prisma.communicationEvent.count({ where: { orgId, contactId: null } }),
    prisma.communicationEvent.count({
      where: {
        orgId,
        OR: [{ leadId: null }, { contactId: null }],
      },
    }),
    prisma.communicationEvent.groupBy({
      by: ["type", "providerStatus"],
      where: { orgId },
      _count: {
        _all: true,
      },
      orderBy: [{ type: "asc" }, { providerStatus: "asc" }],
    }),
    prisma.communicationEvent.findMany({
      where: {
        orgId,
        OR: [{ leadId: null }, { contactId: null }],
      },
      select: {
        id: true,
        type: true,
        providerCallSid: true,
        providerMessageSid: true,
        occurredAt: true,
        leadId: true,
        contactId: true,
      },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      take: 20,
    }),
    prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS count
      FROM "Call" AS c
      WHERE c."orgId" = ${orgId}
        AND NOT EXISTS (
          SELECT 1
          FROM "CommunicationEvent" AS ce
          WHERE ce."orgId" = c."orgId"
            AND (
              ce."callId" = c."id"
              OR (c."twilioCallSid" IS NOT NULL AND ce."providerCallSid" = c."twilioCallSid")
            )
        )
    `,
    prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS count
      FROM "Message" AS m
      WHERE m."orgId" = ${orgId}
        AND NOT EXISTS (
          SELECT 1
          FROM "CommunicationEvent" AS ce
          WHERE ce."orgId" = m."orgId"
            AND (
              ce."messageId" = m."id"
              OR (m."providerMessageSid" IS NOT NULL AND ce."providerMessageSid" = m."providerMessageSid")
            )
        )
    `,
  ]);

  return {
    orgId,
    totalCommunicationEvents,
    totalLegacyCallsWithoutCommunicationEvents: toNumber(unmatchedLegacyCallsRows[0]?.count),
    totalLegacyMessagesWithoutCommunicationEvents: toNumber(unmatchedLegacyMessagesRows[0]?.count),
    voicemailArtifactCount,
    missingLeadIdCount,
    missingContactIdCount,
    missingEitherLinkCount,
    countsByTypeAndStatus: aggregateCommunicationStatusCounts(
      countsByTypeAndStatus.map((row) => ({
        type: row.type,
        providerStatus: row.providerStatus,
        count: row._count._all,
      })),
    ),
    linkingGapSamples: linkingGapSamples.map((row) => ({
      id: row.id,
      type: row.type,
      providerCallSid: row.providerCallSid,
      providerMessageSid: row.providerMessageSid,
      occurredAt: row.occurredAt.toISOString(),
      leadId: row.leadId,
      contactId: row.contactId,
    })),
  };
}
