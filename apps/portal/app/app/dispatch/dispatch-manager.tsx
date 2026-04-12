"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useLocale } from "next-intl";
import { formatEstimateCurrency } from "@/lib/estimates";
import {
  compareDispatchJobs,
  dispatchStatusValues,
  formatDispatchPriorityLabel,
  getDispatchTodayDateKey,
  normalizeDispatchDateKey,
  type DispatchCrewManagementItem,
  type DispatchDaySnapshot,
  type DispatchJobDetail,
  type DispatchNotificationSettings,
  type DispatchJobSummary,
  type DispatchStatusValue,
} from "@/lib/dispatch";
import DispatchJobForm, { createDispatchJobFormState, type DispatchJobFormState } from "./dispatch-job-form";

type DispatchManagerProps = {
  orgId: string;
  orgName: string;
  internalUser: boolean;
  canManage: boolean;
  initialDate: string;
  initialJobId: string | null;
};

type SnapshotResponse =
  | {
      ok?: boolean;
      snapshot?: DispatchDaySnapshot;
      error?: string;
    }
  | null;

type DispatchJobResponse =
  | {
      ok?: boolean;
      job?: DispatchJobDetail;
      error?: string;
    }
  | null;

type DispatchCreateResponse =
  | {
      ok?: boolean;
      job?: DispatchJobSummary;
      error?: string;
    }
  | null;

type DispatchCrewResponse =
  | {
      ok?: boolean;
      crews?: DispatchCrewManagementItem[];
      error?: string;
    }
  | null;

type DispatchSettingsResponse =
  | {
      ok?: boolean;
      settings?: DispatchNotificationSettings;
      error?: string;
    }
  | null;

type DispatchTrackingLinkResponse =
  | {
      ok?: boolean;
      tracking?: {
        url: string;
      };
      error?: string;
    }
  | null;

type DispatchColumn = {
  crewId: string | null;
  name: string;
  active: boolean;
  jobs: DispatchJobSummary[];
};

type DispatchManagerCopy = {
  unassigned: string;
  readOnly: string;
  errors: {
    loadDispatch: string;
    loadDispatchJob: string;
    loadCrews: string;
    loadSettings: string;
    createJob: string;
    saveJob: string;
    saveCrew: string;
    saveSettings: string;
    updateStatus: string;
    generateLink: string;
    copyLink: string;
    reorderBoard: string;
  };
  notices: {
    jobCreated: string;
    jobUpdated: string;
    crewUpdated: string;
    settingsUpdated: string;
    statusUpdated: string;
    trackingLinkCopied: string;
    trackingLinkCreated: string;
  };
  title: string;
  subtitle: (orgName: string) => string;
  selectedDate: string;
  today: string;
  board: string;
  list: string;
  crews: string;
  smsUpdates: string;
  newJob: string;
  newJobBody: (date: string) => string;
  totalJobs: string;
  completed: string;
  overdue: string;
  loadingDispatch: (date: string) => string;
  jobCount: (count: number) => string;
  inactive: string;
  inactiveCrew: string;
  noJobsYet: string;
  dropJobHere: string;
  reactivateCrew: string;
  newJobsLandHere: string;
  customer: string;
  service: string;
  address: string;
  scheduledTime: string;
  assignedCrew: string;
  status: string;
  priority: string;
  clearDayTitle: string;
  clearDayBody: string;
  close: string;
  save: string;
  cancel: string;
  saving: string;
  crewManagement: string;
  crewManagementBody: string;
  loadingCrews: string;
  crewName: string;
  active: string;
  openAssignedJobs: (count: number) => string;
  noOpenAssignedJobs: string;
  customerSmsUpdates: string;
  customerSmsUpdatesBody: string;
  loadingSmsSettings: string;
  sendCustomerDispatchSms: string;
  usesTwilio: string;
  twilioNotReady: string;
  dispatchStatuses: Record<DispatchStatusValue, string>;
  priorities: Record<"low" | "medium" | "high" | "urgent", string>;
  closeDispatchJobDetails: string;
  jobDetails: string;
  dispatchJob: string;
  loadingJobDetails: string;
  phone: string;
  crew: string;
  linkedCustomer: string;
  linkedLead: string;
  linkedEstimate: string;
  linkedEstimateBody: string;
  openEstimate: string;
  noLinkedEstimate: string;
  recentCommunication: string;
  recentCommunicationBody: string;
  noRecentCommunication: string;
  customerTracking: string;
  customerTrackingBody: string;
  copyLink: string;
  createLink: string;
  generating: string;
  customerTrackingLink: string;
  openTrackingPage: string;
  openJobWorkspace: string;
  createFreshLink: string;
  createShareableLink: string;
  editJob: string;
  editJobBody: string;
  saveChanges: string;
  notes: string;
  startsAt: (time: string) => string;
  byTime: (time: string) => string;
  anyTime: string;
};

function getDispatchManagerCopy(locale: string): DispatchManagerCopy {
  if (locale.startsWith("es")) {
    return {
      unassigned: "Sin asignar",
      readOnly: "Solo lectura",
      errors: {
        loadDispatch: "No se pudo cargar el despacho.",
        loadDispatchJob: "No se pudo cargar el trabajo de despacho.",
        loadCrews: "No se pudieron cargar las cuadrillas.",
        loadSettings: "No se pudo cargar la configuracion de despacho.",
        createJob: "No se pudo crear el trabajo de despacho.",
        saveJob: "No se pudo guardar el trabajo de despacho.",
        saveCrew: "No se pudo guardar la cuadrilla.",
        saveSettings: "No se pudo guardar la configuracion de despacho.",
        updateStatus: "No se pudo actualizar el estado del despacho.",
        generateLink: "No se pudo generar el enlace de seguimiento.",
        copyLink: "No se pudo copiar el enlace de seguimiento.",
        reorderBoard: "No se pudo reordenar el tablero de despacho.",
      },
      notices: {
        jobCreated: "Trabajo de despacho creado.",
        jobUpdated: "Trabajo de despacho actualizado.",
        crewUpdated: "Configuracion de cuadrillas actualizada.",
        settingsUpdated: "Configuracion SMS de despacho actualizada.",
        statusUpdated: "Estado de despacho actualizado.",
        trackingLinkCopied: "Enlace de seguimiento copiado.",
        trackingLinkCreated: "Enlace de seguimiento creado.",
      },
      title: "Despacho",
      subtitle: (orgName) => `Centro diario de campo para ${orgName}.`,
      selectedDate: "Fecha seleccionada",
      today: "Hoy",
      board: "Tablero",
      list: "Lista",
      crews: "Cuadrillas",
      smsUpdates: "Actualizaciones SMS",
      newJob: "Nuevo trabajo",
      newJobBody: (date) => `Crea un trabajo listo para despacho para ${date}.`,
      totalJobs: "Trabajos totales",
      completed: "Completados",
      overdue: "Vencidos",
      loadingDispatch: (date) => `Cargando despacho para ${date}.`,
      jobCount: (count) => `${count} ${count === 1 ? "trabajo" : "trabajos"}`,
      inactive: "Inactiva",
      inactiveCrew: "Cuadrilla inactiva",
      noJobsYet: "Aun no hay trabajos",
      dropJobHere: "Suelta un trabajo aqui para asignarlo a esta cuadrilla.",
      reactivateCrew: "Reactiva esta cuadrilla antes de asignar trabajo nuevo.",
      newJobsLandHere: "Los trabajos nuevos llegan aqui hasta que se asignan.",
      customer: "Cliente",
      service: "Servicio",
      address: "Direccion",
      scheduledTime: "Hora programada",
      assignedCrew: "Cuadrilla asignada",
      status: "Estado",
      priority: "Prioridad",
      clearDayTitle: "Este dia sigue libre.",
      clearDayBody: "Agrega trabajos cuando entren, deja visible lo no asignado y luego arrastra cada parada a la cuadrilla correcta.",
      close: "Cerrar",
      save: "Guardar",
      cancel: "Cancelar",
      saving: "Guardando...",
      crewManagement: "Gestion de cuadrillas",
      crewManagementBody: "Manten el tablero diario alineado con como opera realmente tu equipo.",
      loadingCrews: "Cargando cuadrillas...",
      crewName: "Nombre de la cuadrilla",
      active: "Activa",
      openAssignedJobs: (count) => `${count} ${count === 1 ? "trabajo abierto asignado" : "trabajos abiertos asignados"}`,
      noOpenAssignedJobs: "No hay trabajos abiertos asignados actualmente",
      customerSmsUpdates: "Actualizaciones SMS al cliente",
      customerSmsUpdatesBody: "Manten informado al cliente en momentos clave del despacho sin convertir esto en una campana.",
      loadingSmsSettings: "Cargando configuracion SMS...",
      sendCustomerDispatchSms: "Enviar actualizaciones SMS de despacho al cliente",
      usesTwilio: "Usa tu remitente actual de Twilio y respeta las horas de silencio.",
      twilioNotReady: "Twilio aun no esta listo, asi que las actualizaciones seguiran apagadas hasta que mensajeria este conectada.",
      dispatchStatuses: {
        scheduled: "Programado",
        on_the_way: "En camino",
        on_site: "En sitio",
        completed: "Completado",
        rescheduled: "Reprogramado",
        canceled: "Cancelado",
      },
      priorities: {
        low: "Baja",
        medium: "Media",
        high: "Alta",
        urgent: "Urgente",
      },
      closeDispatchJobDetails: "Cerrar detalles del trabajo de despacho",
      jobDetails: "Detalles del trabajo",
      dispatchJob: "Trabajo de despacho",
      loadingJobDetails: "Cargando detalles del trabajo.",
      phone: "Telefono",
      crew: "Cuadrilla",
      linkedCustomer: "Cliente vinculado",
      linkedLead: "Lead vinculado",
      linkedEstimate: "Estimado vinculado",
      linkedEstimateBody: "Visible cuando este trabajo ya esta conectado a estimados.",
      openEstimate: "Abrir estimado",
      noLinkedEstimate: "Aun no hay estimado vinculado.",
      recentCommunication: "Comunicacion reciente",
      recentCommunicationBody: "Ultimos mensajes o llamadas conectados con este cliente.",
      noRecentCommunication: "Aun no hay comunicacion reciente vinculada.",
      customerTracking: "Seguimiento del cliente",
      customerTrackingBody: "Genera un enlace publico simple para que el cliente vea el estado y la linea de tiempo en vivo.",
      copyLink: "Copiar enlace",
      createLink: "Crear enlace",
      generating: "Generando...",
      customerTrackingLink: "Enlace de seguimiento del cliente",
      openTrackingPage: "Abrir pagina de seguimiento",
      openJobWorkspace: "Abrir trabajo",
      createFreshLink: "Crear enlace nuevo",
      createShareableLink: "Crea un enlace compartible cuando estes listo para enviarle al cliente actualizaciones en vivo.",
      editJob: "Editar trabajo",
      editJobBody: "Guarda cambios directamente desde el panel de despacho.",
      saveChanges: "Guardar cambios",
      notes: "Notas",
      startsAt: (time) => `Empieza ${time}`,
      byTime: (time) => `Antes de ${time}`,
      anyTime: "Cualquier hora",
    };
  }

  return {
    unassigned: "Unassigned",
    readOnly: "Read only",
    errors: {
      loadDispatch: "Failed to load dispatch.",
      loadDispatchJob: "Failed to load dispatch job.",
      loadCrews: "Failed to load crews.",
      loadSettings: "Failed to load dispatch settings.",
      createJob: "Failed to create dispatch job.",
      saveJob: "Failed to save dispatch job.",
      saveCrew: "Failed to save crew.",
      saveSettings: "Failed to save dispatch settings.",
      updateStatus: "Failed to update dispatch status.",
      generateLink: "Failed to generate tracking link.",
      copyLink: "Failed to copy tracking link.",
      reorderBoard: "Failed to reorder dispatch board.",
    },
    notices: {
      jobCreated: "Dispatch job created.",
      jobUpdated: "Dispatch job updated.",
      crewUpdated: "Crew settings updated.",
      settingsUpdated: "Dispatch SMS settings updated.",
      statusUpdated: "Dispatch status updated.",
      trackingLinkCopied: "Tracking link copied.",
      trackingLinkCreated: "Tracking link created.",
    },
    title: "Dispatch",
    subtitle: (orgName) => `Daily field command center for ${orgName}.`,
    selectedDate: "Selected date",
    today: "Today",
    board: "Board",
    list: "List",
    crews: "Crews",
    smsUpdates: "SMS Updates",
    newJob: "New Job",
    newJobBody: (date) => `Create a dispatch-ready job for ${date}.`,
    totalJobs: "Total jobs",
    completed: "Completed",
    overdue: "Overdue",
    loadingDispatch: (date) => `Loading dispatch for ${date}.`,
    jobCount: (count) => `${count} ${count === 1 ? "job" : "jobs"}`,
    inactive: "Inactive",
    inactiveCrew: "Inactive crew",
    noJobsYet: "No jobs yet",
    dropJobHere: "Drop a job here to assign this crew.",
    reactivateCrew: "Reactivate this crew before assigning new work.",
    newJobsLandHere: "New jobs land here until assigned.",
    customer: "Customer",
    service: "Service",
    address: "Address",
    scheduledTime: "Scheduled Time",
    assignedCrew: "Assigned Crew",
    status: "Status",
    priority: "Priority",
    clearDayTitle: "This day is still clear.",
    clearDayBody: "Add jobs as they come in, keep unassigned work visible, then drag each stop onto the right crew.",
    close: "Close",
    save: "Save",
    cancel: "Cancel",
    saving: "Saving...",
    crewManagement: "Crew Management",
    crewManagementBody: "Keep the daily board aligned with how your team actually runs.",
    loadingCrews: "Loading crews...",
    crewName: "Crew name",
    active: "Active",
    openAssignedJobs: (count) => `${count} open ${count === 1 ? "job" : "jobs"} currently assigned`,
    noOpenAssignedJobs: "No open jobs currently assigned",
    customerSmsUpdates: "Customer SMS Updates",
    customerSmsUpdatesBody: "Keep customers informed at key dispatch moments without turning this into a campaign tool.",
    loadingSmsSettings: "Loading SMS settings...",
    sendCustomerDispatchSms: "Send customer dispatch SMS updates",
    usesTwilio: "Uses your current Twilio sender and respects quiet hours.",
    twilioNotReady: "Twilio is not fully ready yet, so updates will stay off until messaging is connected.",
    dispatchStatuses: {
      scheduled: "Scheduled",
      on_the_way: "On the way",
      on_site: "On site",
      completed: "Completed",
      rescheduled: "Rescheduled",
      canceled: "Canceled",
    },
    priorities: {
      low: "Low",
      medium: "Medium",
      high: "High",
      urgent: "Urgent",
    },
    closeDispatchJobDetails: "Close dispatch job details",
    jobDetails: "Job details",
    dispatchJob: "Dispatch job",
    loadingJobDetails: "Loading job details.",
    phone: "Phone",
    crew: "Crew",
    linkedCustomer: "Linked customer",
    linkedLead: "Linked lead",
    linkedEstimate: "Linked estimate",
    linkedEstimateBody: "Visible when this job already connects to estimating.",
    openEstimate: "Open Estimate",
    noLinkedEstimate: "No linked estimate yet.",
    recentCommunication: "Recent communication",
    recentCommunicationBody: "Last known messages or calls connected to this customer.",
    noRecentCommunication: "No recent communication linked yet.",
    customerTracking: "Customer tracking",
    customerTrackingBody: "Generate a simple public link so the customer can see live status and timeline updates.",
    copyLink: "Copy Link",
    createLink: "Create Link",
    generating: "Generating...",
    customerTrackingLink: "Customer tracking link",
    openTrackingPage: "Open Tracking Page",
    openJobWorkspace: "Open Operational Job",
    createFreshLink: "Create Fresh Link",
    createShareableLink: "Create a shareable link when you are ready to send the customer live job updates.",
    editJob: "Edit job",
    editJobBody: "Save updates directly from the dispatch drawer.",
    saveChanges: "Save Changes",
    notes: "Notes",
    startsAt: (time) => `Starts ${time}`,
    byTime: (time) => `By ${time}`,
    anyTime: "Any time",
  };
}

function withOrgQuery(path: string, orgId: string, internalUser: boolean): string {
  if (!internalUser) return path;
  const joiner = path.includes("?") ? "&" : "?";
  return `${path}${joiner}orgId=${encodeURIComponent(orgId)}`;
}

function createQuery(params: Record<string, string>, orgId: string, internalUser: boolean): string {
  const query = new URLSearchParams(params);
  if (internalUser) {
    query.set("orgId", orgId);
  }
  return query.toString();
}

function getTodayDateKey(): string {
  return getDispatchTodayDateKey();
}

function toFormState(job: DispatchJobSummary | DispatchJobDetail): DispatchJobFormState {
  return {
    customerId: job.customerId || "",
    customerLabel: job.customerLabel || "",
    leadId: job.leadId || "",
    leadLabel: job.leadLabel || "",
    customerName: job.customerName,
    phone: job.phone || "",
    serviceType: job.serviceType,
    address: job.address,
    scheduledDate: job.scheduledDate,
    scheduledStartTime: job.scheduledStartTime || "",
    scheduledEndTime: job.scheduledEndTime || "",
    assignedCrewId: job.assignedCrewId || "",
    notes: job.notes || "",
    priority: job.priority || "",
    status: job.status,
  };
}

function toPayload(form: DispatchJobFormState) {
  return {
    customerId: form.customerId || null,
    leadId: form.leadId || null,
    customerName: form.customerName,
    phone: form.phone,
    serviceType: form.serviceType,
    address: form.address,
    scheduledDate: form.scheduledDate,
    scheduledStartTime: form.scheduledStartTime || null,
    scheduledEndTime: form.scheduledEndTime || null,
    assignedCrewId: form.assignedCrewId || null,
    notes: form.notes || null,
    priority: form.priority || null,
    status: form.status,
  };
}

function buildColumns(snapshot: DispatchDaySnapshot | null, unassignedLabel: string): DispatchColumn[] {
  if (!snapshot) {
    return [
      {
        crewId: null,
        name: unassignedLabel,
        active: true,
        jobs: [],
      },
    ];
  }

  const columns: DispatchColumn[] = [
    {
      crewId: null,
      name: unassignedLabel,
      active: true,
      jobs: [],
    },
    ...snapshot.crews.map((crew) => ({
      crewId: crew.id,
      name: crew.name,
      active: crew.active,
      jobs: [] as DispatchJobSummary[],
    })),
  ];
  const fallbackColumn = columns[0];
  if (!fallbackColumn) {
    return [];
  }

  const columnsByCrew = new Map(columns.map((column) => [column.crewId || "__unassigned__", column] as const));
  for (const job of snapshot.jobs) {
    const key = job.assignedCrewId || "__unassigned__";
    const column = columnsByCrew.get(key) || fallbackColumn;
    column.jobs.push(job);
  }

  for (const column of columns) {
    column.jobs.sort(compareDispatchJobs);
  }

  return columns;
}

function flattenColumns(columns: DispatchColumn[]): DispatchJobSummary[] {
  const jobs: DispatchJobSummary[] = [];
  for (const column of columns) {
    for (const [index, job] of column.jobs.entries()) {
      jobs.push({
        ...job,
        assignedCrewId: column.crewId,
        assignedCrewName: column.crewId ? column.name : null,
        crewOrder: index,
      });
    }
  }
  return jobs.sort(compareDispatchJobs);
}

function snapshotFromColumns(snapshot: DispatchDaySnapshot, columns: DispatchColumn[]): DispatchDaySnapshot {
  const jobs = flattenColumns(columns);
  return {
    ...snapshot,
    jobs,
    crews: snapshot.crews.map((crew) => ({
      ...crew,
      jobCount: columns.find((column) => column.crewId === crew.id)?.jobs.length || 0,
    })),
    counts: {
      total: jobs.length,
      unassigned: columns[0]?.jobs.length || 0,
      completed: jobs.filter((job) => job.status === "completed").length,
      overdue: jobs.filter((job) => job.isOverdue).length,
    },
  };
}

function moveJobBetweenColumns(input: {
  columns: DispatchColumn[];
  draggedJobId: string;
  targetCrewId: string | null;
  beforeJobId: string | null;
}): DispatchColumn[] {
  const nextColumns = input.columns.map((column) => ({
    ...column,
    jobs: [...column.jobs],
  }));

  let movingJob: DispatchJobSummary | null = null;
  for (const column of nextColumns) {
    const index = column.jobs.findIndex((job) => job.id === input.draggedJobId);
    if (index >= 0) {
      movingJob = column.jobs[index] || null;
      column.jobs.splice(index, 1);
      break;
    }
  }

  if (!movingJob) {
    return nextColumns;
  }

  const targetColumn =
    nextColumns.find((column) => column.crewId === input.targetCrewId) || nextColumns[0];
  if (!targetColumn || (targetColumn.crewId && !targetColumn.active)) {
    return nextColumns;
  }
  const insertIndex = input.beforeJobId
    ? targetColumn.jobs.findIndex((job) => job.id === input.beforeJobId)
    : -1;

  const jobForTarget: DispatchJobSummary = {
    ...movingJob,
    assignedCrewId: targetColumn.crewId,
    assignedCrewName: targetColumn.crewId ? targetColumn.name : null,
  };

  if (insertIndex >= 0) {
    targetColumn.jobs.splice(insertIndex, 0, jobForTarget);
  } else {
    targetColumn.jobs.push(jobForTarget);
  }

  return nextColumns;
}

function formatEventDateTime(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatLocalizedDispatchStatus(value: DispatchStatusValue, copy: DispatchManagerCopy): string {
  return copy.dispatchStatuses[value];
}

function formatLocalizedDispatchPriority(value: string, copy: DispatchManagerCopy): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "low" || normalized === "medium" || normalized === "high" || normalized === "urgent") {
    return copy.priorities[normalized];
  }
  return formatDispatchPriorityLabel(value);
}

function formatLocalizedDispatchWindow(
  startTime: string | null,
  endTime: string | null,
  copy: DispatchManagerCopy,
): string {
  if (startTime && endTime) return `${startTime} - ${endTime}`;
  if (startTime) return copy.startsAt(startTime);
  if (endTime) return copy.byTime(endTime);
  return copy.anyTime;
}

export default function DispatchManager({
  orgId,
  orgName,
  internalUser,
  canManage,
  initialDate,
  initialJobId,
}: DispatchManagerProps) {
  const locale = useLocale();
  const copy = getDispatchManagerCopy(locale);
  const normalizedInitialDate = normalizeDispatchDateKey(initialDate) || "";
  const [selectedDate, setSelectedDate] = useState(normalizedInitialDate);
  const [view, setView] = useState<"board" | "list">("board");
  const [snapshot, setSnapshot] = useState<DispatchDaySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const [showNewJob, setShowNewJob] = useState(false);
  const [newJobForm, setNewJobForm] = useState(() => createDispatchJobFormState(normalizedInitialDate || ""));
  const [creating, setCreating] = useState(false);

  const [selectedJobId, setSelectedJobId] = useState<string | null>(initialJobId);
  const [selectedJob, setSelectedJob] = useState<DispatchJobDetail | null>(null);
  const [detailForm, setDetailForm] = useState(() => createDispatchJobFormState(normalizedInitialDate || ""));
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [savingDetail, setSavingDetail] = useState(false);
  const [trackingLink, setTrackingLink] = useState<string | null>(null);
  const [trackingLinkError, setTrackingLinkError] = useState<string | null>(null);
  const [generatingTrackingLink, setGeneratingTrackingLink] = useState(false);

  const [dragJobId, setDragJobId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ crewId: string | null; beforeJobId: string | null } | null>(null);
  const [reordering, setReordering] = useState(false);

  const [showCrewManager, setShowCrewManager] = useState(false);
  const [crewSettings, setCrewSettings] = useState<DispatchCrewManagementItem[]>([]);
  const [crewDrafts, setCrewDrafts] = useState<Record<string, { name: string; active: boolean }>>({});
  const [loadingCrews, setLoadingCrews] = useState(false);
  const [crewError, setCrewError] = useState<string | null>(null);
  const [savingCrewId, setSavingCrewId] = useState<string | null>(null);

  const [showNotificationSettings, setShowNotificationSettings] = useState(false);
  const [notificationSettings, setNotificationSettings] = useState<DispatchNotificationSettings | null>(null);
  const [loadingNotificationSettings, setLoadingNotificationSettings] = useState(false);
  const [savingNotificationSettings, setSavingNotificationSettings] = useState(false);
  const [notificationSettingsError, setNotificationSettingsError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedDate) return;
    setSelectedDate(getTodayDateKey());
  }, [selectedDate]);

  useEffect(() => {
    if (!showNewJob && selectedDate) {
      setNewJobForm(createDispatchJobFormState(selectedDate));
    }
  }, [selectedDate, showNewJob]);

  useEffect(() => {
    let cancelled = false;

    async function loadSnapshot() {
      if (!selectedDate) return;
      setLoading(true);
      setError(null);

      try {
        const query = createQuery({ date: selectedDate, today: getTodayDateKey() }, orgId, internalUser);
        const response = await fetch(`/api/dispatch?${query}`, {
          method: "GET",
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as SnapshotResponse;

        if (!response.ok || !payload?.ok || !payload.snapshot) {
          throw new Error(payload?.error || copy.errors.loadDispatch);
        }

        if (cancelled) return;
        setSnapshot(payload.snapshot);

        if (selectedJobId && !payload.snapshot.jobs.some((job) => job.id === selectedJobId)) {
          setSelectedJobId(null);
          setSelectedJob(null);
          setDetailError(null);
        }
      } catch (loadError) {
        if (cancelled) return;
        setSnapshot(null);
        setError(loadError instanceof Error ? loadError.message : copy.errors.loadDispatch);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadSnapshot();

    return () => {
      cancelled = true;
    };
  }, [copy.errors.loadDispatch, internalUser, orgId, refreshToken, selectedDate, selectedJobId]);

  useEffect(() => {
    if (!selectedJobId) return;

    let cancelled = false;

    async function loadJobDetail() {
      setLoadingDetail(true);
      setDetailError(null);

      try {
        const query = new URLSearchParams({
          today: getTodayDateKey(),
        });
        const response = await fetch(`/api/dispatch/jobs/${selectedJobId}?${query.toString()}`, {
          method: "GET",
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as DispatchJobResponse;
        if (!response.ok || !payload?.ok || !payload.job) {
          throw new Error(payload?.error || copy.errors.loadDispatchJob);
        }

        if (cancelled) return;
        setSelectedJob(payload.job);
        setDetailForm(toFormState(payload.job));
      } catch (loadError) {
        if (cancelled) return;
        setSelectedJob(null);
        setDetailError(loadError instanceof Error ? loadError.message : copy.errors.loadDispatchJob);
      } finally {
        if (!cancelled) {
          setLoadingDetail(false);
        }
      }
    }

    void loadJobDetail();

    return () => {
      cancelled = true;
    };
  }, [copy.errors.loadDispatchJob, selectedJobId]);

  useEffect(() => {
    if (!showCrewManager || !canManage) return;
    void loadCrewSettings();
  }, [canManage, showCrewManager]);

  useEffect(() => {
    setTrackingLink(null);
    setTrackingLinkError(null);
    setGeneratingTrackingLink(false);
  }, [selectedJobId]);

  useEffect(() => {
    if (!showNotificationSettings || !canManage) return;
    void loadNotificationSettings();
  }, [canManage, showNotificationSettings]);

  const columns = buildColumns(snapshot, copy.unassigned);
  const selectedJobSummary = snapshot?.jobs.find((job) => job.id === selectedJobId) || null;
  const activeCrews = (snapshot?.crews || []).filter((crew) => crew.active);

  async function loadCrewSettings() {
    setLoadingCrews(true);
    setCrewError(null);

    try {
      const response = await fetch(`/api/dispatch/crews?${createQuery({}, orgId, internalUser)}`, {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as DispatchCrewResponse;
      if (!response.ok || !payload?.ok || !payload.crews) {
        throw new Error(payload?.error || copy.errors.loadCrews);
      }

      setCrewSettings(payload.crews);
      setCrewDrafts(
        Object.fromEntries(
          payload.crews.map((crew) => [
            crew.id,
            {
              name: crew.name,
              active: crew.active,
            },
          ]),
        ),
      );
    } catch (loadError) {
      setCrewError(loadError instanceof Error ? loadError.message : copy.errors.loadCrews);
    } finally {
      setLoadingCrews(false);
    }
  }

  async function loadNotificationSettings() {
    setLoadingNotificationSettings(true);
    setNotificationSettingsError(null);

    try {
      const response = await fetch(`/api/dispatch/settings?${createQuery({}, orgId, internalUser)}`, {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as DispatchSettingsResponse;
      if (!response.ok || !payload?.ok || !payload.settings) {
        throw new Error(payload?.error || copy.errors.loadSettings);
      }

      setNotificationSettings(payload.settings);
    } catch (loadError) {
      setNotificationSettingsError(loadError instanceof Error ? loadError.message : copy.errors.loadSettings);
    } finally {
      setLoadingNotificationSettings(false);
    }
  }

  async function handleCreateJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setNotice(null);
    setError(null);

    try {
      const response = await fetch("/api/dispatch/jobs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...(internalUser ? { orgId } : {}),
          todayDate: getTodayDateKey(),
          ...toPayload(newJobForm),
        }),
      });

      const payload = (await response.json().catch(() => null)) as DispatchCreateResponse;
      if (!response.ok || !payload?.ok || !payload.job) {
        throw new Error(payload?.error || copy.errors.createJob);
      }

      setShowNewJob(false);
      setSelectedJobId(payload.job.id);
      setNotice(copy.notices.jobCreated);
      setRefreshToken((token) => token + 1);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : copy.errors.createJob);
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveDetail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedJobId) return;

    setSavingDetail(true);
    setNotice(null);
    setDetailError(null);

    try {
      const response = await fetch(`/api/dispatch/jobs/${selectedJobId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...toPayload(detailForm),
          todayDate: getTodayDateKey(),
        }),
      });

      const payload = (await response.json().catch(() => null)) as DispatchJobResponse;
      if (!response.ok || !payload?.ok || !payload.job) {
        throw new Error(payload?.error || copy.errors.saveJob);
      }

      setSelectedJob(payload.job);
      setDetailForm(toFormState(payload.job));
      setNotice(copy.notices.jobUpdated);
      setRefreshToken((token) => token + 1);
    } catch (saveError) {
      setDetailError(saveError instanceof Error ? saveError.message : copy.errors.saveJob);
    } finally {
      setSavingDetail(false);
    }
  }

  async function handleSaveCrew(crewId: string) {
    const draft = crewDrafts[crewId];
    if (!draft) return;

    setSavingCrewId(crewId);
    setCrewError(null);

    try {
      const response = await fetch("/api/dispatch/crews", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...(internalUser ? { orgId } : {}),
          crewId,
          name: draft.name,
          active: draft.active,
        }),
      });

      const payload = (await response.json().catch(() => null)) as DispatchCrewResponse;
      if (!response.ok || !payload?.ok || !payload.crews) {
        throw new Error(payload?.error || copy.errors.saveCrew);
      }

      setCrewSettings(payload.crews);
      setCrewDrafts(
        Object.fromEntries(
          payload.crews.map((crew) => [
            crew.id,
            {
              name: crew.name,
              active: crew.active,
            },
          ]),
        ),
      );
      setNotice(copy.notices.crewUpdated);
      setRefreshToken((token) => token + 1);
    } catch (saveError) {
      setCrewError(saveError instanceof Error ? saveError.message : copy.errors.saveCrew);
    } finally {
      setSavingCrewId(null);
    }
  }

  async function handleSaveNotificationSettings() {
    if (!notificationSettings) return;

    setSavingNotificationSettings(true);
    setNotificationSettingsError(null);

    try {
      const response = await fetch("/api/dispatch/settings", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...(internalUser ? { orgId } : {}),
          smsEnabled: notificationSettings.smsEnabled,
          notifyScheduled: notificationSettings.notifyScheduled,
          notifyOnTheWay: notificationSettings.notifyOnTheWay,
          notifyRescheduled: notificationSettings.notifyRescheduled,
          notifyCompleted: notificationSettings.notifyCompleted,
        }),
      });

      const payload = (await response.json().catch(() => null)) as DispatchSettingsResponse;
      if (!response.ok || !payload?.ok || !payload.settings) {
        throw new Error(payload?.error || copy.errors.saveSettings);
      }

      setNotificationSettings(payload.settings);
      setNotice(copy.notices.settingsUpdated);
    } catch (saveError) {
      setNotificationSettingsError(
        saveError instanceof Error ? saveError.message : copy.errors.saveSettings,
      );
    } finally {
      setSavingNotificationSettings(false);
    }
  }

  async function handleQuickStatusChange(job: DispatchJobSummary, status: DispatchStatusValue) {
    if (!canManage || status === job.status) return;

    const previousSnapshot = snapshot;
    if (previousSnapshot) {
      const nextJobs = previousSnapshot.jobs.map((entry) =>
        entry.id === job.id
          ? {
              ...entry,
              status,
              isOverdue:
                entry.scheduledDate < getTodayDateKey() &&
                status !== "completed" &&
                status !== "rescheduled" &&
                status !== "canceled",
            }
          : entry,
      );
      setSnapshot({
        ...previousSnapshot,
        jobs: nextJobs,
        counts: {
          ...previousSnapshot.counts,
          completed: nextJobs.filter((entry) => entry.status === "completed").length,
          overdue: nextJobs.filter((entry) => entry.isOverdue).length,
        },
      });
    }

    try {
      const response = await fetch(`/api/dispatch/jobs/${job.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          status,
          todayDate: getTodayDateKey(),
        }),
      });

      const payload = (await response.json().catch(() => null)) as DispatchJobResponse;
      if (!response.ok || !payload?.ok || !payload.job) {
        throw new Error(payload?.error || copy.errors.updateStatus);
      }

      if (selectedJobId === job.id) {
        setSelectedJob(payload.job);
        setDetailForm(toFormState(payload.job));
      }

      setNotice(copy.notices.statusUpdated);
      setRefreshToken((token) => token + 1);
    } catch (saveError) {
      if (previousSnapshot) {
        setSnapshot(previousSnapshot);
      }
      setError(saveError instanceof Error ? saveError.message : copy.errors.updateStatus);
    }
  }

  async function handleGenerateTrackingLink(copyAfterCreate: boolean) {
    if (!selectedJobId || !canManage) return;

    setGeneratingTrackingLink(true);
    setTrackingLinkError(null);

    try {
      const response = await fetch(`/api/dispatch/jobs/${selectedJobId}/tracking-link`, {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as DispatchTrackingLinkResponse;
      if (!response.ok || !payload?.ok || !payload.tracking?.url) {
        throw new Error(payload?.error || copy.errors.generateLink);
      }

      setTrackingLink(payload.tracking.url);

      if (copyAfterCreate) {
        await navigator.clipboard.writeText(payload.tracking.url);
        setNotice(copy.notices.trackingLinkCopied);
      } else {
        setNotice(copy.notices.trackingLinkCreated);
      }
    } catch (trackingError) {
      const message = trackingError instanceof Error ? trackingError.message : copy.errors.generateLink;
      setTrackingLinkError(message);
    } finally {
      setGeneratingTrackingLink(false);
    }
  }

  async function handleCopyTrackingLink() {
    if (!canManage) return;

    if (!trackingLink) {
      await handleGenerateTrackingLink(true);
      return;
    }

    try {
      await navigator.clipboard.writeText(trackingLink);
      setNotice(copy.notices.trackingLinkCopied);
      setTrackingLinkError(null);
    } catch (copyError) {
      setTrackingLinkError(copyError instanceof Error ? copyError.message : copy.errors.copyLink);
    }
  }

  async function commitReorder(nextColumns: DispatchColumn[], previousSnapshot: DispatchDaySnapshot) {
    setReordering(true);
    setError(null);

    try {
      const response = await fetch("/api/dispatch/jobs/reorder", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...(internalUser ? { orgId } : {}),
          date: selectedDate,
          todayDate: getTodayDateKey(),
          columns: nextColumns.map((column) => ({
            crewId: column.crewId,
            jobIds: column.jobs.map((job) => job.id),
          })),
        }),
      });

      const payload = (await response.json().catch(() => null)) as SnapshotResponse;
      if (!response.ok || !payload?.ok || !payload.snapshot) {
        throw new Error(payload?.error || copy.errors.reorderBoard);
      }

      setSnapshot(payload.snapshot);
      setRefreshToken((token) => token + 1);
    } catch (saveError) {
      setSnapshot(previousSnapshot);
      setError(saveError instanceof Error ? saveError.message : copy.errors.reorderBoard);
    } finally {
      setReordering(false);
      setDragJobId(null);
      setDropTarget(null);
    }
  }

  function handleDrop(targetCrewId: string | null, beforeJobId: string | null) {
    if (!snapshot || !dragJobId || reordering) return;
    const targetColumn = columns.find((column) => column.crewId === targetCrewId) || columns[0];
    if (!targetColumn || (targetColumn.crewId && !targetColumn.active)) {
      return;
    }

    const nextColumns = moveJobBetweenColumns({
      columns,
      draggedJobId: dragJobId,
      targetCrewId,
      beforeJobId,
    });
    const nextSnapshot = snapshotFromColumns(snapshot, nextColumns);
    setSnapshot(nextSnapshot);
    void commitReorder(nextColumns, snapshot);
  }

  const toolbar = (
    <section className="card">
      <div className="dispatch-header">
        <div>
          <h2>{copy.title}</h2>
          <p className="muted">{copy.subtitle(orgName)}</p>
        </div>
        {!canManage ? <span className="badge">{copy.readOnly}</span> : null}
      </div>

      <div className="dispatch-toolbar">
        <div className="dispatch-toolbar-date">
          <label>
            {copy.selectedDate}
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
            />
          </label>
          <button
            className="btn secondary"
            type="button"
            onClick={() => setSelectedDate(getTodayDateKey())}
          >
            {copy.today}
          </button>
        </div>

        <div className="dispatch-toolbar-actions">
          <div className="dispatch-view-toggle" role="tablist" aria-label={copy.title}>
            <button
              className={`btn secondary dispatch-toggle ${view === "board" ? "active" : ""}`}
              type="button"
              onClick={() => setView("board")}
            >
              {copy.board}
            </button>
            <button
              className={`btn secondary dispatch-toggle ${view === "list" ? "active" : ""}`}
              type="button"
              onClick={() => setView("list")}
            >
              {copy.list}
            </button>
          </div>
          {canManage ? (
            <>
              <button className="btn secondary" type="button" onClick={() => setShowCrewManager(true)}>
                {copy.crews}
              </button>
              <button className="btn secondary" type="button" onClick={() => setShowNotificationSettings(true)}>
                {copy.smsUpdates}
              </button>
              <button
                className="btn primary"
                type="button"
                onClick={() => {
                  setShowNewJob(true);
                  setNewJobForm(createDispatchJobFormState(selectedDate));
                }}
              >
                {copy.newJob}
              </button>
            </>
          ) : null}
        </div>
      </div>

      <div className="dispatch-summary-grid">
        <div className="card dispatch-summary-card">
          <span className="muted">{copy.totalJobs}</span>
          <strong>{snapshot?.counts.total || 0}</strong>
        </div>
        <div className="card dispatch-summary-card">
          <span className="muted">{copy.unassigned}</span>
          <strong>{snapshot?.counts.unassigned || 0}</strong>
        </div>
        <div className="card dispatch-summary-card">
          <span className="muted">{copy.completed}</span>
          <strong>{snapshot?.counts.completed || 0}</strong>
        </div>
        <div className={`card dispatch-summary-card ${(snapshot?.counts.overdue || 0) > 0 ? "dispatch-summary-card--warning" : ""}`}>
          <span className="muted">{copy.overdue}</span>
          <strong>{snapshot?.counts.overdue || 0}</strong>
        </div>
      </div>

      {notice ? <p className="muted">{notice}</p> : null}
      {error ? <p className="muted text-danger">{error}</p> : null}
    </section>
  );

  return (
    <div className="dispatch-shell">
      {toolbar}

      {loading ? (
        <section className="card">
          <p className="muted">{copy.loadingDispatch(selectedDate)}</p>
        </section>
      ) : view === "board" ? (
        <section className="dispatch-board">
          {columns.map((column) => (
            <article
              key={column.crewId || "unassigned"}
              className={`card dispatch-column ${dropTarget?.crewId === column.crewId && !dropTarget.beforeJobId ? "is-target" : ""} ${
                column.active ? "" : "is-inactive"
              }`}
              onDragOver={(event) => {
                if (!canManage || !dragJobId || (column.crewId && !column.active)) return;
                event.preventDefault();
                setDropTarget({ crewId: column.crewId, beforeJobId: null });
              }}
              onDrop={(event) => {
                if (!canManage || (column.crewId && !column.active)) return;
                event.preventDefault();
                handleDrop(column.crewId, null);
              }}
            >
              <header className="dispatch-column-head">
                <div>
                  <h3>{column.name}</h3>
                  <span className="muted">{copy.jobCount(column.jobs.length)}</span>
                </div>
                <div className="dispatch-column-badges">
                  {column.crewId ? <span className="badge">{column.jobs.length}</span> : null}
                  {column.crewId && !column.active ? <span className="badge muted">{copy.inactive}</span> : null}
                </div>
              </header>

              <div className="dispatch-column-body">
                {column.jobs.length === 0 ? (
                  <div className="dispatch-column-empty">
                    <strong>{column.crewId && !column.active ? copy.inactiveCrew : copy.noJobsYet}</strong>
                    <span className="muted">
                      {column.crewId
                        ? column.active
                          ? copy.dropJobHere
                          : copy.reactivateCrew
                        : copy.newJobsLandHere}
                    </span>
                  </div>
                ) : (
                  column.jobs.map((job) => (
                    <button
                      key={job.id}
                      type="button"
                      className={`dispatch-job-card ${job.isOverdue ? "overdue" : ""} ${dropTarget?.beforeJobId === job.id ? "drop-before" : ""}`}
                      draggable={canManage}
                      onClick={() => {
                        setSelectedJobId(job.id);
                        setDetailError(null);
                      }}
                      onDragStart={() => {
                        if (!canManage) return;
                        setDragJobId(job.id);
                      }}
                      onDragEnd={() => {
                        setDragJobId(null);
                        setDropTarget(null);
                      }}
                      onDragOver={(event) => {
                        if (!canManage || !dragJobId || (column.crewId && !column.active)) return;
                        event.preventDefault();
                        setDropTarget({ crewId: column.crewId, beforeJobId: job.id });
                      }}
                      onDrop={(event) => {
                        if (!canManage || (column.crewId && !column.active)) return;
                        event.preventDefault();
                        handleDrop(column.crewId, job.id);
                      }}
                    >
                      <div className="dispatch-job-card-head">
                        <div className="dispatch-job-card-title">
                          <strong>{job.customerName}</strong>
                          <span className="muted">{job.serviceType}</span>
                        </div>
                        {job.priority ? (
                          <span className={`badge priority-${job.priority}`}>
                            {formatLocalizedDispatchPriority(job.priority, copy)}
                          </span>
                        ) : null}
                      </div>

                      <div className="dispatch-job-card-body">
                        <span>{job.address}</span>
                        <span>{formatLocalizedDispatchWindow(job.scheduledStartTime, job.scheduledEndTime, copy)}</span>
                        {job.isOverdue ? <span className="badge status-overdue">{copy.overdue}</span> : null}
                      </div>

                      <div className="dispatch-job-card-footer">
                        <span className={`badge status-${job.status}`}>{formatLocalizedDispatchStatus(job.status, copy)}</span>
                        {canManage ? (
                          <select
                            className="dispatch-card-status-select"
                            value={job.status}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => {
                              event.stopPropagation();
                              void handleQuickStatusChange(job, event.target.value as DispatchStatusValue);
                            }}
                          >
                            {dispatchStatusValues.map((value) => (
                              <option key={value} value={value}>
                                {formatLocalizedDispatchStatus(value, copy)}
                              </option>
                            ))}
                          </select>
                        ) : null}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="card">
          {snapshot && snapshot.jobs.length > 0 ? (
            <>
              <ul className="mobile-list-cards" style={{ marginTop: 0 }}>
                {snapshot.jobs.map((job) => (
                  <li key={job.id} className="mobile-list-card">
                    <div className="stack-cell">
                      <button
                        type="button"
                        className="table-link dispatch-inline-link"
                        onClick={() => {
                          setSelectedJobId(job.id);
                          setDetailError(null);
                        }}
                      >
                        {job.customerName}
                      </button>
                      <span className="muted">{job.serviceType}</span>
                    </div>
                    <div className="quick-meta">
                      <span className={`badge status-${job.status}`}>{formatLocalizedDispatchStatus(job.status, copy)}</span>
                      {job.priority ? (
                        <span className={`badge priority-${job.priority}`}>
                          {formatLocalizedDispatchPriority(job.priority, copy)}
                        </span>
                      ) : null}
                    </div>
                    <div className="stack-cell">
                      <span>{job.address}</span>
                      <span className="muted">{formatLocalizedDispatchWindow(job.scheduledStartTime, job.scheduledEndTime, copy)}</span>
                      <span className="muted">{job.assignedCrewName || copy.unassigned}</span>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="table-wrap desktop-table-only">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{copy.customer}</th>
                      <th>{copy.service}</th>
                      <th>{copy.address}</th>
                      <th>{copy.scheduledTime}</th>
                      <th>{copy.assignedCrew}</th>
                      <th>{copy.status}</th>
                      <th>{copy.priority}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.jobs.map((job) => (
                      <tr key={job.id}>
                        <td>
                          <button
                            type="button"
                            className="table-link dispatch-inline-link"
                            onClick={() => {
                              setSelectedJobId(job.id);
                              setDetailError(null);
                            }}
                          >
                            {job.customerName}
                          </button>
                        </td>
                        <td>{job.serviceType}</td>
                        <td>{job.address}</td>
                        <td>{formatLocalizedDispatchWindow(job.scheduledStartTime, job.scheduledEndTime, copy)}</td>
                        <td>{job.assignedCrewName || copy.unassigned}</td>
                        <td>
                          <span className={`badge status-${job.status}`}>{formatLocalizedDispatchStatus(job.status, copy)}</span>
                        </td>
                        <td>
                          {job.priority ? (
                            <span className={`badge priority-${job.priority}`}>
                              {formatLocalizedDispatchPriority(job.priority, copy)}
                            </span>
                          ) : (
                            <span className="muted">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="portal-empty-state">
              <strong>{copy.clearDayTitle}</strong>
              <p className="muted">{copy.clearDayBody}</p>
              {canManage ? (
                <div className="portal-empty-actions">
                  <button
                    className="btn primary"
                    type="button"
                    onClick={() => {
                      setNewJobForm(createDispatchJobFormState(selectedDate));
                      setShowNewJob(true);
                    }}
                  >
                    {copy.newJob}
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </section>
      )}

      {showNewJob ? (
        <div className="quicklead-backdrop" role="dialog" aria-modal>
          <div className="quicklead-modal dispatch-modal">
            <header className="dispatch-modal-head">
              <div>
                <h3>{copy.newJob}</h3>
                <p className="muted">{copy.newJobBody(selectedDate)}</p>
              </div>
              <button className="btn secondary" type="button" onClick={() => setShowNewJob(false)} disabled={creating}>
                {copy.close}
              </button>
            </header>

            <DispatchJobForm
              orgId={orgId}
              internalUser={internalUser}
              form={newJobForm}
              crews={activeCrews}
              onChange={(patch) => setNewJobForm((current) => ({ ...current, ...patch }))}
              onSubmit={handleCreateJob}
              submitLabel={copy.save}
              submitBusyLabel={copy.saving}
              isSubmitting={creating}
              disabled={creating}
              secondaryActions={
                <button className="btn secondary" type="button" onClick={() => setShowNewJob(false)} disabled={creating}>
                  {copy.cancel}
                </button>
              }
            />
          </div>
        </div>
      ) : null}

      {showCrewManager ? (
        <div className="quicklead-backdrop" role="dialog" aria-modal>
          <div className="quicklead-modal dispatch-modal dispatch-settings-modal">
            <header className="dispatch-modal-head">
              <div>
                <h3>{copy.crewManagement}</h3>
                <p className="muted">{copy.crewManagementBody}</p>
              </div>
              <button className="btn secondary" type="button" onClick={() => setShowCrewManager(false)}>
                {copy.close}
              </button>
            </header>

            {loadingCrews ? <p className="muted">{copy.loadingCrews}</p> : null}
            {crewError ? <p className="muted text-danger">{crewError}</p> : null}

            <div className="dispatch-settings-stack">
              {crewSettings.map((crew) => {
                const draft = crewDrafts[crew.id] || { name: crew.name, active: crew.active };
                return (
                  <div key={crew.id} className="card dispatch-settings-card">
                    <div className="dispatch-settings-row">
                      <label>
                        {copy.crewName}
                        <input
                          value={draft.name}
                          onChange={(event) =>
                            setCrewDrafts((current) => ({
                              ...current,
                              [crew.id]: {
                                ...draft,
                                name: event.target.value,
                              },
                            }))
                          }
                          disabled={savingCrewId === crew.id}
                        />
                      </label>
                      <label className="dispatch-checkbox-field">
                        <input
                          type="checkbox"
                          checked={draft.active}
                          onChange={(event) =>
                            setCrewDrafts((current) => ({
                              ...current,
                              [crew.id]: {
                                ...draft,
                                active: event.target.checked,
                              },
                            }))
                          }
                          disabled={savingCrewId === crew.id}
                        />
                        {copy.active}
                      </label>
                    </div>
                    <div className="dispatch-settings-footer">
                      <span className="muted">
                        {crew.openJobCount > 0
                          ? copy.openAssignedJobs(crew.openJobCount)
                          : copy.noOpenAssignedJobs}
                      </span>
                      <button
                        className="btn secondary"
                        type="button"
                        onClick={() => void handleSaveCrew(crew.id)}
                        disabled={savingCrewId === crew.id}
                      >
                        {savingCrewId === crew.id ? copy.saving : copy.save}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {showNotificationSettings ? (
        <div className="quicklead-backdrop" role="dialog" aria-modal>
          <div className="quicklead-modal dispatch-modal dispatch-settings-modal">
            <header className="dispatch-modal-head">
              <div>
                <h3>{copy.customerSmsUpdates}</h3>
                <p className="muted">{copy.customerSmsUpdatesBody}</p>
              </div>
              <button className="btn secondary" type="button" onClick={() => setShowNotificationSettings(false)}>
                {copy.close}
              </button>
            </header>

            {loadingNotificationSettings ? <p className="muted">{copy.loadingSmsSettings}</p> : null}
            {notificationSettingsError ? <p className="muted text-danger">{notificationSettingsError}</p> : null}

            {notificationSettings ? (
              <div className="dispatch-settings-stack">
                <div className="card dispatch-settings-card">
                  <label className="dispatch-checkbox-field">
                    <input
                      type="checkbox"
                      checked={notificationSettings.smsEnabled}
                      onChange={(event) =>
                        setNotificationSettings((current) =>
                          current
                            ? {
                                ...current,
                                smsEnabled: event.target.checked,
                              }
                            : current,
                        )
                      }
                      disabled={savingNotificationSettings}
                    />
                    {copy.sendCustomerDispatchSms}
                  </label>
                  <p className="muted">
                    {notificationSettings.canSend
                      ? copy.usesTwilio
                      : copy.twilioNotReady}
                  </p>
                </div>

                <div className="card dispatch-settings-card dispatch-settings-grid">
                  <label className="dispatch-checkbox-field">
                    <input
                      type="checkbox"
                      checked={notificationSettings.notifyScheduled}
                      onChange={(event) =>
                        setNotificationSettings((current) =>
                          current
                            ? {
                                ...current,
                                notifyScheduled: event.target.checked,
                              }
                            : current,
                        )
                      }
                      disabled={savingNotificationSettings || !notificationSettings.smsEnabled}
                    />
                    {copy.dispatchStatuses.scheduled}
                  </label>
                  <label className="dispatch-checkbox-field">
                    <input
                      type="checkbox"
                      checked={notificationSettings.notifyOnTheWay}
                      onChange={(event) =>
                        setNotificationSettings((current) =>
                          current
                            ? {
                                ...current,
                                notifyOnTheWay: event.target.checked,
                              }
                            : current,
                        )
                      }
                      disabled={savingNotificationSettings || !notificationSettings.smsEnabled}
                    />
                    {copy.dispatchStatuses.on_the_way}
                  </label>
                  <label className="dispatch-checkbox-field">
                    <input
                      type="checkbox"
                      checked={notificationSettings.notifyRescheduled}
                      onChange={(event) =>
                        setNotificationSettings((current) =>
                          current
                            ? {
                                ...current,
                                notifyRescheduled: event.target.checked,
                              }
                            : current,
                        )
                      }
                      disabled={savingNotificationSettings || !notificationSettings.smsEnabled}
                    />
                    {copy.dispatchStatuses.rescheduled}
                  </label>
                  <label className="dispatch-checkbox-field">
                    <input
                      type="checkbox"
                      checked={notificationSettings.notifyCompleted}
                      onChange={(event) =>
                        setNotificationSettings((current) =>
                          current
                            ? {
                                ...current,
                                notifyCompleted: event.target.checked,
                              }
                            : current,
                        )
                      }
                      disabled={savingNotificationSettings || !notificationSettings.smsEnabled}
                    />
                    {copy.dispatchStatuses.completed}
                  </label>
                </div>

                <div className="dispatch-form-actions">
                  <button className="btn secondary" type="button" onClick={() => setShowNotificationSettings(false)}>
                    {copy.cancel}
                  </button>
                  <button
                    className="btn primary"
                    type="button"
                    onClick={() => void handleSaveNotificationSettings()}
                    disabled={savingNotificationSettings}
                  >
                    {savingNotificationSettings ? copy.saving : copy.save}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {selectedJobId ? (
        <div className="dispatch-drawer" role="dialog" aria-modal>
          <button
            className="dispatch-drawer-backdrop"
            type="button"
            aria-label={copy.closeDispatchJobDetails}
            onClick={() => {
              setSelectedJobId(null);
              setSelectedJob(null);
              setDetailError(null);
            }}
          />
          <aside className="dispatch-drawer-card">
            <div className="dispatch-drawer-head">
              <div>
                <p className="muted">{copy.jobDetails}</p>
                <h3>{selectedJob?.customerName || selectedJobSummary?.customerName || copy.dispatchJob}</h3>
              </div>
              <div className="quick-links">
                {selectedJob ? (
                  <Link
                    className="btn secondary"
                    href={withOrgQuery(`/app/jobs/records/${selectedJob.id}`, orgId, internalUser)}
                  >
                    {copy.openJobWorkspace}
                  </Link>
                ) : null}
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => {
                    setSelectedJobId(null);
                    setSelectedJob(null);
                    setDetailError(null);
                  }}
                >
                  {copy.close}
                </button>
              </div>
            </div>

            <div className="dispatch-drawer-body">
              {loadingDetail ? <p className="muted">{copy.loadingJobDetails}</p> : null}
              {detailError ? <p className="muted text-danger">{detailError}</p> : null}

              {selectedJob ? (
                <>
                  <section className="card dispatch-drawer-panel">
                    <div className="dispatch-detail-grid">
                      <div>
                        <span className="muted">{copy.customer}</span>
                        <strong>{selectedJob.customerName}</strong>
                      </div>
                      <div>
                        <span className="muted">{copy.phone}</span>
                        <strong>{selectedJob.phone || "-"}</strong>
                      </div>
                      <div>
                        <span className="muted">{copy.service}</span>
                        <strong>{selectedJob.serviceType}</strong>
                      </div>
                      <div>
                        <span className="muted">{copy.address}</span>
                        <strong>{selectedJob.address}</strong>
                      </div>
                      <div>
                        <span className="muted">{copy.crew}</span>
                        <strong>{selectedJob.assignedCrewName || copy.unassigned}</strong>
                      </div>
                      <div>
                        <span className="muted">{copy.status}</span>
                        <strong>{formatLocalizedDispatchStatus(selectedJob.status, copy)}</strong>
                      </div>
                      <div>
                        <span className="muted">{copy.linkedCustomer}</span>
                        <strong>{selectedJob.customerLabel || "-"}</strong>
                      </div>
                      <div>
                        <span className="muted">{copy.linkedLead}</span>
                        <strong>{selectedJob.leadLabel || "-"}</strong>
                      </div>
                    </div>

                    {selectedJob.notes ? (
                      <div className="dispatch-detail-notes">
                        <span className="muted">{copy.notes}</span>
                        <p>{selectedJob.notes}</p>
                      </div>
                    ) : null}
                  </section>

                  <section className="card dispatch-drawer-panel">
                    <div className="dispatch-panel-head">
                      <div>
                        <h4>{copy.linkedEstimate}</h4>
                        <p className="muted">{copy.linkedEstimateBody}</p>
                      </div>
                      {selectedJob.linkedEstimate ? (
                        <Link
                          className="btn secondary"
                          href={withOrgQuery(`/app/estimates/${selectedJob.linkedEstimate.id}`, orgId, internalUser)}
                        >
                          {copy.openEstimate}
                        </Link>
                      ) : null}
                    </div>

                    {selectedJob.linkedEstimate ? (
                      <div className="dispatch-estimate-card">
                        <strong>
                          {selectedJob.linkedEstimate.estimateNumber} · {selectedJob.linkedEstimate.title}
                        </strong>
                        <span className="muted">{selectedJob.linkedEstimate.status}</span>
                        <span>{formatEstimateCurrency(selectedJob.linkedEstimate.total)}</span>
                      </div>
                    ) : (
                      <p className="muted">{copy.noLinkedEstimate}</p>
                    )}
                  </section>

                  <section className="card dispatch-drawer-panel">
                    <div className="dispatch-panel-head">
                      <div>
                        <h4>{copy.recentCommunication}</h4>
                        <p className="muted">{copy.recentCommunicationBody}</p>
                      </div>
                    </div>

                    {selectedJob.recentCommunication.length > 0 ? (
                      <ul className="timeline">
                        {selectedJob.recentCommunication.map((event) => (
                          <li key={event.id} className="timeline-item">
                            <span className="timeline-dot" />
                            <div className="timeline-content">
                              <strong>{event.summary}</strong>
                              <span className="muted">
                                {event.channel} · {formatEventDateTime(event.occurredAt, locale)}
                                {event.leadLabel ? ` · ${event.leadLabel}` : ""}
                              </span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted">{copy.noRecentCommunication}</p>
                    )}
                  </section>

                  {canManage ? (
                    <section className="card dispatch-drawer-panel">
                      <div className="dispatch-panel-head">
                        <div>
                          <h4>{copy.customerTracking}</h4>
                          <p className="muted">{copy.customerTrackingBody}</p>
                        </div>
                        <button
                          className="btn secondary"
                          type="button"
                          onClick={() => void handleCopyTrackingLink()}
                          disabled={generatingTrackingLink}
                        >
                          {generatingTrackingLink ? copy.generating : trackingLink ? copy.copyLink : copy.createLink}
                        </button>
                      </div>

                      {trackingLinkError ? <p className="muted text-danger">{trackingLinkError}</p> : null}

                      {trackingLink ? (
                        <div className="estimate-share-link-box">
                          <input value={trackingLink} readOnly aria-label={copy.customerTrackingLink} />
                          <div className="portal-empty-actions">
                            <a className="btn secondary" href={trackingLink} target="_blank" rel="noreferrer">
                              {copy.openTrackingPage}
                            </a>
                            <button
                              className="btn secondary"
                              type="button"
                              onClick={() => void handleGenerateTrackingLink(false)}
                              disabled={generatingTrackingLink}
                            >
                              {copy.createFreshLink}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="muted">{copy.createShareableLink}</p>
                      )}
                    </section>
                  ) : null}

                  {canManage ? (
                    <section className="card dispatch-drawer-panel">
                      <div className="dispatch-panel-head">
                        <div>
                          <h4>{copy.editJob}</h4>
                          <p className="muted">{copy.editJobBody}</p>
                        </div>
                      </div>

                      <DispatchJobForm
                        orgId={orgId}
                        internalUser={internalUser}
                        form={detailForm}
                        crews={(snapshot?.crews || []).filter(
                          (crew) => crew.active || crew.id === (detailForm.assignedCrewId || selectedJob.assignedCrewId || ""),
                        )}
                        includeStatus
                        onChange={(patch) => setDetailForm((current) => ({ ...current, ...patch }))}
                        onSubmit={handleSaveDetail}
                        submitLabel={copy.saveChanges}
                        submitBusyLabel={copy.saving}
                        isSubmitting={savingDetail}
                        disabled={savingDetail}
                      />
                    </section>
                  ) : null}
                </>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
