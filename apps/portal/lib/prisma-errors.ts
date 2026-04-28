import { Prisma } from "@prisma/client";

const MISSING_TABLE_RE = /The table `public\.([^`]+)` does not exist in the current database\./i;

function normalizeTableName(value: string): string {
  return value.trim().replace(/^public\./i, "").toLowerCase();
}

export function isPrismaMissingTableError(error: unknown, tables?: string[]): boolean {
  const normalizedTables = tables?.map(normalizeTableName) || null;

  const matchesTable = (value: string | null | undefined) => {
    if (!value) return normalizedTables === null;
    if (normalizedTables === null) return true;
    return normalizedTables.includes(normalizeTableName(value));
  };

  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") {
    const table =
      typeof error.meta?.table === "string"
        ? error.meta.table
        : typeof error.meta?.modelName === "string"
          ? error.meta.modelName
          : null;
    return matchesTable(table);
  }

  const message = error instanceof Error ? error.message : "";
  const match = message.match(MISSING_TABLE_RE);
  if (!match) return false;
  return matchesTable(match[1] || null);
}

export function getDispatchSchemaErrorMessage(error: unknown): string | null {
  if (!isPrismaMissingTableError(error, ["Crew", "Job", "JobEvent"])) {
    return null;
  }

  return "Dispatch is unavailable until the latest database migrations are applied.";
}
