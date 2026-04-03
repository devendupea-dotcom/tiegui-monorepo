import { sanitizeLeadBusinessTypeLabel } from "@/lib/lead-display";
import { normalizeLeadCity, resolveLeadLocationLabel } from "@/lib/lead-location";

export type LegacyLeadCleanupInput = {
  city?: string | null;
  businessType?: string | null;
  intakeLocationText?: string | null;
  intakeWorkTypeText?: string | null;
};

export type LegacyLeadCleanupSnapshot = {
  city: string | null;
  businessType: string | null;
  intakeLocationText: string | null;
  intakeWorkTypeText: string | null;
};

function normalizeNullableText(value: string | null | undefined): string | null {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text || null;
}

function looksLikeCityOnly(value: string | null | undefined): boolean {
  const text = normalizeNullableText(value);
  return Boolean(text && !/\d/.test(text));
}

export function computeLegacyLeadCleanupSnapshot(input: LegacyLeadCleanupInput): LegacyLeadCleanupSnapshot {
  const cleanBusinessType = sanitizeLeadBusinessTypeLabel(input.businessType);
  const cleanIntakeWorkType = sanitizeLeadBusinessTypeLabel(input.intakeWorkTypeText);
  const cleanCity = normalizeLeadCity(input.city);
  const cleanLocation =
    resolveLeadLocationLabel({
      intakeLocationText: input.intakeLocationText,
      city: input.city,
    }) || null;

  return {
    businessType: cleanBusinessType ?? cleanIntakeWorkType,
    intakeWorkTypeText: cleanIntakeWorkType ?? cleanBusinessType,
    intakeLocationText: cleanLocation,
    city: cleanCity ?? (looksLikeCityOnly(cleanLocation) ? cleanLocation : null),
  };
}

export function buildLegacyLeadCleanupPatch(input: LegacyLeadCleanupInput): Partial<LegacyLeadCleanupSnapshot> {
  const next = computeLegacyLeadCleanupSnapshot(input);
  const patch: Partial<LegacyLeadCleanupSnapshot> = {};

  for (const field of ["city", "businessType", "intakeLocationText", "intakeWorkTypeText"] as const) {
    if (normalizeNullableText(input[field]) !== normalizeNullableText(next[field])) {
      patch[field] = next[field];
    }
  }

  return patch;
}
