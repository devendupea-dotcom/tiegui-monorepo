import { Prisma, type Customer, type Lead } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  CUSTOMER_IMPORT_SAMPLE_LIMIT,
  decideCustomerImportRow,
  normalizeCustomerImportRows,
  summarizeCustomerImportPreview,
  type CustomerImportMapping,
  type CustomerImportPreviewRow,
  type CustomerImportPreviewSummary,
  type CustomerImportRawRow,
  type CustomerImportDecision,
  shouldUpgradeImportedName,
} from "@/lib/customer-import";

type CustomerImportLookup = {
  customersByPhone: Map<string, Array<{
    id: string;
    name: string;
    phoneE164: string;
    email: string | null;
    addressLine: string | null;
  }>>;
  leadsByPhone: Map<string, Array<{
    id: string;
    customerId: string | null;
    contactName: string | null;
    city: string | null;
    businessType: string | null;
    notes: string | null;
  }>>;
  blockedPhones: Set<string>;
};

export type CustomerImportPreviewResult = {
  rows: CustomerImportPreviewRow[];
  sampleRows: CustomerImportPreviewRow[];
  summary: ReturnType<typeof summarizeCustomerImportPreview>;
};

export type CustomerImportApplyResult = {
  totalRows: number;
  importedRows: number;
  skippedRows: number;
  createdCustomers: number;
  updatedCustomers: number;
  createdLeads: number;
  updatedLeads: number;
  createdLeadNotes: number;
  skipped: Array<{
    rowNumber: number;
    reason: string;
  }>;
};

type CustomerImportRunStats = {
  fileName: string | null;
  totalRows: number;
  importedRows: number;
  skippedRows: number;
  createdCustomers: number;
  updatedCustomers: number;
  createdLeads: number;
  updatedLeads: number;
  createdLeadNotes: number;
  previewSummary: CustomerImportPreviewSummary;
  skipped: Array<{
    rowNumber: number;
    reason: string;
  }>;
};

export type CustomerImportHistoryItem = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: "RUNNING" | "SUCCESS" | "FAILED";
  fileName: string | null;
  totalRows: number;
  importedRows: number;
  skippedRows: number;
  createdCustomers: number;
  updatedCustomers: number;
  createdLeads: number;
  updatedLeads: number;
  createdLeadNotes: number;
  actorName: string | null;
  actorEmail: string | null;
  errorMessage: string | null;
};

export type ApplyCustomerImportRowsResult = {
  outcome: CustomerImportApplyResult;
  historyItem: CustomerImportHistoryItem;
};

const IMPORT_HISTORY_LIMIT = 8;

const importRunHistorySelect = {
  id: true,
  startedAt: true,
  finishedAt: true,
  status: true,
  statsJson: true,
  errorJson: true,
  actorUser: {
    select: {
      name: true,
      email: true,
    },
  },
} satisfies Prisma.ImportRunSelect;

type ImportRunHistoryRecord = Prisma.ImportRunGetPayload<{
  select: typeof importRunHistorySelect;
}>;

function asPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function readJsonObject(value: Prisma.JsonValue | null | undefined): Record<string, Prisma.JsonValue> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, Prisma.JsonValue>;
}

function readJsonString(object: Record<string, Prisma.JsonValue> | null, key: string): string | null {
  const value = object?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readJsonNumber(object: Record<string, Prisma.JsonValue> | null, key: string): number {
  const value = object?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function buildCustomerImportRunStats(input: {
  fileName: string | null;
  previewSummary: CustomerImportPreviewSummary;
  outcome: CustomerImportApplyResult;
}): CustomerImportRunStats {
  return {
    fileName: input.fileName,
    totalRows: input.outcome.totalRows,
    importedRows: input.outcome.importedRows,
    skippedRows: input.outcome.skippedRows,
    createdCustomers: input.outcome.createdCustomers,
    updatedCustomers: input.outcome.updatedCustomers,
    createdLeads: input.outcome.createdLeads,
    updatedLeads: input.outcome.updatedLeads,
    createdLeadNotes: input.outcome.createdLeadNotes,
    previewSummary: input.previewSummary,
    skipped: input.outcome.skipped.slice(0, CUSTOMER_IMPORT_SAMPLE_LIMIT),
  };
}

function buildCustomerImportHistoryItem(run: ImportRunHistoryRecord): CustomerImportHistoryItem {
  const stats = readJsonObject(run.statsJson);
  const error = readJsonObject(run.errorJson);

  return {
    id: run.id,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    status: run.status,
    fileName: readJsonString(stats, "fileName"),
    totalRows: readJsonNumber(stats, "totalRows"),
    importedRows: readJsonNumber(stats, "importedRows"),
    skippedRows: readJsonNumber(stats, "skippedRows"),
    createdCustomers: readJsonNumber(stats, "createdCustomers"),
    updatedCustomers: readJsonNumber(stats, "updatedCustomers"),
    createdLeads: readJsonNumber(stats, "createdLeads"),
    updatedLeads: readJsonNumber(stats, "updatedLeads"),
    createdLeadNotes: readJsonNumber(stats, "createdLeadNotes"),
    actorName: run.actorUser?.name?.trim() || null,
    actorEmail: run.actorUser?.email?.trim() || null,
    errorMessage: readJsonString(error, "message"),
  };
}

export async function listCustomerImportRuns(input: {
  orgId: string;
  limit?: number;
}): Promise<CustomerImportHistoryItem[]> {
  const runs = await prisma.importRun.findMany({
    where: {
      orgId: input.orgId,
      provider: "MANUAL_FILE",
    },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take: input.limit || IMPORT_HISTORY_LIMIT,
    select: importRunHistorySelect,
  });

  return runs.map(buildCustomerImportHistoryItem);
}

function mapByPhone<T extends { phoneE164: string }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const existing = grouped.get(row.phoneE164) || [];
    existing.push(row);
    grouped.set(row.phoneE164, existing);
  }
  return grouped;
}

async function loadCustomerImportLookup(orgId: string, phones: string[]): Promise<CustomerImportLookup> {
  if (phones.length === 0) {
    return {
      customersByPhone: new Map(),
      leadsByPhone: new Map(),
      blockedPhones: new Set(),
    };
  }

  const [customers, leads, blockedCallers] = await Promise.all([
    prisma.customer.findMany({
      where: {
        orgId,
        phoneE164: { in: phones },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        phoneE164: true,
        email: true,
        addressLine: true,
      },
    }),
    prisma.lead.findMany({
      where: {
        orgId,
        phoneE164: { in: phones },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        customerId: true,
        contactName: true,
        city: true,
        businessType: true,
        notes: true,
        phoneE164: true,
      },
    }),
    prisma.blockedCaller.findMany({
      where: {
        orgId,
        phoneE164: { in: phones },
      },
      select: {
        phoneE164: true,
      },
    }),
  ]);

  return {
    customersByPhone: mapByPhone(customers),
    leadsByPhone: mapByPhone(leads),
    blockedPhones: new Set(blockedCallers.map((item) => item.phoneE164)),
  };
}

export async function previewCustomerImportRows(input: {
  orgId: string;
  rows: CustomerImportRawRow[];
  mapping: CustomerImportMapping;
}): Promise<CustomerImportPreviewResult> {
  const normalizedRows = normalizeCustomerImportRows({
    rows: input.rows,
    mapping: input.mapping,
  });

  const filePhoneCounts = new Map<string, number>();
  for (const row of normalizedRows) {
    if (!row.phoneE164) continue;
    filePhoneCounts.set(row.phoneE164, (filePhoneCounts.get(row.phoneE164) || 0) + 1);
  }

  const phones = [...new Set(normalizedRows.map((row) => row.phoneE164).filter((value): value is string => Boolean(value)))];
  const lookup = await loadCustomerImportLookup(input.orgId, phones);

  const rows = normalizedRows.map((row) => {
    const duplicateFilePhoneCount = row.phoneE164 ? filePhoneCounts.get(row.phoneE164) || 0 : 0;
    const existingCustomerCount = row.phoneE164 ? lookup.customersByPhone.get(row.phoneE164)?.length || 0 : 0;
    const existingLeadCount = row.phoneE164 ? lookup.leadsByPhone.get(row.phoneE164)?.length || 0 : 0;
    const blockedPhone = row.phoneE164 ? lookup.blockedPhones.has(row.phoneE164) : false;
    const decision = decideCustomerImportRow({
      row,
      duplicateFilePhoneCount,
      existingCustomerCount,
      existingLeadCount,
      blockedPhone,
    });
    const warnings = [...row.warnings];
    if (duplicateFilePhoneCount > 1 && row.phoneE164) {
      warnings.push(`Phone number appears in ${duplicateFilePhoneCount} rows in this file.`);
    }

    return {
      ...row,
      warnings,
      decision,
      duplicateFilePhoneCount,
      existingCustomerCount,
      existingLeadCount,
      blockedPhone,
    } satisfies CustomerImportPreviewRow;
  });

  return {
    rows,
    sampleRows: rows.slice(0, CUSTOMER_IMPORT_SAMPLE_LIMIT),
    summary: summarizeCustomerImportPreview(rows),
  };
}

function buildCustomerUpdateData(input: {
  customer: Pick<Customer, "name" | "phoneE164" | "email" | "addressLine">;
  imported: CustomerImportPreviewRow;
}): Prisma.CustomerUpdateInput {
  const data: Prisma.CustomerUpdateInput = {};

  if (input.imported.email && !input.customer.email) {
    data.email = input.imported.email;
  }
  if (input.imported.addressLine && !input.customer.addressLine) {
    data.addressLine = input.imported.addressLine;
  }
  if (
    shouldUpgradeImportedName({
      existingName: input.customer.name,
      importedName: input.imported.resolvedName,
      phoneE164: input.customer.phoneE164,
    })
  ) {
    data.name = input.imported.resolvedName;
  }

  return data;
}

function buildLeadUpdateData(input: {
  lead: Pick<Lead, "contactName" | "customerId" | "city" | "businessType" | "notes" | "phoneE164">;
  customerId: string;
  imported: CustomerImportPreviewRow;
}): Prisma.LeadUpdateInput {
  const data: Prisma.LeadUpdateInput = {};

  if (!input.lead.customerId) {
    data.customer = {
      connect: { id: input.customerId },
    };
  }
  if (
    input.imported.rawName &&
    (!input.lead.contactName ||
      shouldUpgradeImportedName({
        existingName: input.lead.contactName,
        importedName: input.imported.rawName,
        phoneE164: input.lead.phoneE164,
      }))
  ) {
    data.contactName = input.imported.rawName;
  }
  if (input.imported.city && !input.lead.city) {
    data.city = input.imported.city;
  }
  if (input.imported.businessType && !input.lead.businessType) {
    data.businessType = input.imported.businessType;
  }
  if (input.imported.notes && !input.lead.notes) {
    data.notes = input.imported.notes;
  }

  return data;
}

function describeDecision(decision: CustomerImportDecision): string {
  switch (decision) {
    case "skip_duplicate_in_file":
      return "Phone number appears more than once in the uploaded file.";
    case "skip_invalid_phone":
      return "Invalid or missing phone number.";
    case "skip_blocked_phone":
      return "Phone number is blocked in this workspace.";
    case "skip_ambiguous_customer":
      return "Multiple existing customers already use this phone number.";
    case "skip_ambiguous_lead":
      return "Multiple existing leads already use this phone number.";
    default:
      return "Skipped.";
  }
}

async function applySingleCustomerImportRow(input: {
  tx: Prisma.TransactionClient;
  orgId: string;
  actorUserId: string;
  row: CustomerImportPreviewRow;
}) {
  await input.tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${input.orgId}), hashtext(${input.row.phoneE164 || ""}))
  `;

  const blockedCaller = input.row.phoneE164
    ? await input.tx.blockedCaller.findUnique({
        where: {
          orgId_phoneE164: {
            orgId: input.orgId,
            phoneE164: input.row.phoneE164,
          },
        },
        select: { id: true },
      })
    : null;

  const customerMatches = input.row.phoneE164
    ? await input.tx.customer.findMany({
        where: {
          orgId: input.orgId,
          phoneE164: input.row.phoneE164,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          phoneE164: true,
          email: true,
          addressLine: true,
        },
      })
    : [];

  const leadMatches = input.row.phoneE164
    ? await input.tx.lead.findMany({
        where: {
          orgId: input.orgId,
          phoneE164: input.row.phoneE164,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          customerId: true,
          contactName: true,
          city: true,
          businessType: true,
          notes: true,
          phoneE164: true,
        },
      })
    : [];

  const decision = decideCustomerImportRow({
    row: input.row,
    duplicateFilePhoneCount: input.row.duplicateFilePhoneCount,
    existingCustomerCount: customerMatches.length,
    existingLeadCount: leadMatches.length,
    blockedPhone: Boolean(blockedCaller),
  });

  if (decision.startsWith("skip_")) {
    return {
      imported: false,
      reason: describeDecision(decision),
      createdCustomer: false,
      updatedCustomer: false,
      createdLead: false,
      updatedLead: false,
      createdLeadNote: false,
    };
  }

  const lead = leadMatches[0] || null;
  const leadLinkedCustomer =
    !customerMatches[0] && lead?.customerId
      ? await input.tx.customer.findFirst({
          where: {
            id: lead.customerId,
            orgId: input.orgId,
          },
          select: {
            id: true,
            name: true,
            phoneE164: true,
            email: true,
            addressLine: true,
          },
        })
      : null;

  let customer = customerMatches[0] || leadLinkedCustomer || null;
  let createdCustomer = false;
  let updatedCustomer = false;
  let createdLead = false;
  let updatedLead = false;
  let createdLeadNote = false;

  if (!customer) {
    customer = await input.tx.customer.create({
      data: {
        orgId: input.orgId,
        createdByUserId: input.actorUserId,
        name: input.row.resolvedName,
        phoneE164: input.row.phoneE164!,
        email: input.row.email,
        addressLine: input.row.addressLine,
      },
      select: {
        id: true,
        name: true,
        phoneE164: true,
        email: true,
        addressLine: true,
      },
    });
    createdCustomer = true;
  } else {
    const customerUpdateData = buildCustomerUpdateData({
      customer,
      imported: input.row,
    });
    if (Object.keys(customerUpdateData).length > 0) {
      customer = await input.tx.customer.update({
        where: { id: customer.id },
        data: customerUpdateData,
        select: {
          id: true,
          name: true,
          phoneE164: true,
          email: true,
          addressLine: true,
        },
      });
      updatedCustomer = true;
    }
  }

  if (!lead) {
    await input.tx.lead.create({
      data: {
        orgId: input.orgId,
        customerId: customer.id,
        createdByUserId: input.actorUserId,
        contactName: input.row.rawName,
        phoneE164: input.row.phoneE164!,
        status: "NEW",
        sourceType: "UNKNOWN",
        sourceChannel: "OTHER",
        leadSource: "OTHER",
        city: input.row.city,
        businessType: input.row.businessType,
        notes: input.row.notes,
      },
      select: { id: true },
    });
    createdLead = true;
  } else {
    const leadUpdateData = buildLeadUpdateData({
      lead,
      customerId: customer.id,
      imported: input.row,
    });

    if (Object.keys(leadUpdateData).length > 0) {
      await input.tx.lead.update({
        where: { id: lead.id },
        data: leadUpdateData,
      });
      updatedLead = true;
    }

    if (input.row.notes && lead.notes && !lead.notes.includes(input.row.notes)) {
      const noteBody = `Imported spreadsheet note: ${input.row.notes}`;
      const existingNote = await input.tx.leadNote.findFirst({
        where: {
          leadId: lead.id,
          body: noteBody,
        },
        select: { id: true },
      });

      if (!existingNote) {
        await input.tx.leadNote.create({
          data: {
            orgId: input.orgId,
            leadId: lead.id,
            createdByUserId: input.actorUserId,
            body: noteBody,
          },
          select: { id: true },
        });
        createdLeadNote = true;
      }
    }
  }

  return {
    imported: true,
    reason: null,
    createdCustomer,
    updatedCustomer,
    createdLead,
    updatedLead,
    createdLeadNote,
  };
}

export async function applyCustomerImportRows(input: {
  orgId: string;
  actorUserId: string;
  rows: CustomerImportRawRow[];
  mapping: CustomerImportMapping;
  fileName?: string | null;
}): Promise<ApplyCustomerImportRowsResult> {
  const preview = await previewCustomerImportRows({
    orgId: input.orgId,
    rows: input.rows,
    mapping: input.mapping,
  });

  const result: CustomerImportApplyResult = {
    totalRows: preview.rows.length,
    importedRows: 0,
    skippedRows: 0,
    createdCustomers: 0,
    updatedCustomers: 0,
    createdLeads: 0,
    updatedLeads: 0,
    createdLeadNotes: 0,
    skipped: [],
  };

  const importRun = await prisma.importRun.create({
    data: {
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      provider: "MANUAL_FILE",
      status: "RUNNING",
      statsJson: asPrismaJson(
        buildCustomerImportRunStats({
          fileName: input.fileName?.trim() || null,
          previewSummary: preview.summary,
          outcome: result,
        }),
      ),
    },
    select: importRunHistorySelect,
  });

  try {
    for (const row of preview.rows) {
      const rowResult = await prisma.$transaction((tx) =>
        applySingleCustomerImportRow({
          tx,
          orgId: input.orgId,
          actorUserId: input.actorUserId,
          row,
        }),
      );

      if (!rowResult.imported) {
        result.skippedRows += 1;
        result.skipped.push({
          rowNumber: row.rowNumber,
          reason: rowResult.reason || "Skipped.",
        });
        continue;
      }

      result.importedRows += 1;
      if (rowResult.createdCustomer) result.createdCustomers += 1;
      if (rowResult.updatedCustomer) result.updatedCustomers += 1;
      if (rowResult.createdLead) result.createdLeads += 1;
      if (rowResult.updatedLead) result.updatedLeads += 1;
      if (rowResult.createdLeadNote) result.createdLeadNotes += 1;
    }

    const completedRun = await prisma.importRun.update({
      where: { id: importRun.id },
      data: {
        status: "SUCCESS",
        finishedAt: new Date(),
        statsJson: asPrismaJson(
          buildCustomerImportRunStats({
            fileName: input.fileName?.trim() || null,
            previewSummary: preview.summary,
            outcome: result,
          }),
        ),
        errorJson: Prisma.JsonNull,
      },
      select: importRunHistorySelect,
    });

    return {
      outcome: result,
      historyItem: buildCustomerImportHistoryItem(completedRun),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import failed.";

    await prisma.importRun.update({
      where: { id: importRun.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        statsJson: asPrismaJson(
          buildCustomerImportRunStats({
            fileName: input.fileName?.trim() || null,
            previewSummary: preview.summary,
            outcome: result,
          }),
        ),
        errorJson: asPrismaJson({
          message,
        }),
      },
    }).catch(() => null);

    throw error;
  }
}
