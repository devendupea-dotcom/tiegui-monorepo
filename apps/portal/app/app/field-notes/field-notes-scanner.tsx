"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale } from "next-intl";
import type {
  FieldNoteMaterial,
  FieldNoteMeasurement,
  ParsedFieldNotes,
} from "@/lib/field-notes";
import { createEmptyParsedFieldNotes } from "@/lib/field-notes";

type FieldNotesScannerProps = {
  orgId: string;
  orgName: string;
  internalUser: boolean;
};

type ParseResponse = {
  ok?: boolean;
  data?: ParsedFieldNotes;
  error?: string;
} | null;

type SaveResponse = {
  ok?: boolean;
  leadId?: string;
  redirectTo?: string;
  saveMode?: "lead" | "estimate";
  error?: string;
} | null;

function createEmptyMeasurement(): FieldNoteMeasurement {
  return {
    label: "",
    value: "",
    unit: "",
    notes: "",
  };
}

function createEmptyMaterial(): FieldNoteMaterial {
  return {
    name: "",
    quantity: "",
    unit: "",
    notes: "",
  };
}

function badgeClass(input: {
  step: number;
  activeStep: number;
  completed: boolean;
}): string {
  if (input.completed) return "badge status-success";
  if (input.step === input.activeStep) return "badge status-running";
  return "badge";
}

function renderMeasurement(
  row: FieldNoteMeasurement,
  emptyLabel: string,
): string {
  const base = [
    row.label,
    row.value && `${row.value}${row.unit ? ` ${row.unit}` : ""}`.trim(),
  ]
    .filter(Boolean)
    .join(": ");
  return row.notes ? `${base} (${row.notes})` : base || emptyLabel;
}

function renderMaterial(row: FieldNoteMaterial, emptyLabel: string): string {
  const quantity = [row.quantity, row.unit].filter(Boolean).join(" ");
  const base = [row.name, quantity].filter(Boolean).join(" - ");
  return row.notes ? `${base} (${row.notes})` : base || emptyLabel;
}

function getFieldNotesCopy(locale: string) {
  const isSpanish = locale.startsWith("es");
  if (isSpanish) {
    return {
      errors: {
        chooseFile: "Elige primero una imagen de las notas de campo.",
        analyze: "No se pudieron organizar las notas de campo.",
        saveBeforeScan: "Ejecuta el escaneo con IA antes de guardar.",
        saveReviewed: "No se pudieron guardar las notas revisadas.",
      },
      notices: {
        organized:
          "Notas de campo organizadas. Revisa cada campo antes de guardar.",
      },
      header: {
        title: "Escáner IA de notas de campo",
        subtitle: (orgName: string) =>
          `Convierte notas manuscritas del sitio en datos limpios de trabajo para ${orgName}. Nada se guarda hasta que el contratista lo revise y confirme.`,
        reviewFlow: "Flujo de revisión IA",
        noAutoSave: "Sin guardado automático",
        leadOrEstimate: "Lead o borrador de estimado",
      },
      steps: {
        upload: "Subir",
        aiParse: "Lectura IA",
        review: "Revisar",
        edit: "Editar",
        save: "Guardar",
      },
      upload: {
        title: "Paso 1: Subir notas manuscritas",
        label: "Foto de las notas de campo manuscritas",
        guidance:
          "Mejores resultados: foto iluminada, página completa visible, pocas sombras y medidas o materiales claros.",
        organizing: "Organizando...",
        analyze: "Analizar notas",
        clear: "Limpiar",
        extractTitle: "Lo que extrae la IA",
        badges: {
          customer: "Cliente",
          projectType: "Tipo de proyecto",
          siteAddress: "Dirección del sitio",
          measurements: "Medidas",
          materials: "Materiales",
          scope: "Alcance del trabajo",
          labor: "Notas de mano de obra",
          quote: "Monto cotizado",
          timeline: "Cronograma",
          followUp: "Seguimiento",
        },
        reviewRequired:
          "Se requiere revisión antes de guardar cualquier cosa. TieGui nunca crea automáticamente un lead o estimado desde un escaneo.",
      },
      processing: {
        title: "Paso 2: Procesamiento con IA",
        body: "Leyendo la letra, agrupando medidas y organizando el alcance del trabajo en campos limpios del CRM.",
        scanning: "Escaneando letra",
        structuring: "Estructurando medidas",
        preparing: "Preparando formulario de revisión",
        previewAlt: "Vista previa de las notas de campo",
      },
      review: {
        title: "Paso 3: Revisar datos organizados",
        subtitle:
          "Verifica los detalles extraídos del trabajo antes de editar o guardar nada.",
        rerun: "Volver a ejecutar IA",
        uploadedAlt: "Notas de campo subidas",
        cards: {
          customer: "Cliente",
          projectType: "Tipo de proyecto",
          siteAddress: "Dirección del sitio",
          quoteAmount: "Monto cotizado",
          timeline: "Cronograma",
          followUp: "Seguimiento",
        },
      },
      edit: {
        title: "Paso 4: Editar campos extraídos",
        subtitle:
          "Corrige cualquier cosa que el escaneo no capturó. Estos campos son la versión final que se guarda.",
        customerName: "Nombre del cliente",
        customerNamePlaceholder: "Maria Ramirez",
        projectType: "Tipo de proyecto",
        projectTypePlaceholder:
          "Limpieza de patio frontal y renovación de mulch",
        siteAddress: "Dirección del sitio",
        siteAddressPlaceholder: "123 Cedar Ave, Tacoma, WA",
        quoteAmount: "Monto cotizado",
        quoteAmountPlaceholder: "$4,850",
        timeline: "Cronograma",
        timelinePlaceholder:
          "Instalación de 2 días, el próximo viernes si se aprueba",
        followUp: "Seguimiento",
        followUpPlaceholder:
          "Llamar después de la aprobación de la HOA. Quiere otra opción de paver.",
        scopeOfWork: "Alcance del trabajo",
        scopeOfWorkPlaceholder:
          "Demoler el borde viejo, retirar escombros, reajustar el riego e instalar bark y edging de acero nuevos.",
        laborNotes: "Notas de mano de obra",
        laborNotesPlaceholder:
          "Se necesita cuadrilla de 3 personas, stump grinder y acceso al remolque por el callejón.",
      },
      measurements: {
        title: "Medidas",
        subtitle:
          "Mantén las dimensiones limpias para que la carpeta del trabajo arranque con datos útiles de campo.",
        add: "Agregar medida",
        label: "Etiqueta",
        labelPlaceholder: "Patio trasero",
        value: "Valor",
        valuePlaceholder: "860",
        unit: "Unidad",
        unitPlaceholder: "pies²",
        notes: "Notas",
        notesPlaceholder: "Incluye la franja lateral junto a la cerca",
        remove: "Quitar",
        empty: "Todavía no se capturaron medidas.",
      },
      materials: {
        title: "Materiales",
        subtitle:
          "Captura producto y cantidades antes de que se pierdan entre la visita al sitio y la cotización.",
        add: "Agregar material",
        material: "Material",
        materialPlaceholder: "Grava limpia 3/4",
        quantity: "Cantidad",
        quantityPlaceholder: "4",
        unit: "Unidad",
        unitPlaceholder: "yardas",
        notes: "Notas",
        notesPlaceholder: "Igualar el color existente",
        remove: "Quitar",
        empty: "Todavía no se capturaron materiales.",
      },
      save: {
        title: "Paso 5: Confirmar y guardar",
        subtitle:
          "TieGui necesita un número de teléfono para crear un lead real. Guarda como lead si solo quieres la carpeta del trabajo, o como borrador de estimado si también quieres preparar el texto del borrador de factura.",
        customerPhone: "Teléfono del cliente",
        customerPhonePlaceholder: "(206) 555-0100",
        customerEmail: "Email del cliente (opcional)",
        customerEmailPlaceholder: "cliente@ejemplo.com",
        savingLead: "Guardando lead...",
        saveLead: "Guardar como lead",
        savingEstimate: "Guardando borrador de estimado...",
        saveEstimate: "Guardar como borrador de estimado",
        successEstimate: "Borrador de estimado guardado",
        successLead: "Lead guardado",
        leadId: "ID del lead",
        openCrmFolder: "Abrir lead",
        scanAnother: "Escanear otra página",
      },
      general: {
        stepPrefix: "Paso",
        notCaptured: "No capturado",
        notCapturedYet: "Todavía no capturado",
      },
    };
  }

  return {
    errors: {
      chooseFile: "Choose a field-note image first.",
      analyze: "Could not organize the field notes.",
      saveBeforeScan: "Run the AI scan before saving.",
      saveReviewed: "Could not save the reviewed field notes.",
    },
    notices: {
      organized: "Field notes organized. Review every field before saving.",
    },
    header: {
      title: "AI Field Notes Scanner",
      subtitle: (orgName: string) =>
        `Turn handwritten site notes into clean job data for ${orgName}. Nothing is saved until the contractor reviews and confirms it.`,
      reviewFlow: "AI Review Flow",
      noAutoSave: "No auto-save",
      leadOrEstimate: "Lead or estimate draft",
    },
    steps: {
      upload: "Upload",
      aiParse: "AI Parse",
      review: "Review",
      edit: "Edit",
      save: "Save",
    },
    upload: {
      title: "Step 1: Upload handwritten notes",
      label: "Photo of handwritten field notes",
      guidance:
        "Best results: bright photo, full page visible, minimal shadows, and clear measurements or material notes.",
      organizing: "Organizing...",
      analyze: "Analyze Notes",
      clear: "Clear",
      extractTitle: "What the AI extracts",
      badges: {
        customer: "Customer",
        projectType: "Project type",
        siteAddress: "Site address",
        measurements: "Measurements",
        materials: "Materials",
        scope: "Scope of work",
        labor: "Labor notes",
        quote: "Quote amount",
        timeline: "Timeline",
        followUp: "Follow-up",
      },
      reviewRequired:
        "Review is required before anything is saved. TieGui will never auto-create a lead or estimate from a scan.",
    },
    processing: {
      title: "Step 2: AI processing",
      body: "Reading handwriting, grouping measurements, and organizing the job scope into clean CRM fields.",
      scanning: "Scanning handwriting",
      structuring: "Structuring measurements",
      preparing: "Preparing review form",
      previewAlt: "Field notes preview",
    },
    review: {
      title: "Step 3: Review organized data",
      subtitle:
        "Sanity-check the extracted job details before you edit or save anything.",
      rerun: "Re-run AI",
      uploadedAlt: "Uploaded field notes",
      cards: {
        customer: "Customer",
        projectType: "Project type",
        siteAddress: "Site address",
        quoteAmount: "Quote amount",
        timeline: "Timeline",
        followUp: "Follow-up",
      },
    },
    edit: {
      title: "Step 4: Edit extracted fields",
      subtitle:
        "Clean up anything the scan missed. These fields are the final version that gets saved.",
      customerName: "Customer name",
      customerNamePlaceholder: "Maria Ramirez",
      projectType: "Project type",
      projectTypePlaceholder: "Front yard cleanup and mulch refresh",
      siteAddress: "Site address",
      siteAddressPlaceholder: "123 Cedar Ave, Tacoma, WA",
      quoteAmount: "Quote amount",
      quoteAmountPlaceholder: "$4,850",
      timeline: "Timeline",
      timelinePlaceholder: "2-day install, next Friday if approved",
      followUp: "Follow-up",
      followUpPlaceholder:
        "Call after HOA approval. Wants alternate paver option.",
      scopeOfWork: "Scope of work",
      scopeOfWorkPlaceholder:
        "Demo old bed edge, haul debris, reset drip, install fresh bark and steel edging.",
      laborNotes: "Labor notes",
      laborNotesPlaceholder:
        "Need 3-person crew, stump grinder, and trailer access in alley.",
    },
    measurements: {
      title: "Measurements",
      subtitle:
        "Keep dimensions clean so the job folder starts with usable field data.",
      add: "Add Measurement",
      label: "Label",
      labelPlaceholder: "Back yard",
      value: "Value",
      valuePlaceholder: "860",
      unit: "Unit",
      unitPlaceholder: "sqft",
      notes: "Notes",
      notesPlaceholder: "Includes side strip near fence",
      remove: "Remove",
      empty: "No measurements were captured yet.",
    },
    materials: {
      title: "Materials",
      subtitle:
        "Capture product and quantity notes before they get lost between site visit and quote.",
      add: "Add Material",
      material: "Material",
      materialPlaceholder: "3/4 clean gravel",
      quantity: "Quantity",
      quantityPlaceholder: "4",
      unit: "Unit",
      unitPlaceholder: "yards",
      notes: "Notes",
      notesPlaceholder: "Match existing color",
      remove: "Remove",
      empty: "No materials were captured yet.",
    },
    save: {
      title: "Step 5: Confirm and save",
      subtitle:
        "TieGui needs a phone number to create a real lead record. Save as a lead if you only want the job folder, or save as an estimate draft if you also want the invoice-draft text prepared.",
      customerPhone: "Customer phone",
      customerPhonePlaceholder: "(206) 555-0100",
      customerEmail: "Customer email (optional)",
      customerEmailPlaceholder: "customer@example.com",
      savingLead: "Saving Lead...",
      saveLead: "Save as Lead",
      savingEstimate: "Saving Estimate Draft...",
      saveEstimate: "Save as Estimate Draft",
      successEstimate: "Estimate draft saved",
      successLead: "Lead saved",
      leadId: "Lead ID",
      openCrmFolder: "Open Lead",
      scanAnother: "Scan Another Page",
    },
    general: {
      stepPrefix: "Step",
      notCaptured: "Not captured",
      notCapturedYet: "Not captured yet",
    },
  };
}

export default function FieldNotesScanner({
  orgId,
  orgName,
  internalUser,
}: FieldNotesScannerProps) {
  const locale = useLocale();
  const copy = useMemo(() => getFieldNotesCopy(locale), [locale]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parseNotice, setParseNotice] = useState<string | null>(null);
  const [parsedData, setParsedData] = useState<ParsedFieldNotes | null>(null);

  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [savingMode, setSavingMode] = useState<"lead" | "estimate" | null>(
    null,
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedLeadId, setSavedLeadId] = useState<string | null>(null);
  const [savedRedirectTo, setSavedRedirectTo] = useState<string | null>(null);
  const [savedMode, setSavedMode] = useState<"lead" | "estimate" | null>(null);

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl(null);
      return;
    }

    const nextPreviewUrl = URL.createObjectURL(selectedFile);
    setPreviewUrl(nextPreviewUrl);

    return () => {
      URL.revokeObjectURL(nextPreviewUrl);
    };
  }, [selectedFile]);

  const activeStep = savedLeadId ? 5 : processing ? 2 : parsedData ? 4 : 1;

  function resetSaveState() {
    setSaveError(null);
    setSavedLeadId(null);
    setSavedRedirectTo(null);
    setSavedMode(null);
  }

  function resetParsedState() {
    setParsedData(null);
    setParseError(null);
    setParseNotice(null);
    resetSaveState();
  }

  function updateParsedField<K extends keyof ParsedFieldNotes>(
    field: K,
    value: ParsedFieldNotes[K],
  ) {
    setParsedData((current) => {
      const next = current ? { ...current } : createEmptyParsedFieldNotes();
      next[field] = value;
      return next;
    });
  }

  function updateMeasurement(
    index: number,
    field: keyof FieldNoteMeasurement,
    value: string,
  ) {
    setParsedData((current) => {
      const base = current ? { ...current } : createEmptyParsedFieldNotes();
      const nextMeasurements = [...base.measurements];
      const existing = nextMeasurements[index] || createEmptyMeasurement();
      nextMeasurements[index] = {
        ...existing,
        [field]: value,
      };
      base.measurements = nextMeasurements;
      return base;
    });
  }

  function updateMaterial(
    index: number,
    field: keyof FieldNoteMaterial,
    value: string,
  ) {
    setParsedData((current) => {
      const base = current ? { ...current } : createEmptyParsedFieldNotes();
      const nextMaterials = [...base.materials];
      const existing = nextMaterials[index] || createEmptyMaterial();
      nextMaterials[index] = {
        ...existing,
        [field]: value,
      };
      base.materials = nextMaterials;
      return base;
    });
  }

  function addMeasurementRow() {
    setParsedData((current) => {
      const base = current ? { ...current } : createEmptyParsedFieldNotes();
      base.measurements = [...base.measurements, createEmptyMeasurement()];
      return base;
    });
  }

  function addMaterialRow() {
    setParsedData((current) => {
      const base = current ? { ...current } : createEmptyParsedFieldNotes();
      base.materials = [...base.materials, createEmptyMaterial()];
      return base;
    });
  }

  function removeMeasurementRow(index: number) {
    setParsedData((current) => {
      if (!current) return current;
      return {
        ...current,
        measurements: current.measurements.filter(
          (_, rowIndex) => rowIndex !== index,
        ),
      };
    });
  }

  function removeMaterialRow(index: number) {
    setParsedData((current) => {
      if (!current) return current;
      return {
        ...current,
        materials: current.materials.filter(
          (_, rowIndex) => rowIndex !== index,
        ),
      };
    });
  }

  async function handleAnalyze() {
    if (!selectedFile) {
      setParseError(copy.errors.chooseFile);
      return;
    }

    setProcessing(true);
    setParseError(null);
    setParseNotice(null);
    resetSaveState();

    try {
      const formData = new FormData();
      formData.set("image", selectedFile);
      if (internalUser) {
        formData.set("orgId", orgId);
      }

      const response = await fetch("/api/ai/parse-field-notes", {
        method: "POST",
        body: formData,
      });

      const payload = (await response
        .json()
        .catch(() => null)) as ParseResponse;
      if (!response.ok || !payload?.ok || !payload.data) {
        throw new Error(payload?.error || copy.errors.analyze);
      }

      setParsedData(payload.data);
      setParseNotice(copy.notices.organized);
    } catch (error) {
      setParsedData(null);
      setParseError(
        error instanceof Error ? error.message : copy.errors.analyze,
      );
    } finally {
      setProcessing(false);
    }
  }

  async function handleSave(mode: "lead" | "estimate") {
    if (!parsedData) {
      setSaveError(copy.errors.saveBeforeScan);
      return;
    }

    setSavingMode(mode);
    setSaveError(null);

    try {
      const response = await fetch("/api/ai/field-notes/save", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...(internalUser ? { orgId } : {}),
          mode,
          phone,
          email,
          data: parsedData,
        }),
      });

      const payload = (await response.json().catch(() => null)) as SaveResponse;
      if (
        !response.ok ||
        !payload?.ok ||
        !payload.leadId ||
        !payload.redirectTo
      ) {
        throw new Error(payload?.error || copy.errors.saveReviewed);
      }

      setSavedLeadId(payload.leadId);
      setSavedRedirectTo(payload.redirectTo);
      setSavedMode(payload.saveMode || mode);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : copy.errors.saveReviewed,
      );
    } finally {
      setSavingMode(null);
    }
  }

  return (
    <div className="field-notes-shell">
      <section className="card">
        <div className="invoice-header-row">
          <div className="stack-cell">
            <h2>{copy.header.title}</h2>
            <p className="muted">{copy.header.subtitle(orgName)}</p>
          </div>
          <div className="quick-meta">
            <span className="badge status-running">
              {copy.header.reviewFlow}
            </span>
            <span className="badge">{copy.header.noAutoSave}</span>
            <span className="badge">{copy.header.leadOrEstimate}</span>
          </div>
        </div>

        <div className="field-notes-stepper" style={{ marginTop: 14 }}>
          {[1, 2, 3, 4, 5].map((step) => {
            const completed =
              step === 1
                ? Boolean(selectedFile)
                : step === 2
                  ? Boolean(parsedData) || Boolean(savedLeadId)
                  : step === 3
                    ? Boolean(parsedData) || Boolean(savedLeadId)
                    : step === 4
                      ? Boolean(parsedData) || Boolean(savedLeadId)
                      : Boolean(savedLeadId);

            const label =
              step === 1
                ? copy.steps.upload
                : step === 2
                  ? copy.steps.aiParse
                  : step === 3
                    ? copy.steps.review
                    : step === 4
                      ? copy.steps.edit
                      : copy.steps.save;

            return (
              <span
                key={step}
                className={badgeClass({ step, activeStep, completed })}
              >
                {copy.general.stepPrefix} {step}: {label}
              </span>
            );
          })}
        </div>

        {parseNotice ? (
          <p className="form-status" style={{ marginTop: 12 }}>
            {parseNotice}
          </p>
        ) : null}
        {parseError ? (
          <p className="form-status" style={{ marginTop: 12 }}>
            {parseError}
          </p>
        ) : null}
        {saveError ? (
          <p className="form-status" style={{ marginTop: 12 }}>
            {saveError}
          </p>
        ) : null}
      </section>

      <section className="card">
        <div className="field-notes-layout">
          <div className="stack-cell">
            <h3>{copy.upload.title}</h3>
            <div className="field-notes-dropzone">
              <label className="stack-cell">
                <span>{copy.upload.label}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  disabled={processing || Boolean(savingMode)}
                  onChange={(event) => {
                    const nextFile = event.currentTarget.files?.[0] || null;
                    setSelectedFile(nextFile);
                    resetParsedState();
                  }}
                />
              </label>

              <p className="muted">{copy.upload.guidance}</p>

              <div className="portal-empty-actions">
                <button
                  className="btn primary"
                  type="button"
                  disabled={!selectedFile || processing || Boolean(savingMode)}
                  onClick={() => {
                    void handleAnalyze();
                  }}
                >
                  {processing ? copy.upload.organizing : copy.upload.analyze}
                </button>

                {selectedFile ? (
                  <button
                    className="btn secondary"
                    type="button"
                    disabled={processing || Boolean(savingMode)}
                    onClick={() => {
                      setSelectedFile(null);
                      resetParsedState();
                    }}
                  >
                    {copy.upload.clear}
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="stack-cell">
            <h3>{copy.upload.extractTitle}</h3>
            <div className="field-notes-facts">
              <span className="badge">{copy.upload.badges.customer}</span>
              <span className="badge">{copy.upload.badges.projectType}</span>
              <span className="badge">{copy.upload.badges.siteAddress}</span>
              <span className="badge">{copy.upload.badges.measurements}</span>
              <span className="badge">{copy.upload.badges.materials}</span>
              <span className="badge">{copy.upload.badges.scope}</span>
              <span className="badge">{copy.upload.badges.labor}</span>
              <span className="badge">{copy.upload.badges.quote}</span>
              <span className="badge">{copy.upload.badges.timeline}</span>
              <span className="badge">{copy.upload.badges.followUp}</span>
            </div>
            <p className="muted">{copy.upload.reviewRequired}</p>
          </div>
        </div>
      </section>

      {processing ? (
        <section className="card">
          <div className="field-notes-layout">
            <div className="stack-cell">
              <h3>{copy.processing.title}</h3>
              <p className="muted">{copy.processing.body}</p>
              <div className="quick-meta">
                <span className="badge status-running">
                  {copy.processing.scanning}
                </span>
                <span className="badge status-running">
                  {copy.processing.structuring}
                </span>
                <span className="badge status-running">
                  {copy.processing.preparing}
                </span>
              </div>
            </div>
            {previewUrl ? (
              <div className="field-notes-preview-card">
                <Image
                  className="field-notes-preview-image"
                  src={previewUrl}
                  alt={copy.processing.previewAlt}
                  width={1200}
                  height={1600}
                  unoptimized
                  loader={({ src }) => src}
                />
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {parsedData ? (
        <>
          <section className="card">
            <div className="invoice-header-row">
              <div className="stack-cell">
                <h3>{copy.review.title}</h3>
                <p className="muted">{copy.review.subtitle}</p>
              </div>
              <div className="field-notes-inline-actions">
                <button
                  className="btn secondary"
                  type="button"
                  disabled={Boolean(savingMode)}
                  onClick={() => {
                    void handleAnalyze();
                  }}
                >
                  {copy.review.rerun}
                </button>
              </div>
            </div>

            <div className="field-notes-layout" style={{ marginTop: 14 }}>
              {previewUrl ? (
                <div className="field-notes-preview-card">
                  <Image
                    className="field-notes-preview-image"
                    src={previewUrl}
                    alt={copy.review.uploadedAlt}
                    width={1200}
                    height={1600}
                    unoptimized
                    loader={({ src }) => src}
                  />
                </div>
              ) : null}

              <div className="field-notes-summary-grid">
                <div className="card field-notes-nested-card">
                  <h4>{copy.review.cards.customer}</h4>
                  <p>
                    {parsedData.customer_name || copy.general.notCapturedYet}
                  </p>
                </div>
                <div className="card field-notes-nested-card">
                  <h4>{copy.review.cards.projectType}</h4>
                  <p>
                    {parsedData.project_type || copy.general.notCapturedYet}
                  </p>
                </div>
                <div className="card field-notes-nested-card">
                  <h4>{copy.review.cards.siteAddress}</h4>
                  <p>
                    {parsedData.site_address || copy.general.notCapturedYet}
                  </p>
                </div>
                <div className="card field-notes-nested-card">
                  <h4>{copy.review.cards.quoteAmount}</h4>
                  <p>
                    {parsedData.quote_amount || copy.general.notCapturedYet}
                  </p>
                </div>
                <div className="card field-notes-nested-card">
                  <h4>{copy.review.cards.timeline}</h4>
                  <p>{parsedData.timeline || copy.general.notCapturedYet}</p>
                </div>
                <div className="card field-notes-nested-card">
                  <h4>{copy.review.cards.followUp}</h4>
                  <p>{parsedData.follow_up || copy.general.notCapturedYet}</p>
                </div>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="stack-cell">
              <h3>{copy.edit.title}</h3>
              <p className="muted">{copy.edit.subtitle}</p>
            </div>

            <form
              className="auth-form"
              style={{ marginTop: 14 }}
              onSubmit={(event) => event.preventDefault()}
            >
              <div className="grid two-col">
                <label>
                  {copy.edit.customerName}
                  <input
                    value={parsedData.customer_name}
                    onChange={(event) =>
                      updateParsedField(
                        "customer_name",
                        event.currentTarget.value,
                      )
                    }
                    placeholder={copy.edit.customerNamePlaceholder}
                  />
                </label>

                <label>
                  {copy.edit.projectType}
                  <input
                    value={parsedData.project_type}
                    onChange={(event) =>
                      updateParsedField(
                        "project_type",
                        event.currentTarget.value,
                      )
                    }
                    placeholder={copy.edit.projectTypePlaceholder}
                  />
                </label>
              </div>

              <div className="grid two-col">
                <label>
                  {copy.edit.siteAddress}
                  <input
                    value={parsedData.site_address}
                    onChange={(event) =>
                      updateParsedField(
                        "site_address",
                        event.currentTarget.value,
                      )
                    }
                    placeholder={copy.edit.siteAddressPlaceholder}
                  />
                </label>

                <label>
                  {copy.edit.quoteAmount}
                  <input
                    value={parsedData.quote_amount}
                    onChange={(event) =>
                      updateParsedField(
                        "quote_amount",
                        event.currentTarget.value,
                      )
                    }
                    placeholder={copy.edit.quoteAmountPlaceholder}
                  />
                </label>
              </div>

              <div className="grid two-col">
                <label>
                  {copy.edit.timeline}
                  <input
                    value={parsedData.timeline}
                    onChange={(event) =>
                      updateParsedField("timeline", event.currentTarget.value)
                    }
                    placeholder={copy.edit.timelinePlaceholder}
                  />
                </label>

                <label>
                  {copy.edit.followUp}
                  <textarea
                    value={parsedData.follow_up}
                    onChange={(event) =>
                      updateParsedField("follow_up", event.currentTarget.value)
                    }
                    rows={3}
                    placeholder={copy.edit.followUpPlaceholder}
                  />
                </label>
              </div>

              <label>
                {copy.edit.scopeOfWork}
                <textarea
                  value={parsedData.scope_of_work}
                  onChange={(event) =>
                    updateParsedField(
                      "scope_of_work",
                      event.currentTarget.value,
                    )
                  }
                  rows={5}
                  placeholder={copy.edit.scopeOfWorkPlaceholder}
                />
              </label>

              <label>
                {copy.edit.laborNotes}
                <textarea
                  value={parsedData.labor_notes}
                  onChange={(event) =>
                    updateParsedField("labor_notes", event.currentTarget.value)
                  }
                  rows={4}
                  placeholder={copy.edit.laborNotesPlaceholder}
                />
              </label>
            </form>
          </section>

          <section className="card">
            <div className="invoice-header-row">
              <div className="stack-cell">
                <h3>{copy.measurements.title}</h3>
                <p className="muted">{copy.measurements.subtitle}</p>
              </div>
              <button
                className="btn secondary"
                type="button"
                onClick={addMeasurementRow}
              >
                {copy.measurements.add}
              </button>
            </div>

            {parsedData.measurements.length > 0 ? (
              <div className="field-notes-line-list">
                {parsedData.measurements.map((row, index) => (
                  <div
                    key={`measurement-${index}`}
                    className="field-notes-line-item"
                  >
                    <div className="grid two-col">
                      <label>
                        {copy.measurements.label}
                        <input
                          value={row.label}
                          onChange={(event) =>
                            updateMeasurement(
                              index,
                              "label",
                              event.currentTarget.value,
                            )
                          }
                          placeholder={copy.measurements.labelPlaceholder}
                        />
                      </label>
                      <label>
                        {copy.measurements.value}
                        <input
                          value={row.value}
                          onChange={(event) =>
                            updateMeasurement(
                              index,
                              "value",
                              event.currentTarget.value,
                            )
                          }
                          placeholder={copy.measurements.valuePlaceholder}
                        />
                      </label>
                    </div>

                    <div className="grid two-col">
                      <label>
                        {copy.measurements.unit}
                        <input
                          value={row.unit}
                          onChange={(event) =>
                            updateMeasurement(
                              index,
                              "unit",
                              event.currentTarget.value,
                            )
                          }
                          placeholder={copy.measurements.unitPlaceholder}
                        />
                      </label>
                      <label>
                        {copy.measurements.notes}
                        <input
                          value={row.notes}
                          onChange={(event) =>
                            updateMeasurement(
                              index,
                              "notes",
                              event.currentTarget.value,
                            )
                          }
                          placeholder={copy.measurements.notesPlaceholder}
                        />
                      </label>
                    </div>

                    <div className="field-notes-line-footer">
                      <span className="muted">
                        {renderMeasurement(row, copy.general.notCaptured)}
                      </span>
                      <button
                        className="btn secondary"
                        type="button"
                        onClick={() => removeMeasurementRow(index)}
                      >
                        {copy.measurements.remove}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="field-notes-empty">
                <p>{copy.measurements.empty}</p>
              </div>
            )}
          </section>

          <section className="card">
            <div className="invoice-header-row">
              <div className="stack-cell">
                <h3>{copy.materials.title}</h3>
                <p className="muted">{copy.materials.subtitle}</p>
              </div>
              <button
                className="btn secondary"
                type="button"
                onClick={addMaterialRow}
              >
                {copy.materials.add}
              </button>
            </div>

            {parsedData.materials.length > 0 ? (
              <div className="field-notes-line-list">
                {parsedData.materials.map((row, index) => (
                  <div
                    key={`material-${index}`}
                    className="field-notes-line-item"
                  >
                    <div className="grid two-col">
                      <label>
                        {copy.materials.material}
                        <input
                          value={row.name}
                          onChange={(event) =>
                            updateMaterial(
                              index,
                              "name",
                              event.currentTarget.value,
                            )
                          }
                          placeholder={copy.materials.materialPlaceholder}
                        />
                      </label>
                      <label>
                        {copy.materials.quantity}
                        <input
                          value={row.quantity}
                          onChange={(event) =>
                            updateMaterial(
                              index,
                              "quantity",
                              event.currentTarget.value,
                            )
                          }
                          placeholder={copy.materials.quantityPlaceholder}
                        />
                      </label>
                    </div>

                    <div className="grid two-col">
                      <label>
                        {copy.materials.unit}
                        <input
                          value={row.unit}
                          onChange={(event) =>
                            updateMaterial(
                              index,
                              "unit",
                              event.currentTarget.value,
                            )
                          }
                          placeholder={copy.materials.unitPlaceholder}
                        />
                      </label>
                      <label>
                        {copy.materials.notes}
                        <input
                          value={row.notes}
                          onChange={(event) =>
                            updateMaterial(
                              index,
                              "notes",
                              event.currentTarget.value,
                            )
                          }
                          placeholder={copy.materials.notesPlaceholder}
                        />
                      </label>
                    </div>

                    <div className="field-notes-line-footer">
                      <span className="muted">
                        {renderMaterial(row, copy.general.notCaptured)}
                      </span>
                      <button
                        className="btn secondary"
                        type="button"
                        onClick={() => removeMaterialRow(index)}
                      >
                        {copy.materials.remove}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="field-notes-empty">
                <p>{copy.materials.empty}</p>
              </div>
            )}
          </section>

          <section className="card">
            <div className="stack-cell">
              <h3>{copy.save.title}</h3>
              <p className="muted">{copy.save.subtitle}</p>
            </div>

            <form
              className="auth-form"
              style={{ marginTop: 14 }}
              onSubmit={(event) => event.preventDefault()}
            >
              <div className="grid two-col">
                <label>
                  {copy.save.customerPhone}
                  <input
                    value={phone}
                    onChange={(event) => {
                      setPhone(event.currentTarget.value);
                      resetSaveState();
                    }}
                    placeholder={copy.save.customerPhonePlaceholder}
                    required
                  />
                </label>

                <label>
                  {copy.save.customerEmail}
                  <input
                    value={email}
                    onChange={(event) => {
                      setEmail(event.currentTarget.value);
                      resetSaveState();
                    }}
                    placeholder={copy.save.customerEmailPlaceholder}
                  />
                </label>
              </div>

              <div className="portal-empty-actions">
                <button
                  className="btn primary"
                  type="button"
                  disabled={processing || Boolean(savingMode)}
                  onClick={() => {
                    void handleSave("lead");
                  }}
                >
                  {savingMode === "lead"
                    ? copy.save.savingLead
                    : copy.save.saveLead}
                </button>

                <button
                  className="btn secondary"
                  type="button"
                  disabled={processing || Boolean(savingMode)}
                  onClick={() => {
                    void handleSave("estimate");
                  }}
                >
                  {savingMode === "estimate"
                    ? copy.save.savingEstimate
                    : copy.save.saveEstimate}
                </button>
              </div>
            </form>

            {savedLeadId && savedRedirectTo ? (
              <div className="field-notes-success-card">
                <div className="quick-meta">
                  <span className="badge status-success">
                    {savedMode === "estimate"
                      ? copy.save.successEstimate
                      : copy.save.successLead}
                  </span>
                  <span className="badge">
                    {copy.save.leadId}: {savedLeadId}
                  </span>
                </div>
                <div className="portal-empty-actions" style={{ marginTop: 12 }}>
                  <Link className="btn primary" href={savedRedirectTo}>
                    {copy.save.openCrmFolder}
                  </Link>
                  <button
                    className="btn secondary"
                    type="button"
                    onClick={() => {
                      setSelectedFile(null);
                      setPhone("");
                      setEmail("");
                      setParsedData(null);
                      setParseNotice(null);
                      setParseError(null);
                      resetSaveState();
                    }}
                  >
                    {copy.save.scanAnother}
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
