import { normalizeE164 } from "@/lib/phone";

export function voiceConfigOwnsCalledNumber(input: {
  configPhoneNumber?: string | null;
  organizationSmsFromNumberE164?: string | null;
  calledNumber?: string | null;
}): boolean {
  const calledNumber = normalizeE164(input.calledNumber || null);
  if (!calledNumber) {
    return true;
  }

  const configPhoneNumber = normalizeE164(input.configPhoneNumber || null);
  const organizationSmsFromNumberE164 = normalizeE164(
    input.organizationSmsFromNumberE164 || null,
  );

  return (
    calledNumber === configPhoneNumber ||
    calledNumber === organizationSmsFromNumberE164
  );
}

export function resolveExplicitVoiceForwardTarget(
  voiceForwardingNumber?: string | null,
): string | null {
  return normalizeE164(voiceForwardingNumber || null);
}

export function shouldSendVoiceRiskToVoicemailOnly(
  riskDisposition?: string | null,
): boolean {
  return `${riskDisposition || ""}`.trim().toUpperCase() === "VOICEMAIL_ONLY";
}
