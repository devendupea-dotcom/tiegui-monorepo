import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeE164 } from "@/lib/phone";
import {
  buildFieldNotesEstimateDraft,
  buildFieldNotesLeadSummary,
  normalizeParsedFieldNotes,
  parseQuoteAmountToCents,
  type ParsedFieldNotes,
} from "@/lib/field-notes";
import { capturePortalError, trackPortalEvent } from "@/lib/telemetry";
import {
  AppApiError,
  assertCanCreateOrganicLead,
  requireAppApiActor,
  resolveActorOrgId,
} from "@/lib/app-api-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SaveFieldNotesPayload = {
  orgId?: unknown;
  mode?: unknown;
  phone?: unknown;
  email?: unknown;
  data?: unknown;
};

function normalizeOptionalText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function buildRedirectPath(input: {
  leadId: string;
  orgId: string;
  internalUser: boolean;
}): string {
  const path = `/app/jobs/${input.leadId}`;
  if (!input.internalUser) {
    return path;
  }

  const target = new URL(path, "https://app.tieguisolutions.com");
  target.searchParams.set("orgId", input.orgId);
  return `${target.pathname}?${target.searchParams.toString()}`;
}

function normalizeSaveMode(value: unknown): "lead" | "estimate" {
  return value === "estimate" ? "estimate" : "lead";
}

function toMeasurementRows(data: ParsedFieldNotes, orgId: string, leadId: string, actorId: string) {
  return data.measurements
    .filter((row) => row.label || row.value)
    .map((row) => ({
      orgId,
      leadId,
      createdByUserId: actorId,
      label: row.label || "Measurement",
      value: row.value || row.notes || "TBD",
      unit: row.unit || null,
      notes: row.notes || null,
    }));
}

export async function POST(req: Request) {
  try {
    const actor = await requireAppApiActor();
    const payload = (await req.json().catch(() => null)) as SaveFieldNotesPayload | null;

    if (!payload) {
      throw new AppApiError("Invalid JSON payload.", 400);
    }

    const orgId = await resolveActorOrgId({
      actor,
      requestedOrgId: typeof payload.orgId === "string" ? payload.orgId : undefined,
    });

    await assertCanCreateOrganicLead(actor, orgId);

    const mode = normalizeSaveMode(payload.mode);
    const data = normalizeParsedFieldNotes(payload.data);
    const customerName = data.customer_name.trim();
    const rawPhone = typeof payload.phone === "string" ? payload.phone : "";
    const phoneE164 = normalizeE164(rawPhone);
    const email = normalizeOptionalText(payload.email, 320);

    if (!customerName) {
      throw new AppApiError("Customer name is required before saving.", 400);
    }

    if (!phoneE164) {
      throw new AppApiError("A valid phone number is required to save this scan as a lead or estimate draft.", 400);
    }

    const leadSummary = buildFieldNotesLeadSummary(data);
    const estimatedRevenueCents = parseQuoteAmountToCents(data.quote_amount);
    const invoiceDraftText =
      mode === "estimate"
        ? buildFieldNotesEstimateDraft({
            data,
            phoneE164,
          })
        : null;

    const existingCustomer = await prisma.customer.findFirst({
      where: {
        orgId,
        phoneE164,
      },
      orderBy: [{ updatedAt: "desc" }],
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    const created = await prisma.$transaction(async (tx) => {
      const customer =
        existingCustomer ||
        (await tx.customer.create({
          data: {
            orgId,
            createdByUserId: actor.id,
            name: customerName,
            phoneE164,
            email,
            addressLine: data.site_address || null,
          },
          select: {
            id: true,
            name: true,
          },
        }));

      const lead = await tx.lead.create({
        data: {
          orgId,
          customerId: customer.id,
          createdByUserId: actor.id,
          assignedToUserId: actor.id,
          contactName: customerName,
          phoneE164,
          businessType: data.project_type || null,
          sourceType: "ORGANIC",
          sourceDetail: "AI field notes scanner",
          sourceChannel: "OTHER",
          attributionLocked: true,
          commissionEligible: false,
          leadSource: "OTHER",
          intakeLocationText: data.site_address || null,
          intakeWorkTypeText: data.project_type || null,
          estimatedRevenueCents,
          invoiceStatus: invoiceDraftText ? "DRAFT_READY" : "NONE",
          invoiceDraftText,
          notes: leadSummary,
        },
        select: {
          id: true,
          orgId: true,
          customerId: true,
        },
      });

      if (leadSummary) {
        await tx.leadNote.create({
          data: {
            orgId,
            leadId: lead.id,
            createdByUserId: actor.id,
            body: leadSummary,
          },
        });
      }

      const measurementRows = toMeasurementRows(data, orgId, lead.id, actor.id);
      if (measurementRows.length > 0) {
        await tx.leadMeasurement.createMany({
          data: measurementRows,
        });
      }

      return {
        customer,
        lead,
      };
    });

    await trackPortalEvent("Lead Created", {
      orgId,
      actorId: actor.id,
      leadId: created.lead.id,
      source: "field-notes",
      saveMode: mode,
    });

    return NextResponse.json({
      ok: true,
      leadId: created.lead.id,
      customerId: created.lead.customerId,
      redirectTo: buildRedirectPath({
        leadId: created.lead.id,
        orgId,
        internalUser: actor.internalUser,
      }),
      saveMode: mode,
    });
  } catch (error) {
    await capturePortalError(error, {
      route: "POST /api/ai/field-notes/save",
    });

    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to save field notes.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
