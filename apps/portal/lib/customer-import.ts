import { normalizeE164 } from "@/lib/phone";

export const CUSTOMER_IMPORT_MAX_ROWS = 1000;
export const CUSTOMER_IMPORT_SAMPLE_LIMIT = 12;
export const CUSTOMER_IMPORT_TEMPLATE_HEADERS = [
  "Name",
  "Phone",
  "Email",
  "Address",
  "City",
  "Work Type",
  "Notes",
] as const;

export const CUSTOMER_IMPORT_FIELDS = [
  "name",
  "phone",
  "email",
  "address",
  "city",
  "businessType",
  "notes",
] as const;

export type CustomerImportField = (typeof CUSTOMER_IMPORT_FIELDS)[number];

export type CustomerImportMapping = Record<CustomerImportField, string | null>;

export type CustomerImportRawRow = Record<string, unknown>;

export type CustomerImportDecision =
  | "create_customer_and_lead"
  | "create_lead_for_existing_customer"
  | "attach_customer_to_existing_lead"
  | "update_existing_records"
  | "skip_duplicate_in_file"
  | "skip_invalid_phone"
  | "skip_blocked_phone"
  | "skip_ambiguous_customer"
  | "skip_ambiguous_lead";

export type NormalizedCustomerImportRow = {
  rowNumber: number;
  rawName: string | null;
  resolvedName: string;
  phoneRaw: string | null;
  phoneE164: string | null;
  email: string | null;
  addressLine: string | null;
  city: string | null;
  businessType: string | null;
  notes: string | null;
  issues: string[];
  warnings: string[];
};

export type CustomerImportPreviewRow = NormalizedCustomerImportRow & {
  decision: CustomerImportDecision;
  duplicateFilePhoneCount: number;
  existingCustomerCount: number;
  existingLeadCount: number;
  blockedPhone: boolean;
};

export type CustomerImportPreviewSummary = {
  totalRows: number;
  readyRows: number;
  skippedRows: number;
  duplicateInFileRows: number;
  blockedRows: number;
  invalidPhoneRows: number;
  ambiguousCustomerRows: number;
  ambiguousLeadRows: number;
  createCustomerRows: number;
  createLeadRows: number;
  attachExistingCustomerRows: number;
  updateExistingRecordRows: number;
};

type MappingHint = {
  field: CustomerImportField;
  aliases: string[];
};

const MAPPING_HINTS: MappingHint[] = [
  {
    field: "name",
    aliases: ["name", "customer name", "contact name", "full name", "client name", "customer"],
  },
  {
    field: "phone",
    aliases: ["phone", "phone number", "mobile", "cell", "telephone", "tel", "contact phone"],
  },
  {
    field: "email",
    aliases: ["email", "email address", "e-mail", "contact email"],
  },
  {
    field: "address",
    aliases: [
      "address",
      "street",
      "street address",
      "address line",
      "job address",
      "service address",
      "property address",
    ],
  },
  {
    field: "city",
    aliases: ["city", "town", "service city"],
  },
  {
    field: "businessType",
    aliases: ["service", "service type", "work type", "project type", "business type", "job type"],
  },
  {
    field: "notes",
    aliases: ["notes", "note", "customer notes", "job notes", "details", "description"],
  },
];

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function normalizeCell(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value).trim() || null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const asString = String(value).trim();
  return asString || null;
}

function trimToLength(value: string | null, maxLength: number): string | null {
  if (!value) return null;
  return value.slice(0, maxLength);
}

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
}

function csvRow(values: Array<string | number | null | undefined>): string {
  return values.map((value) => escapeCsvCell(String(value ?? ""))).join(",");
}

export function emptyCustomerImportMapping(): CustomerImportMapping {
  return {
    name: null,
    phone: null,
    email: null,
    address: null,
    city: null,
    businessType: null,
    notes: null,
  };
}

export function buildCustomerImportTemplateCsv(): string {
  const rows = [
    [...CUSTOMER_IMPORT_TEMPLATE_HEADERS],
    [
      "Jane Smith",
      "(253) 555-0142",
      "jane@example.com",
      "123 Cedar Ave",
      "Tacoma",
      "Retaining Wall",
      "Wants an estimate after 4 PM. Gate code 1942.",
    ],
    [
      "Luis Garcia",
      "(206) 555-0118",
      "luis@example.com",
      "8901 Pine St",
      "Seattle",
      "Pavers",
      "Front walkway redo. Prefers text updates.",
    ],
  ];

  return rows.map((row) => csvRow(row)).join("\r\n");
}

export function buildCustomerImportReviewCsv(rows: CustomerImportPreviewRow[]): string {
  const header = csvRow([
    "Row Number",
    "Customer Name",
    "Phone Raw",
    "Phone E164",
    "Email",
    "Address",
    "City",
    "Work Type",
    "Notes",
    "Decision",
    "Detail",
  ]);

  const body = rows.map((row) =>
    csvRow([
      row.rowNumber,
      row.resolvedName,
      row.phoneRaw,
      row.phoneE164,
      row.email,
      row.addressLine,
      row.city,
      row.businessType,
      row.notes,
      row.decision,
      row.issues[0] || row.warnings[0] || "",
    ]),
  );

  return [header, ...body].join("\r\n");
}

export function suggestCustomerImportMapping(headers: string[]): CustomerImportMapping {
  const available = headers.map((header) => ({
    original: header,
    normalized: normalizeHeader(header),
  }));
  const mapping = emptyCustomerImportMapping();
  const usedHeaders = new Set<string>();

  for (const hint of MAPPING_HINTS) {
    const match = available.find((header) => {
      if (usedHeaders.has(header.original)) return false;
      return hint.aliases.some((alias) => header.normalized === alias);
    });
    if (match) {
      mapping[hint.field] = match.original;
      usedHeaders.add(match.original);
      continue;
    }

    const partialMatch = available.find((header) => {
      if (usedHeaders.has(header.original)) return false;
      return hint.aliases.some(
        (alias) => header.normalized.includes(alias) || alias.includes(header.normalized),
      );
    });
    if (partialMatch) {
      mapping[hint.field] = partialMatch.original;
      usedHeaders.add(partialMatch.original);
    }
  }

  return mapping;
}

export function formatCustomerImportFallbackName(input: {
  rawName: string | null;
  email: string | null;
  phoneRaw: string | null;
  phoneE164: string | null;
  rowNumber: number;
}): string {
  if (input.rawName) return input.rawName;
  if (input.email) return input.email;
  if (input.phoneRaw) return input.phoneRaw;
  if (input.phoneE164) return input.phoneE164;
  return `Imported customer ${input.rowNumber}`;
}

export function normalizeCustomerImportRows(input: {
  rows: CustomerImportRawRow[];
  mapping: CustomerImportMapping;
}): NormalizedCustomerImportRow[] {
  return input.rows.slice(0, CUSTOMER_IMPORT_MAX_ROWS).map((row, index) => {
    const rawName = trimToLength(normalizeCell(input.mapping.name ? row[input.mapping.name] : null), 160);
    const phoneRaw = trimToLength(normalizeCell(input.mapping.phone ? row[input.mapping.phone] : null), 80);
    const email = trimToLength(normalizeCell(input.mapping.email ? row[input.mapping.email] : null), 320);
    const addressLine = trimToLength(
      normalizeCell(input.mapping.address ? row[input.mapping.address] : null),
      255,
    );
    const city = trimToLength(normalizeCell(input.mapping.city ? row[input.mapping.city] : null), 120);
    const businessType = trimToLength(
      normalizeCell(input.mapping.businessType ? row[input.mapping.businessType] : null),
      120,
    );
    const notes = trimToLength(normalizeCell(input.mapping.notes ? row[input.mapping.notes] : null), 4000);
    const phoneE164 = normalizeE164(phoneRaw);
    const issues: string[] = [];
    const warnings: string[] = [];

    if (!phoneRaw) {
      issues.push("Phone number is required.");
    } else if (!phoneE164) {
      issues.push("Phone number could not be normalized.");
    }

    if (!rawName) {
      warnings.push("Name is missing. TieGui will use email or phone as the fallback customer name.");
    }

    if (!email && !addressLine && !city && !businessType && !notes) {
      warnings.push("Only the name and phone will be imported from this row.");
    }

    return {
      rowNumber: index + 2,
      rawName,
      resolvedName: formatCustomerImportFallbackName({
        rawName,
        email,
        phoneRaw,
        phoneE164,
        rowNumber: index + 2,
      }),
      phoneRaw,
      phoneE164,
      email,
      addressLine,
      city,
      businessType,
      notes,
      issues,
      warnings,
    };
  });
}

export function decideCustomerImportRow(input: {
  row: NormalizedCustomerImportRow;
  duplicateFilePhoneCount: number;
  existingCustomerCount: number;
  existingLeadCount: number;
  blockedPhone: boolean;
}): CustomerImportDecision {
  if (input.row.issues.length > 0 || !input.row.phoneE164) {
    return "skip_invalid_phone";
  }

  if (input.duplicateFilePhoneCount > 1) {
    return "skip_duplicate_in_file";
  }

  if (input.blockedPhone) {
    return "skip_blocked_phone";
  }

  if (input.existingCustomerCount > 1) {
    return "skip_ambiguous_customer";
  }

  if (input.existingLeadCount > 1) {
    return "skip_ambiguous_lead";
  }

  if (input.existingCustomerCount === 0 && input.existingLeadCount === 0) {
    return "create_customer_and_lead";
  }

  if (input.existingCustomerCount === 1 && input.existingLeadCount === 0) {
    return "create_lead_for_existing_customer";
  }

  if (input.existingCustomerCount === 0 && input.existingLeadCount === 1) {
    return "attach_customer_to_existing_lead";
  }

  return "update_existing_records";
}

export function summarizeCustomerImportPreview(rows: CustomerImportPreviewRow[]): CustomerImportPreviewSummary {
  const summary: CustomerImportPreviewSummary = {
    totalRows: rows.length,
    readyRows: 0,
    skippedRows: 0,
    duplicateInFileRows: 0,
    blockedRows: 0,
    invalidPhoneRows: 0,
    ambiguousCustomerRows: 0,
    ambiguousLeadRows: 0,
    createCustomerRows: 0,
    createLeadRows: 0,
    attachExistingCustomerRows: 0,
    updateExistingRecordRows: 0,
  };

  for (const row of rows) {
    switch (row.decision) {
      case "skip_duplicate_in_file":
        summary.skippedRows += 1;
        summary.duplicateInFileRows += 1;
        break;
      case "skip_invalid_phone":
        summary.skippedRows += 1;
        summary.invalidPhoneRows += 1;
        break;
      case "skip_blocked_phone":
        summary.skippedRows += 1;
        summary.blockedRows += 1;
        break;
      case "skip_ambiguous_customer":
        summary.skippedRows += 1;
        summary.ambiguousCustomerRows += 1;
        break;
      case "skip_ambiguous_lead":
        summary.skippedRows += 1;
        summary.ambiguousLeadRows += 1;
        break;
      case "create_customer_and_lead":
        summary.readyRows += 1;
        summary.createCustomerRows += 1;
        summary.createLeadRows += 1;
        break;
      case "create_lead_for_existing_customer":
        summary.readyRows += 1;
        summary.createLeadRows += 1;
        summary.attachExistingCustomerRows += 1;
        break;
      case "attach_customer_to_existing_lead":
        summary.readyRows += 1;
        summary.createCustomerRows += 1;
        summary.updateExistingRecordRows += 1;
        break;
      case "update_existing_records":
        summary.readyRows += 1;
        summary.updateExistingRecordRows += 1;
        break;
    }
  }

  return summary;
}

export function shouldUpgradeImportedName(input: {
  existingName: string;
  importedName: string;
  phoneE164: string;
}): boolean {
  const existing = input.existingName.trim();
  const imported = input.importedName.trim();
  if (!imported) return false;
  if (!existing) return true;
  if (existing === imported) return false;

  const normalizedExisting = existing.toLowerCase();
  const normalizedImported = imported.toLowerCase();

  if (normalizedExisting === normalizedImported) {
    return false;
  }

  return (
    existing === input.phoneE164 ||
    normalizedExisting === input.phoneE164.toLowerCase() ||
    normalizedExisting.startsWith("imported customer ")
  );
}
