import { Prisma } from "@prisma/client";
import { upsertBlockedCaller } from "@/lib/blocked-callers";

export type PotentialSpamSignal =
  | "blocked_caller"
  | "high_risk_inbound_call"
  | "repeated_failed_outbound_sms";

export function derivePotentialSpamSignals(input: {
  isBlockedCaller: boolean;
  latestVoiceRiskDisposition?: string | null;
  latestVoiceRiskScore?: number | null;
  failedOutboundCount?: number | null;
}): PotentialSpamSignal[] {
  const signals: PotentialSpamSignal[] = [];
  const failedOutboundCount = input.failedOutboundCount || 0;
  const voiceRiskDisposition = `${input.latestVoiceRiskDisposition || ""}`
    .trim()
    .toUpperCase();
  const voiceRiskScore =
    typeof input.latestVoiceRiskScore === "number" &&
    Number.isFinite(input.latestVoiceRiskScore)
      ? input.latestVoiceRiskScore
      : 0;

  if (input.isBlockedCaller) {
    signals.push("blocked_caller");
  }

  if (voiceRiskDisposition === "VOICEMAIL_ONLY" || voiceRiskScore >= 70) {
    signals.push("high_risk_inbound_call");
  }

  if (failedOutboundCount >= 2) {
    signals.push("repeated_failed_outbound_sms");
  }

  return signals;
}

export async function blockLeadAsSpam(
  tx: Prisma.TransactionClient,
  input: {
    orgId: string;
    leadId: string;
    phoneE164: string;
    userId: string | null;
    at: Date;
    blockedCallerReason?: string | null;
    noteBody?: string | null;
  },
) {
  await upsertBlockedCaller(tx, {
    orgId: input.orgId,
    phone: input.phoneE164,
    sourceLeadId: input.leadId,
    createdByUserId: input.userId,
    reason:
      input.blockedCallerReason || "Blocked from CRM as spam or junk lead.",
  });

  await tx.lead.update({
    where: { id: input.leadId },
    data: {
      status: "DNC",
      intakeStage: "COMPLETED",
      nextFollowUpAt: null,
    },
  });

  await tx.leadConversationState.updateMany({
    where: { leadId: input.leadId },
    data: {
      stage: "CLOSED",
      stoppedAt: input.at,
      pausedUntil: null,
      nextFollowUpAt: null,
      bookingOptions: Prisma.DbNull,
      followUpStep: 0,
    },
  });

  await tx.smsDispatchQueue.updateMany({
    where: {
      orgId: input.orgId,
      leadId: input.leadId,
      status: "QUEUED",
    },
    data: {
      status: "FAILED",
      lastError: "Blocked as spam from CRM.",
    },
  });

  if (input.noteBody?.trim()) {
    await tx.leadNote.create({
      data: {
        orgId: input.orgId,
        leadId: input.leadId,
        createdByUserId: input.userId,
        body: input.noteBody.trim(),
      },
    });
  }
}
