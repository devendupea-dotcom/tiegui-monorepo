import "server-only";

import { Prisma } from "@prisma/client";
import { AppApiError } from "@/lib/app-api-permissions";
import { type DispatchCustomerLookupItem, type DispatchLeadLookupItem } from "@/lib/dispatch";
import { sanitizeLeadBusinessTypeLabel } from "@/lib/lead-display";
import { resolveLeadLocationLabel } from "@/lib/lead-location";
import { prisma } from "@/lib/prisma";

function normalizeLookupQuery(value: string): string {
  return value.trim().slice(0, 120);
}

function formatLeadLookupLabel(input: {
  contactName: string | null;
  businessName: string | null;
  phoneE164: string;
}): string {
  return input.contactName || input.businessName || input.phoneE164;
}

function formatLeadLookupAddress(input: {
  intakeLocationText: string | null;
  city: string | null;
}): string | null {
  return (
    resolveLeadLocationLabel({
      intakeLocationText: input.intakeLocationText,
      city: input.city,
    }) || null
  );
}

function formatLeadLookupServiceType(input: {
  businessType: string | null;
  intakeWorkTypeText: string | null;
}): string | null {
  return sanitizeLeadBusinessTypeLabel(input.businessType) || sanitizeLeadBusinessTypeLabel(input.intakeWorkTypeText);
}

export async function searchDispatchLookups(input: {
  orgId: string;
  query: string;
  limit?: number;
}): Promise<{
  customers: DispatchCustomerLookupItem[];
  leads: DispatchLeadLookupItem[];
}> {
  const query = normalizeLookupQuery(input.query);
  const limit = Math.max(1, Math.min(8, input.limit ?? 6));

  if (query.length === 1) {
    throw new AppApiError("Type at least 2 characters to search.", 400);
  }

  const customerWhere: Prisma.CustomerWhereInput = {
    orgId: input.orgId,
    ...(query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { phoneE164: { contains: query, mode: "insensitive" } },
            { email: { contains: query, mode: "insensitive" } },
            { addressLine: { contains: query, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const leadWhere: Prisma.LeadWhereInput = {
    orgId: input.orgId,
    ...(query
      ? {
          OR: [
            { contactName: { contains: query, mode: "insensitive" } },
            { businessName: { contains: query, mode: "insensitive" } },
            { phoneE164: { contains: query, mode: "insensitive" } },
            { businessType: { contains: query, mode: "insensitive" } },
            { intakeWorkTypeText: { contains: query, mode: "insensitive" } },
            { intakeLocationText: { contains: query, mode: "insensitive" } },
            { city: { contains: query, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [customers, leads] = await Promise.all([
    prisma.customer.findMany({
      where: customerWhere,
      select: {
        id: true,
        name: true,
        phoneE164: true,
        addressLine: true,
      },
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
      take: limit,
    }),
    prisma.lead.findMany({
      where: leadWhere,
      select: {
        id: true,
        contactName: true,
        businessName: true,
        phoneE164: true,
        businessType: true,
        intakeWorkTypeText: true,
        intakeLocationText: true,
        city: true,
        customerId: true,
        customer: {
          select: {
            name: true,
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: limit,
    }),
  ]);

  return {
    customers: customers.map((customer) => ({
      id: customer.id,
      name: customer.name,
      phone: customer.phoneE164,
      address: customer.addressLine,
    })),
    leads: leads.map((lead) => ({
      id: lead.id,
      label: formatLeadLookupLabel(lead),
      phone: lead.phoneE164,
      serviceType: formatLeadLookupServiceType(lead),
      address: formatLeadLookupAddress(lead),
      customerId: lead.customerId,
      customerName: lead.customer?.name || null,
    })),
  };
}
