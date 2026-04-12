import type { ConversationStage } from "@prisma/client";

const FOLLOW_UP_CADENCE_MINUTES_BY_STAGE: Partial<Record<ConversationStage, readonly number[]>> = {
  ASKED_WORK: [24 * 60, 72 * 60],
  ASKED_ADDRESS: [24 * 60, 72 * 60],
  ASKED_TIMEFRAME: [24 * 60, 72 * 60],
  OFFERED_BOOKING: [24 * 60, 72 * 60],
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
