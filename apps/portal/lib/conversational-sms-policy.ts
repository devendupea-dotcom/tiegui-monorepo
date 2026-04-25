import type { ConversationStage } from "@prisma/client";

const FOLLOW_UP_CADENCE_MINUTES_BY_STAGE: Partial<Record<ConversationStage, readonly number[]>> = {
  // One reminder after 48 hours keeps the automation helpful without crowding leads.
  ASKED_WORK: [48 * 60],
  ASKED_ADDRESS: [48 * 60],
  ASKED_TIMEFRAME: [48 * 60],
  OFFERED_BOOKING: [48 * 60],
};

export function getConversationFollowUpCadenceMinutes(
  stage: ConversationStage,
  activeFollowUpStages: readonly ConversationStage[],
): number[] {
  if (!activeFollowUpStages.includes(stage)) {
    return [];
  }

  return [...(FOLLOW_UP_CADENCE_MINUTES_BY_STAGE[stage] || [])];
}
