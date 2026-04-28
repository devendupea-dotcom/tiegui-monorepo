import { NextResponse } from "next/server";
import {
  AppApiError,
  assertOrgReadAccess,
  assertOrgWriteAccess,
  requireAppApiActor,
  resolveActorOrgId,
} from "@/lib/app-api-permissions";
import { isInvoiceTemplate, normalizeInvoiceTemplate } from "@/lib/invoice-template";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InvoiceTemplatePayload = {
  orgId?: unknown;
  template?: unknown;
};

export async function GET(req: Request) {
  try {
    const actor = await requireAppApiActor();
    const url = new URL(req.url);
    const orgId = await resolveActorOrgId({
      actor,
      requestedOrgId: url.searchParams.get("orgId"),
    });
    assertOrgReadAccess(actor, orgId);

    const organization = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        invoiceTemplate: true,
      },
    });

    if (!organization) {
      throw new AppApiError("Organization not found.", 404);
    }

    return NextResponse.json({
      ok: true,
      orgId: organization.id,
      template: normalizeInvoiceTemplate(organization.invoiceTemplate),
    });
  } catch (error) {
    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to load invoice template preference.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const actor = await requireAppApiActor();
    const payload = (await req.json().catch(() => null)) as InvoiceTemplatePayload | null;
    const orgId = await resolveActorOrgId({
      actor,
      requestedOrgId: typeof payload?.orgId === "string" ? payload.orgId : undefined,
    });
    assertOrgWriteAccess(actor, orgId);

    if (!isInvoiceTemplate(payload?.template)) {
      throw new AppApiError("Invalid invoice template.", 400);
    }

    const template = payload.template;

    const organization = await prisma.organization.update({
      where: { id: orgId },
      data: {
        invoiceTemplate: template,
      },
      select: {
        id: true,
        invoiceTemplate: true,
      },
    });

    return NextResponse.json({
      ok: true,
      orgId: organization.id,
      template: normalizeInvoiceTemplate(organization.invoiceTemplate),
    });
  } catch (error) {
    if (error instanceof AppApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to save invoice template preference.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
