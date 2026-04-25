import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import {
  AppApiError,
  assertOrgWriteAccess,
  requireAppApiActor,
} from "@/lib/app-api-permissions";
import {
  MATERIAL_CATEGORY_MAX,
  MATERIAL_NAME_MAX,
  MATERIAL_NOTES_MAX,
  MATERIAL_UNIT_MAX,
  calculateMaterialSellPrice,
  canManageMaterials,
  roundMaterialNumber,
  type MaterialListItem,
} from "@/lib/materials";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const materialListSelect = {
  id: true,
  name: true,
  category: true,
  unit: true,
  baseCost: true,
  markupPercent: true,
  sellPrice: true,
  notes: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.MaterialSelect;

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type MaterialUpdatePayload = {
  name?: unknown;
  category?: unknown;
  unit?: unknown;
  baseCost?: unknown;
  markupPercent?: unknown;
  sellPrice?: unknown;
  notes?: unknown;
  active?: unknown;
};

function serializeMaterial(
  material: Prisma.MaterialGetPayload<{ select: typeof materialListSelect }>,
): MaterialListItem {
  return {
    ...material,
    baseCost: Number(material.baseCost),
    markupPercent: Number(material.markupPercent),
    sellPrice: Number(material.sellPrice),
    createdAt: material.createdAt.toISOString(),
    updatedAt: material.updatedAt.toISOString(),
  };
}

function normalizeOptionalString(value: unknown, label: string, maxLength: number): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value == null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new AppApiError(`${label} must be text.`, 400);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > maxLength) {
    throw new AppApiError(`${label} must be ${maxLength} characters or less.`, 400);
  }
  return trimmed;
}

function normalizeRequiredString(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new AppApiError(`${label} is required.`, 400);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new AppApiError(`${label} is required.`, 400);
  }
  if (trimmed.length > maxLength) {
    throw new AppApiError(`${label} must be ${maxLength} characters or less.`, 400);
  }
  return trimmed;
}

function parseOptionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : Number.NaN;
  if (!Number.isFinite(numeric)) {
    throw new AppApiError(`${label} must be a valid number.`, 400);
  }
  if (numeric < 0) {
    throw new AppApiError(`${label} cannot be negative.`, 400);
  }
  return roundMaterialNumber(numeric);
}

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  throw new AppApiError("Active must be true or false.", 400);
}

async function getScopedMaterialOrThrow(id: string) {
  const material = await prisma.material.findUnique({
    where: { id },
    select: {
      id: true,
      orgId: true,
      name: true,
      category: true,
      unit: true,
      baseCost: true,
      markupPercent: true,
      sellPrice: true,
      notes: true,
      active: true,
    },
  });

  if (!material) {
    throw new AppApiError("Material not found.", 404);
  }

  return material;
}

export async function PUT(req: Request, props: RouteContext) {
  const params = await props.params;
  try {
    const actor = await requireAppApiActor();
    const material = await getScopedMaterialOrThrow(params.id);
    assertOrgWriteAccess(actor, material.orgId);

    if (!canManageMaterials(actor)) {
      throw new AppApiError("Only owners, admins, or internal users can manage materials.", 403);
    }

    const payload = (await req.json().catch(() => null)) as MaterialUpdatePayload | null;
    const name = normalizeRequiredString(payload?.name, "Name", MATERIAL_NAME_MAX);
    const category = normalizeRequiredString(payload?.category, "Category", MATERIAL_CATEGORY_MAX);
    const unit = normalizeRequiredString(payload?.unit, "Unit", MATERIAL_UNIT_MAX);
    const baseCost = parseOptionalNumber(payload?.baseCost, "Base cost");
    const markupPercent = parseOptionalNumber(payload?.markupPercent, "Markup percent");
    const sellPrice = parseOptionalNumber(payload?.sellPrice, "Sell price");
    const notes = normalizeOptionalString(payload?.notes, "Notes", MATERIAL_NOTES_MAX);
    const active = parseOptionalBoolean(payload?.active);

    const nextBaseCost = baseCost ?? material.baseCost;
    const nextMarkupPercent = markupPercent ?? material.markupPercent;
    const nextSellPrice = sellPrice ?? calculateMaterialSellPrice(nextBaseCost, nextMarkupPercent);

    const data: Prisma.MaterialUpdateInput = {
      ...(name !== undefined ? { name } : {}),
      ...(category !== undefined ? { category } : {}),
      ...(unit !== undefined ? { unit } : {}),
      ...(baseCost !== undefined ? { baseCost } : {}),
      ...(markupPercent !== undefined ? { markupPercent } : {}),
      ...(sellPrice !== undefined || baseCost !== undefined || markupPercent !== undefined
        ? { sellPrice: nextSellPrice }
        : {}),
      ...(notes !== undefined ? { notes } : {}),
      ...(active !== undefined ? { active } : {}),
    };

    if (Object.keys(data).length === 0) {
      throw new AppApiError("No material changes were provided.", 400);
    }

    const updated = await prisma.material.update({
      where: { id: material.id },
      data,
      select: materialListSelect,
    });

    return NextResponse.json({
      ok: true,
      material: serializeMaterial(updated),
    });
  } catch (error) {
    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to update material.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function DELETE(_: Request, props: RouteContext) {
  const params = await props.params;
  try {
    const actor = await requireAppApiActor();
    const material = await getScopedMaterialOrThrow(params.id);
    assertOrgWriteAccess(actor, material.orgId);

    if (!canManageMaterials(actor)) {
      throw new AppApiError("Only owners, admins, or internal users can manage materials.", 403);
    }

    await prisma.material.delete({
      where: { id: material.id },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to delete material.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
