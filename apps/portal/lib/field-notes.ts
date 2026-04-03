export type FieldNoteMeasurement = {
  label: string;
  value: string;
  unit: string;
  notes: string;
};

export type FieldNoteMaterial = {
  name: string;
  quantity: string;
  unit: string;
  notes: string;
};

export type ParsedFieldNotes = {
  customer_name: string;
  project_type: string;
  site_address: string;
  measurements: FieldNoteMeasurement[];
  materials: FieldNoteMaterial[];
  scope_of_work: string;
  labor_notes: string;
  quote_amount: string;
  timeline: string;
  follow_up: string;
};

const MAX_MEASUREMENTS = 20;
const MAX_MATERIALS = 20;

function sanitizeText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function sanitizeMultilineText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, maxLength);
}

function sanitizeMeasurements(value: unknown): FieldNoteMeasurement[] {
  if (!Array.isArray(value)) return [];

  return value
    .slice(0, MAX_MEASUREMENTS)
    .map((entry) => {
      const row = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
      return {
        label: sanitizeText(row.label, 120),
        value: sanitizeText(row.value, 120),
        unit: sanitizeText(row.unit, 40),
        notes: sanitizeText(row.notes, 240),
      };
    })
    .filter((row) => row.label || row.value || row.unit || row.notes);
}

function sanitizeMaterials(value: unknown): FieldNoteMaterial[] {
  if (!Array.isArray(value)) return [];

  return value
    .slice(0, MAX_MATERIALS)
    .map((entry) => {
      const row = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
      return {
        name: sanitizeText(row.name, 120),
        quantity: sanitizeText(row.quantity, 80),
        unit: sanitizeText(row.unit, 40),
        notes: sanitizeText(row.notes, 240),
      };
    })
    .filter((row) => row.name || row.quantity || row.unit || row.notes);
}

export function createEmptyParsedFieldNotes(): ParsedFieldNotes {
  return {
    customer_name: "",
    project_type: "",
    site_address: "",
    measurements: [],
    materials: [],
    scope_of_work: "",
    labor_notes: "",
    quote_amount: "",
    timeline: "",
    follow_up: "",
  };
}

export function normalizeParsedFieldNotes(value: unknown): ParsedFieldNotes {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  return {
    customer_name: sanitizeText(input.customer_name, 160),
    project_type: sanitizeText(input.project_type, 160),
    site_address: sanitizeText(input.site_address, 240),
    measurements: sanitizeMeasurements(input.measurements),
    materials: sanitizeMaterials(input.materials),
    scope_of_work: sanitizeMultilineText(input.scope_of_work, 4000),
    labor_notes: sanitizeMultilineText(input.labor_notes, 4000),
    quote_amount: sanitizeText(input.quote_amount, 80),
    timeline: sanitizeText(input.timeline, 240),
    follow_up: sanitizeMultilineText(input.follow_up, 1200),
  };
}

export const fieldNotesJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    customer_name: { type: "string" },
    project_type: { type: "string" },
    site_address: { type: "string" },
    measurements: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          value: { type: "string" },
          unit: { type: "string" },
          notes: { type: "string" },
        },
        required: ["label", "value", "unit", "notes"],
      },
    },
    materials: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          quantity: { type: "string" },
          unit: { type: "string" },
          notes: { type: "string" },
        },
        required: ["name", "quantity", "unit", "notes"],
      },
    },
    scope_of_work: { type: "string" },
    labor_notes: { type: "string" },
    quote_amount: { type: "string" },
    timeline: { type: "string" },
    follow_up: { type: "string" },
  },
  required: [
    "customer_name",
    "project_type",
    "site_address",
    "measurements",
    "materials",
    "scope_of_work",
    "labor_notes",
    "quote_amount",
    "timeline",
    "follow_up",
  ],
} as const;

function listToLines(title: string, rows: string[]): string[] {
  if (rows.length === 0) return [];
  return ["", `${title}:`, ...rows.map((row) => `- ${row}`)];
}

export function buildFieldNotesLeadSummary(data: ParsedFieldNotes): string {
  const measurements = data.measurements.map((row) => {
    const base = [row.label, row.value && `${row.value}${row.unit ? ` ${row.unit}` : ""}`.trim()]
      .filter(Boolean)
      .join(": ");
    return row.notes ? `${base} (${row.notes})` : base;
  });

  const materials = data.materials.map((row) => {
    const quantity = [row.quantity, row.unit].filter(Boolean).join(" ");
    const base = [row.name, quantity].filter(Boolean).join(" - ");
    return row.notes ? `${base} (${row.notes})` : base;
  });

  const lines = [
    "AI Field Notes Scan",
    "",
    `Customer: ${data.customer_name || "-"}`,
    `Project Type: ${data.project_type || "-"}`,
    `Site Address: ${data.site_address || "-"}`,
    `Quoted Amount: ${data.quote_amount || "-"}`,
    `Timeline: ${data.timeline || "-"}`,
  ];

  lines.push(...listToLines("Measurements", measurements));
  lines.push(...listToLines("Materials", materials));

  if (data.scope_of_work) {
    lines.push("", "Scope of Work:", data.scope_of_work);
  }
  if (data.labor_notes) {
    lines.push("", "Labor Notes:", data.labor_notes);
  }
  if (data.follow_up) {
    lines.push("", "Follow Up:", data.follow_up);
  }

  return lines.join("\n").trim();
}

export function buildFieldNotesEstimateDraft(input: {
  data: ParsedFieldNotes;
  phoneE164: string;
}): string {
  const { data, phoneE164 } = input;
  const lines = [
    `Estimate Draft - ${data.customer_name || "Field Notes Scan"}`,
    "",
    `Customer: ${data.customer_name || "-"}`,
    `Phone: ${phoneE164}`,
    `Project Type: ${data.project_type || "-"}`,
    `Site Address: ${data.site_address || "-"}`,
    `Quoted Amount: ${data.quote_amount || "-"}`,
    `Timeline: ${data.timeline || "-"}`,
  ];

  lines.push(
    ...listToLines(
      "Measurements",
      data.measurements.map((row) => {
        const primary = [row.label, row.value && `${row.value}${row.unit ? ` ${row.unit}` : ""}`.trim()]
          .filter(Boolean)
          .join(": ");
        return row.notes ? `${primary} (${row.notes})` : primary;
      }),
    ),
  );

  lines.push(
    ...listToLines(
      "Materials",
      data.materials.map((row) => {
        const quantity = [row.quantity, row.unit].filter(Boolean).join(" ");
        const primary = [row.name, quantity].filter(Boolean).join(" - ");
        return row.notes ? `${primary} (${row.notes})` : primary;
      }),
    ),
  );

  if (data.scope_of_work) {
    lines.push("", "Scope:", data.scope_of_work);
  }
  if (data.labor_notes) {
    lines.push("", "Labor:", data.labor_notes);
  }
  if (data.follow_up) {
    lines.push("", "Follow Up:", data.follow_up);
  }

  return lines.join("\n").trim();
}

export function parseQuoteAmountToCents(value: string): number | null {
  const matches = [...value.matchAll(/([0-9]{1,3}(?:,[0-9]{3})*(?:\.\d+)?|[0-9]+(?:\.\d+)?)/g)];
  const first = matches[0]?.[1];
  if (!first) return null;

  const normalized = Number.parseFloat(first.replace(/,/g, ""));
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return null;
  }

  return Math.round(normalized * 100);
}
