import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import {
  AppApiError,
  assertOrgReadAccess,
  assertOrgWriteAccess,
  requireAppApiActor,
  resolveActorOrgId,
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

type MaterialPayload = {
  orgId?: unknown;
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

function normalizeRequiredString(value: unknown, label: string, maxLength: number): string {
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

function normalizeOptionalString(value: unknown, label: string, maxLength: number): string | null {
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

function parseRequiredNumber(value: unknown, label: string): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : Number.NaN;
  if (!Number.isFinite(numeric)) {
    throw new AppApiError(`${label} must be a valid number.`, 400);
  }
  if (numeric < 0) {
    throw new AppApiError(`${label} cannot be negative.`, 400);
  }
  return roundMaterialNumber(numeric);
}

function parseOptionalBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
}

export async function GET(req: Request) {
  try {
    const actor = await requireAppApiActor();
    const url = new URL(req.url);
    const orgId = await resolveActorOrgId({
      actor,
      requestedOrgId: url.searchParams.get("orgId"),
    });
    assertOrgReadAccess(actor, orgId);

    const search = url.searchParams.get("q")?.trim() || "";
    const category = url.searchParams.get("category")?.trim() || "";
    const activeParam = url.searchParams.get("active")?.trim().toLowerCase() || "all";

    const where: Prisma.MaterialWhereInput = {
      orgId,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { category: { contains: search, mode: "insensitive" } },
              { unit: { contains: search, mode: "insensitive" } },
              { notes: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(category ? { category: { equals: category, mode: "insensitive" } } : {}),
      ...(activeParam === "true" ? { active: true } : {}),
      ...(activeParam === "false" ? { active: false } : {}),
    };

    const [materials, categoryRows] = await Promise.all([
      prisma.material.findMany({
        where,
        select: materialListSelect,
        orderBy: [{ active: "desc" }, { category: "asc" }, { name: "asc" }],
      }),
      prisma.material.findMany({
        where: { orgId },
        distinct: ["category"],
        select: { category: true },
        orderBy: { category: "asc" },
      }),
    ]);

    return NextResponse.json({
      ok: true,
      canManage: canManageMaterials(actor),
      materials: materials.map(serializeMaterial),
      categories: categoryRows.map((row) => row.category),
    });
  } catch (error) {
    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to load materials.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const actor = await requireAppApiActor();
    const payload = (await req.json().catch(() => null)) as MaterialPayload | null;
    const orgId = await resolveActorOrgId({
      actor,
      requestedOrgId: typeof payload?.orgId === "string" ? payload.orgId : null,
    });

    assertOrgWriteAccess(actor, orgId);
    if (!canManageMaterials(actor)) {
      throw new AppApiError("Only owners, admins, or internal users can manage materials.", 403);
    }

    const name = normalizeRequiredString(payload?.name, "Name", MATERIAL_NAME_MAX);
    const category = normalizeRequiredString(payload?.category, "Category", MATERIAL_CATEGORY_MAX);
    const unit = normalizeRequiredString(payload?.unit, "Unit", MATERIAL_UNIT_MAX);
    const baseCost = parseRequiredNumber(payload?.baseCost, "Base cost");
    const markupPercent = parseRequiredNumber(payload?.markupPercent, "Markup percent");
    const sellPrice =
      payload?.sellPrice == null || payload.sellPrice === ""
        ? calculateMaterialSellPrice(baseCost, markupPercent)
        : parseRequiredNumber(payload.sellPrice, "Sell price");
    const notes = normalizeOptionalString(payload?.notes, "Notes", MATERIAL_NOTES_MAX);
    const active = parseOptionalBoolean(payload?.active, true);

    const material = await prisma.material.create({
      data: {
        orgId,
        name,
        category,
        unit,
        baseCost,
        markupPercent,
        sellPrice,
        notes,
        active,
      },
      select: materialListSelect,
    });

    return NextResponse.json({
      ok: true,
      material: serializeMaterial(material),
    });
  } catch (error) {
    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to create material.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
