import { defaultContactNameForPhone } from "@/lib/lead-contact-resolution";

export type LeadCustomerBackfillLead = {
  id: string;
  contactName: string | null;
  businessName: string | null;
  createdAt: Date;
};

export type LeadCustomerBackfillDecision =
  | {
      kind: "attach_existing_customer";
      canApply: true;
      customerId: string;
    }
  | {
      kind: "create_customer";
      canApply: true;
    }
  | {
      kind: "missing_phone";
      canApply: false;
    }
  | {
      kind: "blocked_phone";
      canApply: false;
    }
  | {
      kind: "ambiguous_existing_customer";
      canApply: false;
      customerIds: string[];
    }
  | {
      kind: "conflicting_linked_customer";
      canApply: false;
      customerIds: string[];
    };

function uniqueIds(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function trimOrNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function pickLeadCustomerBackfillName(input: {
  phoneE164: string | null;
  leads: LeadCustomerBackfillLead[];
}) {
  const orderedLeads = [...input.leads].sort((left, right) => {
    const createdAtDiff = left.createdAt.getTime() - right.createdAt.getTime();
    if (createdAtDiff !== 0) {
      return createdAtDiff;
    }

    return left.id.localeCompare(right.id);
  });

  for (const lead of orderedLeads) {
    const contactName = trimOrNull(lead.contactName);
    if (contactName) {
      return contactName;
    }
  }

  for (const lead of orderedLeads) {
    const businessName = trimOrNull(lead.businessName);
    if (businessName) {
      return businessName;
    }
  }

  return defaultContactNameForPhone(input.phoneE164);
}

export function classifyLeadCustomerBackfill(input: {
  phoneE164: string | null;
  blockedPhone: boolean;
  exactCustomerIds: Array<string | null | undefined>;
  conflictingCustomerIds?: Array<string | null | undefined>;
}): LeadCustomerBackfillDecision {
  if (!input.phoneE164) {
    return {
      kind: "missing_phone",
      canApply: false,
    };
  }

  const conflictingCustomerIds = uniqueIds(input.conflictingCustomerIds || []);
  if (conflictingCustomerIds.length > 0) {
    return {
      kind: "conflicting_linked_customer",
      canApply: false,
      customerIds: conflictingCustomerIds,
    };
  }

  const exactCustomerIds = uniqueIds(input.exactCustomerIds);
  if (exactCustomerIds.length > 1) {
    return {
      kind: "ambiguous_existing_customer",
      canApply: false,
      customerIds: exactCustomerIds,
    };
  }

  if (exactCustomerIds.length === 1) {
    return {
      kind: "attach_existing_customer",
      canApply: true,
      customerId: exactCustomerIds[0]!,
    };
  }

  if (input.blockedPhone) {
    return {
      kind: "blocked_phone",
      canApply: false,
    };
  }

  return {
    kind: "create_customer",
    canApply: true,
  };
}
