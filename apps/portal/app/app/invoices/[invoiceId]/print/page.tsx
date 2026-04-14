import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  buildInvoiceWorkerLeadAccessWhere,
  formatInvoiceNumber,
  getInvoiceActionContext,
  getInvoiceReadJobContext,
} from "@/lib/invoices";
import { resolveOrganizationLogoUrl } from "@/lib/organization-logo";
import { normalizeInvoiceTemplate } from "@/lib/invoice-template";
import { getParam, resolveAppScope, withOrgQuery } from "../../../_lib/portal-scope";
import { requireAppPageViewer } from "../../../_lib/portal-viewer";
import InvoicePreview from "../../../_components/invoice-preview";
import InvoicePrintToolbar from "./invoice-print-toolbar";

export const dynamic = "force-dynamic";

type RouteParams = {
  params: {
    invoiceId: string;
  };
  searchParams?: Record<string, string | string[] | undefined>;
};

function buildAddressLines(input: {
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): string[] {
  const locality = [input.city, input.state, input.zip].map((part) => (part || "").trim()).filter(Boolean).join(", ");
  return [input.addressLine1, input.addressLine2, locality].map((part) => (part || "").trim()).filter(Boolean);
}

function formatInvoiceTermsLabel(value: string): string {
  switch (value) {
    case "NET_7":
      return "Net 7";
    case "NET_15":
      return "Net 15";
    case "NET_30":
      return "Net 30";
    case "DUE_ON_RECEIPT":
    default:
      return "Due on receipt";
  }
}

function taxPercentLabel(value: string): string {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  return (numeric * 100).toFixed(2).replace(/\.00$/, "");
}

export default async function InvoicePrintPage({ params, searchParams }: RouteParams) {
  const requestedOrgId = getParam(searchParams?.orgId);
  const autoprint = getParam(searchParams?.autoprint) === "1";

  const scope = await resolveAppScope({
    nextPath: `/app/invoices/${params.invoiceId}/print`,
    requestedOrgId,
  });
  const viewer = await requireAppPageViewer({
    nextPath: `/app/invoices/${params.invoiceId}/print`,
    orgId: scope.orgId,
  });

  const invoice = await prisma.invoice.findFirst({
    where: {
      id: params.invoiceId,
      orgId: scope.orgId,
    },
    include: {
      org: {
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
          invoicePaymentInstructions: true,
          invoiceTemplate: true,
          logoPhotoId: true,
        },
      },
      customer: {
        select: {
          name: true,
          addressLine: true,
        },
      },
      legacyLead: {
        select: {
          id: true,
          contactName: true,
          businessName: true,
          phoneE164: true,
        },
      },
      sourceJob: {
        select: {
          id: true,
          leadId: true,
          customerName: true,
          serviceType: true,
          projectType: true,
        },
      },
      lineItems: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          description: true,
          quantity: true,
          unitPrice: true,
          lineTotal: true,
        },
      },
    },
  });

  if (!invoice) {
    if (scope.internalUser && !requestedOrgId) {
      const fallback = await prisma.invoice.findUnique({
        where: { id: params.invoiceId },
        select: { orgId: true },
      });

      if (fallback) {
        redirect(`/app/invoices/${params.invoiceId}/print?orgId=${encodeURIComponent(fallback.orgId)}`);
      }
    }

    notFound();
  }

  const invoiceActionContext = getInvoiceActionContext({
    legacyLeadId: invoice.legacyLeadId,
    sourceJobId: invoice.sourceJobId,
    sourceJob: invoice.sourceJob,
  });

  if (!viewer.internalUser && viewer.calendarAccessRole === "WORKER") {
    if (!invoiceActionContext.leadId) {
      notFound();
    }

    const workerAllowed = await prisma.lead.findFirst({
      where: {
        id: invoiceActionContext.leadId,
        orgId: scope.orgId,
        ...buildInvoiceWorkerLeadAccessWhere({
          actorId: viewer.id,
          invoiceId: invoice.id,
        }),
      },
      select: { id: true },
    });

    if (!workerAllowed) {
      notFound();
    }
  }

  const logoUrl = await resolveOrganizationLogoUrl({
    orgId: invoice.org.id,
    logoPhotoId: invoice.org.logoPhotoId,
  });

  const jobContext = getInvoiceReadJobContext({
    legacyLeadId: invoice.legacyLeadId,
    sourceJobId: invoice.sourceJobId,
    legacyLead: invoice.legacyLead,
    sourceJob: invoice.sourceJob,
  });

  const backHref = withOrgQuery(`/app/invoices/${invoice.id}`, scope.orgId, scope.internalUser);
  const taxLabel = taxPercentLabel(invoice.taxRate.toString());

  return (
    <section className="invoice-print-shell">
      <InvoicePrintToolbar autoprint={autoprint} backHref={backHref} />

      <div className="invoice-print-sheet">
        <InvoicePreview
          template={normalizeInvoiceTemplate(invoice.org.invoiceTemplate)}
          invoice={{
            invoiceNumber: formatInvoiceNumber(invoice.invoiceNumber),
            issueDate: invoice.issueDate.toISOString(),
            dueDate: invoice.dueDate.toISOString(),
            status: invoice.status,
            jobTitle: jobContext.primaryLabel,
            termsLabel: formatInvoiceTermsLabel(invoice.terms),
            business: {
              name: invoice.org.legalName?.trim() || invoice.org.name,
              logoUrl,
              addressLines: buildAddressLines({
                addressLine1: invoice.org.addressLine1,
                addressLine2: invoice.org.addressLine2,
                city: invoice.org.city,
                state: invoice.org.state,
                zip: invoice.org.zip,
              }),
              phone: invoice.org.phone,
            },
            customer: {
              name: invoice.customer.name,
              addressLines: [invoice.customer.addressLine || ""].filter(Boolean),
            },
            lineItems: invoice.lineItems.map((lineItem) => ({
              description: lineItem.description,
              quantity: lineItem.quantity.toString(),
              unitPrice: lineItem.unitPrice.toString(),
              subtotal: lineItem.lineTotal.toString(),
            })),
            subtotal: invoice.subtotal.toString(),
            taxLabel: taxLabel ? `Tax (${taxLabel}%)` : null,
            taxAmount: invoice.taxAmount.toString(),
            total: invoice.total.toString(),
            notes: invoice.notes,
            paymentTerms: invoice.org.invoicePaymentInstructions,
          }}
        />
      </div>
    </section>
  );
}
