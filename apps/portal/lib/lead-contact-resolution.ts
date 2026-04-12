import type { LeadPreferredLanguage, Prisma } from "@prisma/client";
import { findBlockedCallerByPhone } from "@/lib/blocked-callers";

type Tx = Prisma.TransactionClient;

export function defaultContactNameForPhone(phoneE164: string | null) {
  return phoneE164 || "Unknown caller";
}

export async function ensureLeadAndContactForInboundPhone(
  tx: Tx,
  input: {
    orgId: string;
    phoneE164: string | null;
    at: Date;
    preferredLanguage: LeadPreferredLanguage | null;
    leadSource: "CALL" | "OTHER";
    existingLeadId?: string | null;
    contactName?: string | null;
    businessName?: string | null;
    allowCreateLead?: boolean;
  },
) {
  if (!input.phoneE164) {
    return {
      leadId: null,
      contactId: null,
    };
  }

  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${input.orgId}), hashtext(${input.phoneE164}))
  `;

  const blockedCaller = await findBlockedCallerByPhone({
    orgId: input.orgId,
    phone: input.phoneE164,
    tx,
  });

  if (blockedCaller) {
    return {
      leadId: null,
      contactId: null,
    };
  }

  const lead =
    (input.existingLeadId
      ? await tx.lead.findFirst({
          where: {
            id: input.existingLeadId,
            orgId: input.orgId,
          },
          select: {
            id: true,
            customerId: true,
            contactName: true,
            businessName: true,
            firstContactedAt: true,
            lastInboundAt: true,
          },
        })
      : null) ||
    (await tx.lead.findFirst({
      where: {
        orgId: input.orgId,
        phoneE164: input.phoneE164,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        customerId: true,
        contactName: true,
        businessName: true,
        firstContactedAt: true,
        lastInboundAt: true,
      },
    }));

  if (!lead) {
    if (input.allowCreateLead === false) {
      return {
        leadId: null,
        contactId: null,
      };
    }

    const customer =
      (await tx.customer.findFirst({
        where: {
          orgId: input.orgId,
          phoneE164: input.phoneE164,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
        },
      })) ||
      (await tx.customer.create({
        data: {
          orgId: input.orgId,
          name:
            input.contactName ||
            input.businessName ||
            defaultContactNameForPhone(input.phoneE164),
          phoneE164: input.phoneE164,
        },
        select: {
          id: true,
        },
      }));

    const createdLead = await tx.lead.create({
      data: {
        orgId: input.orgId,
        customerId: customer.id,
        contactName: input.contactName || null,
        businessName: input.businessName || null,
        phoneE164: input.phoneE164,
        preferredLanguage: input.preferredLanguage,
        status: "NEW",
        leadSource: input.leadSource,
        firstContactedAt: input.at,
        lastContactedAt: input.at,
        lastInboundAt: input.at,
      },
      select: {
        id: true,
      },
    });

    return {
      leadId: createdLead.id,
      contactId: customer.id,
    };
  }

  const customer =
    (lead.customerId
      ? await tx.customer.findFirst({
          where: {
            id: lead.customerId,
            orgId: input.orgId,
          },
          select: {
            id: true,
          },
        })
      : null) ||
    (await tx.customer.findFirst({
      where: {
        orgId: input.orgId,
        phoneE164: input.phoneE164,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
      },
    })) ||
    (await tx.customer.create({
      data: {
        orgId: input.orgId,
        name:
          input.contactName ||
          lead.contactName ||
          input.businessName ||
          lead.businessName ||
          defaultContactNameForPhone(input.phoneE164),
        phoneE164: input.phoneE164,
      },
      select: {
        id: true,
      },
    }));

  await tx.lead.update({
    where: { id: lead.id },
    data: {
      customerId: lead.customerId || customer.id,
      firstContactedAt: lead.firstContactedAt || input.at,
      lastContactedAt: input.at,
      lastInboundAt: lead.lastInboundAt && lead.lastInboundAt >= input.at ? lead.lastInboundAt : input.at,
    },
  });

  return {
    leadId: lead.id,
    contactId: customer.id,
  };
}
