import Link from "next/link";
import { resolveOrganizationLogoUrl } from "@/lib/organization-logo";
import { normalizeInvoiceTemplate } from "@/lib/invoice-template";
import { prisma } from "@/lib/prisma";
import type { InvoicePreviewData } from "../../_components/invoice-preview";
import { getParam, requireAppOrgActor, resolveAppScope, withOrgQuery } from "../../_lib/portal-scope";
import InvoiceTemplateSettings from "./invoice-template-settings";

export const dynamic = "force-dynamic";

function buildAddressLines(input: {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}): string[] {
  const locality = [input.city, input.state, input.zip].map((part) => (part || "").trim()).filter(Boolean).join(", ");
  return [input.addressLine1, input.addressLine2, locality].map((part) => (part || "").trim()).filter(Boolean);
}

export default async function InvoiceTemplateSettingsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const requestedOrgId = getParam(searchParams?.orgId);
  const scope = await resolveAppScope({ nextPath: "/app/settings/invoice", requestedOrgId });
  const actor = await requireAppOrgActor("/app/settings/invoice", scope.orgId);
  const canManage = actor.internalUser || actor.calendarAccessRole === "OWNER" || actor.calendarAccessRole === "ADMIN";

  const organization = await prisma.organization.findUnique({
    where: { id: scope.orgId },
    select: {
      id: true,
      name: true,
      legalName: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      state: true,
      zip: true,
      phone: true,
      invoiceTemplate: true,
      invoicePaymentInstructions: true,
      logoPhotoId: true,
    },
  });

  if (!organization) {
    return null;
  }

  const logoUrl = await resolveOrganizationLogoUrl({
    orgId: organization.id,
    logoPhotoId: organization.logoPhotoId,
  });

  const businessName = organization.legalName?.trim() || organization.name;
  const businessAddressLines = buildAddressLines({
    addressLine1: organization.addressLine1,
    addressLine2: organization.addressLine2,
    city: organization.city,
    state: organization.state,
    zip: organization.zip,
  });
  const settingsPath = withOrgQuery("/app/settings", scope.orgId, scope.internalUser);

  const previewInvoice: InvoicePreviewData = {
    invoiceNumber: "INV-2026-1042",
    issueDate: new Date("2026-04-13T12:00:00.000Z").toISOString(),
    dueDate: new Date("2026-04-20T12:00:00.000Z").toISOString(),
    status: "SENT",
    jobTitle: "Spring cleanup and irrigation tune-up",
    termsLabel: "Due on receipt",
    business: {
      name: businessName,
      logoUrl,
      addressLines:
        businessAddressLines.length > 0 ? businessAddressLines : ["1280 Foundry Lane", "San Antonio, TX 78205"],
      phone: organization.phone || "(210) 555-0188",
    },
    customer: {
      name: "Megan Carter",
      addressLines: ["1842 Juniper Ridge Drive", "Austin, TX 78704"],
    },
    lineItems: [
      {
        description: "Spring cleanup and debris haul-away",
        quantity: "1",
        unitPrice: "850.00",
        subtotal: "850.00",
      },
      {
        description: "Irrigation inspection, repairs, and controller tune-up",
        quantity: "1",
        unitPrice: "1000.00",
        subtotal: "1000.00",
      },
    ],
    subtotal: "1850.00",
    taxLabel: "Tax (8.25%)",
    taxAmount: "152.63",
    total: "2002.63",
    notes: "Thank you for the opportunity. Work includes cleanup, haul-away, and irrigation adjustments completed onsite.",
    paymentTerms:
      organization.invoicePaymentInstructions?.trim() || "Payment due upon receipt. ACH, check, and card are accepted.",
  };

  return (
    <section>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="invoice-header-row">
          <div className="stack-cell">
            <Link className="table-link" href={settingsPath}>
              ← Back to Settings
            </Link>
            <h2>Invoice Templates</h2>
            <p className="muted">Pick the invoice style your business uses by default for previews, printing, and PDF exports.</p>
          </div>
        </div>
      </div>

      <InvoiceTemplateSettings
        orgId={organization.id}
        canManage={canManage}
        initialTemplate={normalizeInvoiceTemplate(organization.invoiceTemplate)}
        previewInvoice={previewInvoice}
      />
    </section>
  );
}
