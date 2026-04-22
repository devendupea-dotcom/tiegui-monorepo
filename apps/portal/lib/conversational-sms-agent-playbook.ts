export type SmsAgentPlaybook = {
  primaryGoal: string;
  businessContext: string;
  servicesSummary: string;
  serviceAreaSummary: string;
  requiredDetails: string;
  handoffTriggers: string;
  toneNotes: string;
  estimatorName: string;
  schedulingNotes: string;
  doNotPromise: string;
  useInboundPhoneAsCallback: boolean;
};

export type SmsAgentPlaybookInput = Partial<{
  primaryGoal: string | null;
  businessContext: string | null;
  servicesSummary: string | null;
  serviceAreaSummary: string | null;
  requiredDetails: string | null;
  handoffTriggers: string | null;
  toneNotes: string | null;
  estimatorName: string | null;
  schedulingNotes: string | null;
  doNotPromise: string | null;
  useInboundPhoneAsCallback: boolean | null;
}>;

function sanitizeText(value: unknown, maxLength = 1200): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function normalizeSmsAgentPlaybook(value: unknown): SmsAgentPlaybook {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as SmsAgentPlaybookInput)
      : {};

  return {
    primaryGoal: sanitizeText(input.primaryGoal),
    businessContext: sanitizeText(input.businessContext),
    servicesSummary: sanitizeText(input.servicesSummary),
    serviceAreaSummary: sanitizeText(input.serviceAreaSummary),
    requiredDetails: sanitizeText(input.requiredDetails),
    handoffTriggers: sanitizeText(input.handoffTriggers),
    toneNotes: sanitizeText(input.toneNotes),
    estimatorName: sanitizeText(input.estimatorName, 120),
    schedulingNotes: sanitizeText(input.schedulingNotes),
    doNotPromise: sanitizeText(input.doNotPromise),
    useInboundPhoneAsCallback: input.useInboundPhoneAsCallback !== false,
  };
}

export function buildSmsAgentPlaybookInput(input: SmsAgentPlaybookInput): SmsAgentPlaybook {
  return normalizeSmsAgentPlaybook(input);
}

export function hasSmsAgentPlaybookDetails(playbook: SmsAgentPlaybook | null | undefined): boolean {
  if (!playbook) return false;
  return [
    playbook.primaryGoal,
    playbook.businessContext,
    playbook.servicesSummary,
    playbook.serviceAreaSummary,
    playbook.requiredDetails,
    playbook.handoffTriggers,
    playbook.toneNotes,
    playbook.estimatorName,
    playbook.schedulingNotes,
    playbook.doNotPromise,
  ].some((value) => value.trim().length > 0);
}
