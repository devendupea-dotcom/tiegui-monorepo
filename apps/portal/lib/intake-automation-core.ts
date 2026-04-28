import type { LeadIntakeStage } from "@prisma/client";

export type IntakeCallbackHoldSelection = {
  id: string;
  startAt: Date;
  workerUserId: string;
};

export function resolveIntakeCallbackSelection(input: {
  intakeStage: LeadIntakeStage | null | undefined;
  selection: number;
  holds: IntakeCallbackHoldSelection[];
}) {
  if (input.intakeStage !== "WAITING_CALLBACK") {
    return {
      status: "noop" as const,
    };
  }

  const selectedHold =
    Number.isInteger(input.selection) && input.selection > 0
      ? input.holds[input.selection - 1] || null
      : null;

  if (!selectedHold) {
    return {
      status: "invalid" as const,
    };
  }

  return {
    status: "confirmed" as const,
    hold: selectedHold,
  };
}
