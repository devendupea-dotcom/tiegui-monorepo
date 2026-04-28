"use client";

import { startTransition, useState } from "react";
import { useLocale } from "next-intl";
import {
  buildCustomerImportReviewCsv,
  CUSTOMER_IMPORT_FIELDS,
  CUSTOMER_IMPORT_MAX_ROWS,
  CUSTOMER_IMPORT_SAMPLE_LIMIT,
  buildCustomerImportTemplateCsv,
  type CustomerImportDecision,
  type CustomerImportField,
  type CustomerImportMapping,
  type CustomerImportPreviewRow,
  type CustomerImportPreviewSummary,
  type CustomerImportRawRow,
  emptyCustomerImportMapping,
  suggestCustomerImportMapping,
} from "@/lib/customer-import";
import type { CustomerImportHistoryItem } from "@/lib/customer-import-crm";

const CUSTOMER_IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;
const CUSTOMER_IMPORT_SUPPORTED_FILE_PATTERN = /\.(csv|xlsx)$/i;

type SpreadsheetParseResult = {
  headers: string[];
  rows: CustomerImportRawRow[];
};

type PreviewState = {
  rows: CustomerImportPreviewRow[];
  summary: CustomerImportPreviewSummary;
  sampleRows: CustomerImportPreviewRow[];
};

type ImportOutcome = {
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

type Copy = {
  title: string;
  body: string;
  templateAction: string;
  templateHelp: string;
  reviewAction: string;
  fileLabel: string;
  fileHelp: string;
  firstSheetNotice: string;
  loadedLabel: string;
  mappingTitle: string;
  mappingBody: string;
  fields: Record<CustomerImportField, string>;
  none: string;
  refreshPreview: string;
  previewing: string;
  previewTitle: string;
  summaryTitle: string;
  summaryLabels: {
    totalRows: string;
    readyRows: string;
    skippedRows: string;
    duplicateRows: string;
    createCustomers: string;
    createLeads: string;
    updateRows: string;
  };
  table: {
    row: string;
    customer: string;
    phone: string;
    action: string;
    detail: string;
  };
  decisions: Record<CustomerImportDecision, string>;
  importAction: string;
  importing: string;
  importResultTitle: string;
  importResultLabels: {
    importedRows: string;
    skippedRows: string;
    createdCustomers: string;
    updatedCustomers: string;
    createdLeads: string;
    updatedLeads: string;
    createdLeadNotes: string;
  };
  skippedTitle: string;
  skippedRowLabel: string;
  historyTitle: string;
  historyBody: string;
  historyEmpty: string;
  historyLabels: {
    started: string;
    actor: string;
    result: string;
    error: string;
  };
  historyStatus: {
    RUNNING: string;
    SUCCESS: string;
    FAILED: string;
  };
  importedSummary: (importedRows: number, skippedRows: number) => string;
  actorFallback: string;
  fileFallback: string;
  parseErrorPrefix: string;
  previewErrorPrefix: string;
  importErrorPrefix: string;
  emptyFile: string;
  noHeaderRow: string;
  tooManyRows: (limit: number) => string;
  fileTooLarge: (maxMegabytes: number) => string;
  unsupportedFile: string;
};

function getCopy(locale: string): Copy {
  if (locale.startsWith("es")) {
    return {
      title: "Importar CSV o Excel al CRM",
      body: "Sube un archivo CSV o XLSX para traer clientes al CRM. TieGui usa la primera hoja, detecta columnas comunes y te deja revisar antes de importar.",
      templateAction: "Descargar plantilla CSV",
      templateHelp: "Usa una plantilla limpia si necesitas acomodar tus columnas antes de importar.",
      reviewAction: "Descargar CSV de revisión",
      fileLabel: "Archivo",
      fileHelp: "Tipos soportados: CSV, XLSX.",
      firstSheetNotice: "Para archivos de Excel usamos solo la primera hoja.",
      loadedLabel: "Archivo cargado",
      mappingTitle: "Mapeo de columnas",
      mappingBody: "Ajusta el mapeo si tu hoja usa nombres distintos. El teléfono es obligatorio para importar al CRM.",
      fields: {
        name: "Nombre",
        phone: "Teléfono",
        email: "Email",
        address: "Dirección",
        city: "Ciudad",
        businessType: "Tipo de trabajo",
        notes: "Notas",
      },
      none: "Sin mapear",
      refreshPreview: "Actualizar vista previa",
      previewing: "Revisando archivo...",
      previewTitle: "Vista previa",
      summaryTitle: "Resumen",
      summaryLabels: {
        totalRows: "Filas",
        readyRows: "Listas",
        skippedRows: "Omitidas",
        duplicateRows: "Duplicadas en archivo",
        createCustomers: "Crearán cliente",
        createLeads: "Crearán lead",
        updateRows: "Actualizarán existentes",
      },
      table: {
        row: "Fila",
        customer: "Cliente",
        phone: "Teléfono",
        action: "Acción",
        detail: "Detalle",
      },
      decisions: {
        create_customer_and_lead: "Crear cliente y lead",
        create_lead_for_existing_customer: "Crear lead para cliente existente",
        attach_customer_to_existing_lead: "Crear cliente y enlazar lead existente",
        update_existing_records: "Actualizar registros existentes",
        skip_duplicate_in_file: "Omitir: duplicada en archivo",
        skip_invalid_phone: "Omitir: teléfono inválido",
        skip_blocked_phone: "Omitir: número bloqueado",
        skip_ambiguous_customer: "Omitir: clientes duplicados",
        skip_ambiguous_lead: "Omitir: leads duplicados",
      },
      importAction: "Importar al CRM",
      importing: "Importando...",
      importResultTitle: "Resultado de importación",
      importResultLabels: {
        importedRows: "Filas importadas",
        skippedRows: "Filas omitidas",
        createdCustomers: "Clientes creados",
        updatedCustomers: "Clientes actualizados",
        createdLeads: "Leads creados",
        updatedLeads: "Leads actualizados",
        createdLeadNotes: "Notas creadas",
      },
      skippedTitle: "Filas omitidas",
      skippedRowLabel: "Fila",
      historyTitle: "Importaciones recientes",
      historyBody: "TieGui guarda las últimas importaciones del CRM para que puedas revisar qué archivo entró, quién lo corrió y cuántos registros se crearon o actualizaron.",
      historyEmpty: "Todavía no hay importaciones del CRM registradas.",
      historyLabels: {
        started: "Inicio",
        actor: "Hecho por",
        result: "Resultado",
        error: "Error",
      },
      historyStatus: {
        RUNNING: "En curso",
        SUCCESS: "Exitosa",
        FAILED: "Falló",
      },
      importedSummary: (importedRows, skippedRows) => `${importedRows} importadas, ${skippedRows} omitidas`,
      actorFallback: "Usuario desconocido",
      fileFallback: "Archivo subido",
      parseErrorPrefix: "No se pudo leer el archivo: ",
      previewErrorPrefix: "No se pudo generar la vista previa: ",
      importErrorPrefix: "No se pudo importar: ",
      emptyFile: "El archivo no tiene filas con datos.",
      noHeaderRow: "El archivo necesita una fila de encabezados.",
      tooManyRows: (limit) => `Este importador soporta hasta ${limit} filas por corrida.`,
      fileTooLarge: (maxMegabytes) => `El archivo debe pesar ${maxMegabytes} MB o menos.`,
      unsupportedFile: "Sube un archivo CSV o XLSX.",
    };
  }

  return {
    title: "Import CSV or Excel Into CRM",
    body: "Upload a CSV or XLSX file to bring customer data into the CRM. TieGui uses the first sheet, detects common columns, and lets you review everything before import.",
    templateAction: "Download CSV Template",
    templateHelp: "Start from a clean template if you need to reshape your columns before import.",
    reviewAction: "Download Review CSV",
    fileLabel: "File",
    fileHelp: "Supported types: CSV, XLSX.",
    firstSheetNotice: "For Excel files, TieGui uses the first sheet only.",
    loadedLabel: "Loaded file",
    mappingTitle: "Column Mapping",
    mappingBody: "Adjust the mapping if your sheet uses different headers. A phone column is required for CRM import.",
    fields: {
      name: "Name",
      phone: "Phone",
      email: "Email",
      address: "Address",
      city: "City",
      businessType: "Work Type",
      notes: "Notes",
    },
    none: "Not mapped",
    refreshPreview: "Refresh Preview",
    previewing: "Reviewing file...",
    previewTitle: "Preview",
    summaryTitle: "Summary",
    summaryLabels: {
      totalRows: "Rows",
      readyRows: "Ready",
      skippedRows: "Skipped",
      duplicateRows: "Duplicates in file",
      createCustomers: "Will create customer",
      createLeads: "Will create lead",
      updateRows: "Will update existing",
    },
    table: {
      row: "Row",
      customer: "Customer",
      phone: "Phone",
      action: "Action",
      detail: "Detail",
    },
    decisions: {
      create_customer_and_lead: "Create customer and lead",
      create_lead_for_existing_customer: "Create lead for existing customer",
      attach_customer_to_existing_lead: "Create customer and attach existing lead",
      update_existing_records: "Update existing records",
      skip_duplicate_in_file: "Skip: duplicate in file",
      skip_invalid_phone: "Skip: invalid phone",
      skip_blocked_phone: "Skip: blocked number",
      skip_ambiguous_customer: "Skip: duplicate customers",
      skip_ambiguous_lead: "Skip: duplicate leads",
    },
    importAction: "Import Into CRM",
    importing: "Importing...",
    importResultTitle: "Import Result",
    importResultLabels: {
      importedRows: "Imported rows",
      skippedRows: "Skipped rows",
      createdCustomers: "Customers created",
      updatedCustomers: "Customers updated",
      createdLeads: "Leads created",
      updatedLeads: "Leads updated",
      createdLeadNotes: "Notes created",
    },
    skippedTitle: "Skipped Rows",
    skippedRowLabel: "Row",
    historyTitle: "Recent Imports",
    historyBody: "TieGui keeps the latest CRM imports so you can review which file ran, who ran it, and how many records were created or updated.",
    historyEmpty: "No CRM imports have been recorded yet.",
    historyLabels: {
      started: "Started",
      actor: "By",
      result: "Result",
      error: "Error",
    },
    historyStatus: {
      RUNNING: "Running",
      SUCCESS: "Success",
      FAILED: "Failed",
    },
    importedSummary: (importedRows, skippedRows) => `${importedRows} imported, ${skippedRows} skipped`,
    actorFallback: "Unknown user",
    fileFallback: "Uploaded file",
    parseErrorPrefix: "Couldn't read file: ",
    previewErrorPrefix: "Couldn't build preview: ",
    importErrorPrefix: "Couldn't import: ",
    emptyFile: "The file does not contain any data rows.",
    noHeaderRow: "The file needs a header row.",
    tooManyRows: (limit) => `This importer supports up to ${limit} rows per run.`,
    fileTooLarge: (maxMegabytes) => `File must be ${maxMegabytes} MB or smaller.`,
    unsupportedFile: "Upload a CSV or XLSX file.",
  };
}

function validateSpreadsheetFileBeforeParsing(file: File) {
  if (!CUSTOMER_IMPORT_SUPPORTED_FILE_PATTERN.test(file.name)) {
    throw new Error("unsupported-file");
  }

  if (file.size > CUSTOMER_IMPORT_MAX_FILE_BYTES) {
    throw new Error(
      `file-too-large:${Math.round(CUSTOMER_IMPORT_MAX_FILE_BYTES / 1024 / 1024)}`,
    );
  }
}

async function readCsvMatrix(file: File): Promise<unknown[][]> {
  const Papa = await import("papaparse");
  const result = Papa.parse<unknown[]>(await file.text(), {
    skipEmptyLines: false,
  });

  if (result.errors.length > 0) {
    throw new Error(result.errors[0]?.message || "invalid-csv");
  }

  return result.data;
}

async function readXlsxMatrix(file: File): Promise<unknown[][]> {
  const { readSheet } = await import("read-excel-file/browser");
  return readSheet(file, 1);
}

function normalizeSpreadsheetMatrix(matrix: unknown[][]): SpreadsheetParseResult {
  if (!Array.isArray(matrix) || matrix.length === 0) {
    throw new Error("missing-headers");
  }

  const headerRow = Array.isArray(matrix[0]) ? matrix[0] : [];
  const headers = headerRow.map((value, index) => {
    const normalized = String(value || "").trim();
    return normalized || `Column ${index + 1}`;
  });

  if (headers.length === 0) {
    throw new Error("missing-headers");
  }

  const dataRows = matrix.slice(1).filter((row) => {
    if (!Array.isArray(row)) return false;
    return row.some((cell) => String(cell ?? "").trim() !== "");
  });

  if (dataRows.length === 0) {
    throw new Error("empty-file");
  }

  if (dataRows.length > CUSTOMER_IMPORT_MAX_ROWS) {
    throw new Error(`too-many:${CUSTOMER_IMPORT_MAX_ROWS}`);
  }

  const rows = dataRows.map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, Array.isArray(row) ? row[index] ?? "" : ""])),
  );

  return {
    headers,
    rows,
  };
}

async function parseSpreadsheetFile(file: File): Promise<SpreadsheetParseResult> {
  validateSpreadsheetFileBeforeParsing(file);

  const matrix = file.name.toLowerCase().endsWith(".csv")
    ? await readCsvMatrix(file)
    : await readXlsxMatrix(file);

  return normalizeSpreadsheetMatrix(matrix);
}

function describeRowDetail(row: CustomerImportPreviewRow) {
  return row.issues[0] || row.warnings[0] || "-";
}

type CustomerDataImportCardProps = {
  orgId: string;
  initialHistory: CustomerImportHistoryItem[];
};

export default function CustomerDataImportCard({ orgId, initialHistory }: CustomerDataImportCardProps) {
  const locale = useLocale();
  const copy = getCopy(locale);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<CustomerImportRawRow[]>([]);
  const [mapping, setMapping] = useState<CustomerImportMapping>(emptyCustomerImportMapping());
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [history, setHistory] = useState<CustomerImportHistoryItem[]>(initialHistory);
  const [error, setError] = useState("");
  const [parsing, setParsing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const historyDateFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  function handleDownloadTemplate() {
    const blob = new Blob([buildCustomerImportTemplateCsv()], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "tiegui-customer-import-template.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function handleDownloadReviewCsv() {
    if (!preview) return;
    const blob = new Blob([buildCustomerImportReviewCsv(preview.rows)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName
      ? fileName.replace(/\.(csv|xlsx)$/i, "") + "-review.csv"
      : "tiegui-customer-import-review.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function runPreview(
    nextRows: CustomerImportRawRow[],
    nextMapping: CustomerImportMapping,
    options?: { preserveOutcome?: boolean },
  ) {
    setPreviewing(true);
    setError("");
    if (!options?.preserveOutcome) {
      setOutcome(null);
    }

    try {
      const response = await fetch("/api/customer-imports/preview", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          orgId,
          rows: nextRows,
          mapping: nextMapping,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { ok: true; rows: CustomerImportPreviewRow[]; summary: CustomerImportPreviewSummary; sampleRows: CustomerImportPreviewRow[] }
        | { ok: false; error?: string }
        | null;

      if (!response.ok || !payload || !payload.ok) {
        throw new Error(payload && "error" in payload ? payload.error || "preview-failed" : "preview-failed");
      }

      setPreview({
        rows: payload.rows,
        summary: payload.summary,
        sampleRows: payload.sampleRows,
      });
    } catch (previewError) {
      setPreview(null);
      setError(`${copy.previewErrorPrefix}${previewError instanceof Error ? previewError.message : "preview-failed"}`);
    } finally {
      setPreviewing(false);
    }
  }

  async function handleFileSelected(file: File) {
    setParsing(true);
    setError("");
    setPreview(null);
    setOutcome(null);

    try {
      const parsed = await parseSpreadsheetFile(file);
      const suggestedMapping = suggestCustomerImportMapping(parsed.headers);

      startTransition(() => {
        setFileName(file.name);
        setHeaders(parsed.headers);
        setRows(parsed.rows);
        setMapping(suggestedMapping);
      });

      await runPreview(parsed.rows, suggestedMapping);
    } catch (parseError) {
      const message =
        parseError instanceof Error
          ? parseError.message === "empty-file"
            ? copy.emptyFile
            : parseError.message === "missing-headers"
              ? copy.noHeaderRow
              : parseError.message === "unsupported-file"
                ? copy.unsupportedFile
                : parseError.message.startsWith("file-too-large:")
                  ? copy.fileTooLarge(Number(parseError.message.split(":")[1] || 5))
                  : parseError.message.startsWith("too-many:")
                    ? copy.tooManyRows(Number(parseError.message.split(":")[1] || CUSTOMER_IMPORT_MAX_ROWS))
                    : parseError.message
          : "parse-failed";
      setError(`${copy.parseErrorPrefix}${message}`);
      startTransition(() => {
        setFileName("");
        setHeaders([]);
        setRows([]);
        setMapping(emptyCustomerImportMapping());
      });
    } finally {
      setParsing(false);
    }
  }

  function handleMappingChange(field: CustomerImportField, value: string) {
    setPreview(null);
    setOutcome(null);
    setMapping((current) => {
      const next = { ...current };
      for (const key of CUSTOMER_IMPORT_FIELDS) {
        if (key !== field && value && next[key] === value) {
          next[key] = null;
        }
      }
      next[field] = value || null;
      return next;
    });
  }

  async function handleImport() {
    if (rows.length === 0) return;

    setImporting(true);
    setError("");
    try {
      const response = await fetch("/api/customer-imports/import", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          orgId,
          rows,
          mapping,
          fileName,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { ok: true; outcome: ImportOutcome; historyItem: CustomerImportHistoryItem }
        | { ok: false; error?: string }
        | null;

      if (!response.ok || !payload || !payload.ok) {
        throw new Error(payload && "error" in payload ? payload.error || "import-failed" : "import-failed");
      }

      setOutcome(payload.outcome);
      setHistory((current) => [payload.historyItem, ...current.filter((item) => item.id !== payload.historyItem.id)].slice(0, 8));
      await runPreview(rows, mapping, { preserveOutcome: true });
    } catch (importError) {
      setError(`${copy.importErrorPrefix}${importError instanceof Error ? importError.message : "import-failed"}`);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>{copy.title}</h3>
      <p className="muted">{copy.body}</p>

      <div className="auth-form" style={{ marginTop: 12 }}>
        <div className="quick-links" style={{ marginBottom: 10 }}>
          <button className="btn secondary" type="button" onClick={handleDownloadTemplate}>
            {copy.templateAction}
          </button>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>{copy.templateHelp}</p>
        <label>
          {copy.fileLabel}
          <input
            type="file"
            accept=".csv,.xlsx"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void handleFileSelected(file);
              }
            }}
          />
        </label>
        <p className="muted" style={{ marginTop: -4 }}>
          {copy.fileHelp} {copy.firstSheetNotice}
        </p>
        {fileName ? (
          <p className="muted">
            {copy.loadedLabel}: {fileName}
          </p>
        ) : null}
        {parsing ? <p className="form-status">{copy.previewing}</p> : null}
        {error ? <p className="form-status">{error}</p> : null}
      </div>

      {headers.length > 0 ? (
        <div style={{ marginTop: 20 }}>
          <h4 style={{ marginBottom: 6 }}>{copy.mappingTitle}</h4>
          <p className="muted">{copy.mappingBody}</p>
          <div className="grid" style={{ marginTop: 12 }}>
            {CUSTOMER_IMPORT_FIELDS.map((field) => (
              <label key={field}>
                {copy.fields[field]}
                <select
                  value={mapping[field] || ""}
                  onChange={(event) => handleMappingChange(field, event.target.value)}
                >
                  <option value="">{copy.none}</option>
                  {headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="quick-links" style={{ marginTop: 12 }}>
            <button
              className="btn secondary"
              type="button"
              onClick={() => void runPreview(rows, mapping)}
              disabled={previewing}
            >
              {previewing ? copy.previewing : copy.refreshPreview}
            </button>
            {preview ? (
              <button className="btn secondary" type="button" onClick={handleDownloadReviewCsv}>
                {copy.reviewAction}
              </button>
            ) : null}
            <button
              className="btn primary"
              type="button"
              onClick={() => void handleImport()}
              disabled={previewing || importing || !preview || preview.summary.readyRows === 0}
            >
              {importing ? copy.importing : copy.importAction}
            </button>
          </div>
        </div>
      ) : null}

      {preview ? (
        <div style={{ marginTop: 20 }}>
          <h4 style={{ marginBottom: 6 }}>{copy.previewTitle}</h4>
          <div className="grid">
            <article className="card" style={{ margin: 0 }}>
              <h5 style={{ marginTop: 0 }}>{copy.summaryTitle}</h5>
              <ul className="list" style={{ marginTop: 8 }}>
                <li>{copy.summaryLabels.totalRows}: {preview.summary.totalRows}</li>
                <li>{copy.summaryLabels.readyRows}: {preview.summary.readyRows}</li>
                <li>{copy.summaryLabels.skippedRows}: {preview.summary.skippedRows}</li>
                <li>{copy.summaryLabels.duplicateRows}: {preview.summary.duplicateInFileRows}</li>
                <li>{copy.summaryLabels.createCustomers}: {preview.summary.createCustomerRows}</li>
                <li>{copy.summaryLabels.createLeads}: {preview.summary.createLeadRows}</li>
                <li>{copy.summaryLabels.updateRows}: {preview.summary.updateExistingRecordRows}</li>
              </ul>
            </article>
          </div>

          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{copy.table.row}</th>
                  <th>{copy.table.customer}</th>
                  <th>{copy.table.phone}</th>
                  <th>{copy.table.action}</th>
                  <th>{copy.table.detail}</th>
                </tr>
              </thead>
              <tbody>
                {preview.sampleRows.map((row) => (
                  <tr key={`${row.rowNumber}-${row.phoneRaw || row.resolvedName}`}>
                    <td>{row.rowNumber}</td>
                    <td>{row.resolvedName}</td>
                    <td>{row.phoneE164 || row.phoneRaw || "-"}</td>
                    <td>{copy.decisions[row.decision]}</td>
                    <td>{describeRowDetail(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {outcome ? (
        <div style={{ marginTop: 20 }}>
          <h4 style={{ marginBottom: 6 }}>{copy.importResultTitle}</h4>
          <ul className="list" style={{ marginTop: 8 }}>
            <li>{copy.importResultLabels.importedRows}: {outcome.importedRows}</li>
            <li>{copy.importResultLabels.skippedRows}: {outcome.skippedRows}</li>
            <li>{copy.importResultLabels.createdCustomers}: {outcome.createdCustomers}</li>
            <li>{copy.importResultLabels.updatedCustomers}: {outcome.updatedCustomers}</li>
            <li>{copy.importResultLabels.createdLeads}: {outcome.createdLeads}</li>
            <li>{copy.importResultLabels.updatedLeads}: {outcome.updatedLeads}</li>
            <li>{copy.importResultLabels.createdLeadNotes}: {outcome.createdLeadNotes}</li>
          </ul>

          {outcome.skipped.length > 0 ? (
            <>
              <h5 style={{ marginBottom: 6 }}>{copy.skippedTitle}</h5>
              <ul className="list" style={{ marginTop: 8 }}>
                {outcome.skipped.slice(0, CUSTOMER_IMPORT_SAMPLE_LIMIT).map((item) => (
                  <li key={`${item.rowNumber}-${item.reason}`}>
                    {copy.skippedRowLabel} {item.rowNumber}: {item.reason}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}

      <div style={{ marginTop: 20 }}>
        <h4 style={{ marginBottom: 6 }}>{copy.historyTitle}</h4>
        <p className="muted">{copy.historyBody}</p>
        {history.length === 0 ? (
          <p className="muted" style={{ marginTop: 8 }}>{copy.historyEmpty}</p>
        ) : (
          <div className="grid" style={{ marginTop: 12 }}>
            {history.map((item) => {
              const actorLabel = item.actorName || item.actorEmail || copy.actorFallback;
              const startedLabel = historyDateFormatter.format(new Date(item.startedAt));
              return (
                <article key={item.id} className="card" style={{ margin: 0 }}>
                  <p style={{ margin: 0 }}>
                    <strong>{item.fileName || copy.fileFallback}</strong>
                  </p>
                  <p className="muted" style={{ marginTop: 8 }}>
                    {copy.historyLabels.started}: {startedLabel}
                  </p>
                  <p className="muted">
                    {copy.historyLabels.actor}: {actorLabel}
                  </p>
                  <p className="muted">
                    {copy.historyLabels.result}: {copy.historyStatus[item.status]} · {copy.importedSummary(item.importedRows, item.skippedRows)}
                  </p>
                  <p className="muted">
                    {copy.importResultLabels.createdCustomers}: {item.createdCustomers} · {copy.importResultLabels.createdLeads}: {item.createdLeads}
                  </p>
                  {(item.updatedCustomers > 0 || item.updatedLeads > 0 || item.createdLeadNotes > 0) ? (
                    <p className="muted">
                      {copy.importResultLabels.updatedCustomers}: {item.updatedCustomers} · {copy.importResultLabels.updatedLeads}: {item.updatedLeads} · {copy.importResultLabels.createdLeadNotes}: {item.createdLeadNotes}
                    </p>
                  ) : null}
                  {item.errorMessage ? (
                    <p className="muted" style={{ marginBottom: 0 }}>
                      {copy.historyLabels.error}: {item.errorMessage}
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
