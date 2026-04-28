import type { CalendarAccessRole } from "@prisma/client";

export const MATERIAL_NAME_MAX = 160;
export const MATERIAL_CATEGORY_MAX = 80;
export const MATERIAL_UNIT_MAX = 40;
export const MATERIAL_NOTES_MAX = 2000;

export const materialUnitSuggestions = [
  "sqft",
  "linear ft",
  "yard",
  "each",
  "bag",
  "box",
  "roll",
  "bundle",
  "hour",
  "day",
] as const;

export type MaterialListItem = {
  id: string;
  name: string;
  category: string;
  unit: string;
  baseCost: number;
  markupPercent: number;
  sellPrice: number;
  notes: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export function canManageMaterials(input: {
  internalUser: boolean;
  calendarAccessRole: CalendarAccessRole;
}): boolean {
  return input.internalUser || input.calendarAccessRole === "OWNER" || input.calendarAccessRole === "ADMIN";
}

export function roundMaterialNumber(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function calculateMaterialSellPrice(baseCost: number, markupPercent: number): number {
  return roundMaterialNumber(baseCost * (1 + markupPercent / 100));
}
