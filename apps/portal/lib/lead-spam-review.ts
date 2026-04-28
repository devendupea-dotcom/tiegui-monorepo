import { prisma } from "@/lib/prisma";
import {
  derivePotentialSpamSignals,
  type PotentialSpamSignal,
} from "@/lib/lead-spam";

type LeadSpamReviewTarget = {
  leadId: string;
  phoneE164: string | null;
};

export type LeadSpamReviewSnapshot = {
  leadId: string;
  isBlockedCaller: boolean;
  failedOutboundCount: number;
  latestVoiceRiskDisposition: string | null;
  latestVoiceRiskScore: number | null;
  potentialSpam: boolean;
  potentialSpamSignals: PotentialSpamSignal[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function recordString(
  record: Record<string, unknown> | null,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function recordNumber(
  record: Record<string, unknown> | null,
  key: string,
): number | undefined {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export async function getLeadSpamReviewByLead(input: {
  orgId: string;
  leads: LeadSpamReviewTarget[];
  voiceRiskSince?: Date;
}): Promise<Map<string, LeadSpamReviewSnapshot>> {
  const targets = input.leads.filter((lead) => lead.leadId);
  const byLead = new Map<string, LeadSpamReviewSnapshot>();

  if (targets.length === 0) {
    return byLead;
  }

  const leadIds = targets.map((lead) => lead.leadId);
  const phoneNumbers = [
    ...new Set(targets.map((lead) => lead.phoneE164).filter(Boolean)),
  ] as string[];
  const voiceRiskSince =
    input.voiceRiskSince ||
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [blockedCallers, failedOutboundGroups, voiceRiskEvents] =
    await Promise.all([
      phoneNumbers.length > 0
        ? prisma.blockedCaller.findMany({
            where: {
              orgId: input.orgId,
              phoneE164: { in: phoneNumbers },
            },
            select: {
              phoneE164: true,
            },
          })
        : Promise.resolve([]),
      prisma.message.groupBy({
        by: ["leadId"],
        where: {
          leadId: { in: leadIds },
          direction: "OUTBOUND",
          status: "FAILED",
        },
        _count: {
          _all: true,
        },
      }),
      prisma.communicationEvent.findMany({
        where: {
          orgId: input.orgId,
          leadId: { in: leadIds },
          channel: "VOICE",
          occurredAt: { gte: voiceRiskSince },
        },
        select: {
          leadId: true,
          occurredAt: true,
          metadataJson: true,
        },
        orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
        take: 2000,
      }),
    ]);

  const blockedCallerPhones = new Set(
    blockedCallers.map((blockedCaller) => blockedCaller.phoneE164),
  );
  const failedOutboundByLead = new Map(
    failedOutboundGroups.map((group) => [group.leadId, group._count._all]),
  );
  const latestVoiceRiskByLead = new Map<
    string,
    { disposition: string | null; score: number | null }
  >();

  for (const event of voiceRiskEvents) {
    if (!event.leadId || latestVoiceRiskByLead.has(event.leadId)) {
      continue;
    }
    const metadata = asRecord(event.metadataJson);
    const disposition = recordString(metadata, "riskDisposition") || null;
    const score = recordNumber(metadata, "riskScore") ?? null;
    if (!disposition && score == null) {
      continue;
    }
    latestVoiceRiskByLead.set(event.leadId, {
      disposition,
      score,
    });
  }

  for (const lead of targets) {
    const failedOutboundCount = failedOutboundByLead.get(lead.leadId) || 0;
    const latestVoiceRisk = latestVoiceRiskByLead.get(lead.leadId);
    const isBlockedCaller = Boolean(
      lead.phoneE164 && blockedCallerPhones.has(lead.phoneE164),
    );
    const potentialSpamSignals = derivePotentialSpamSignals({
      isBlockedCaller,
      latestVoiceRiskDisposition: latestVoiceRisk?.disposition || null,
      latestVoiceRiskScore: latestVoiceRisk?.score ?? null,
      failedOutboundCount,
    });

    byLead.set(lead.leadId, {
      leadId: lead.leadId,
      isBlockedCaller,
      failedOutboundCount,
      latestVoiceRiskDisposition: latestVoiceRisk?.disposition || null,
      latestVoiceRiskScore: latestVoiceRisk?.score ?? null,
      potentialSpam: potentialSpamSignals.length > 0,
      potentialSpamSignals,
    });
  }

  return byLead;
}
