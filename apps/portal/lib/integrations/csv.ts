function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const raw = String(value);
  if (raw.includes('"') || raw.includes(",") || raw.includes("\n") || raw.includes("\r")) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export function toCsvRows<T extends Record<string, unknown>>(rows: T[], columns: string[]): string {
  const header = columns.map(escapeCsvValue).join(",");
  const lines = rows.map((row) => columns.map((column) => escapeCsvValue(row[column])).join(","));
  return [header, ...lines].join("\n");
}
