"use client";

import { useEffect, useState, type FormEventHandler, type ReactNode } from "react";
import { useLocale } from "next-intl";
import {
  dispatchPriorityValues,
  dispatchStatusValues,
  type DispatchCustomerLookupItem,
  type DispatchLeadLookupItem,
  type DispatchStatusValue,
} from "@/lib/dispatch";

export type DispatchJobFormState = {
  customerId: string;
  customerLabel: string;
  leadId: string;
  leadLabel: string;
  customerName: string;
  phone: string;
  serviceType: string;
  address: string;
  scheduledDate: string;
  scheduledStartTime: string;
  scheduledEndTime: string;
  assignedCrewId: string;
  notes: string;
  priority: string;
  status: DispatchStatusValue;
};

type DispatchJobFormProps = {
  orgId: string;
  internalUser: boolean;
  form: DispatchJobFormState;
  crews: {
    id: string;
    name: string;
  }[];
  disabled?: boolean;
  disableScheduleFields?: boolean;
  disableStatusField?: boolean;
  scheduleHint?: string | null;
  includeStatus?: boolean;
  submitLabel: string;
  submitBusyLabel?: string;
  isSubmitting?: boolean;
  secondaryActions?: ReactNode;
  onChange: (patch: Partial<DispatchJobFormState>) => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
};

type LookupResponse =
  | {
      ok?: boolean;
      customers?: DispatchCustomerLookupItem[];
      leads?: DispatchLeadLookupItem[];
      error?: string;
    }
  | null;

type DispatchJobFormCopy = {
  clear: string;
  customer: string;
  customerOptional: string;
  customerPlaceholder: string;
  customerSearching: string;
  customerSearchError: string;
  lead: string;
  leadOptional: string;
  leadPlaceholder: string;
  leadSearching: string;
  leadSearchError: string;
  noExtraDetails: string;
  typeAtLeastTwo: string;
  customerName: string;
  customerNamePlaceholder: string;
  phone: string;
  serviceType: string;
  serviceTypePlaceholder: string;
  address: string;
  addressPlaceholder: string;
  scheduledDate: string;
  assignedCrew: string;
  unassigned: string;
  startTime: string;
  endTime: string;
  priority: string;
  none: string;
  status: string;
  notes: string;
  notesPlaceholder: string;
  priorityLabels: Record<(typeof dispatchPriorityValues)[number], string>;
  statusLabels: Record<DispatchStatusValue, string>;
};

function getDispatchJobFormCopy(locale: string): DispatchJobFormCopy {
  if (locale.startsWith("es")) {
    return {
      clear: "Borrar",
      customer: "Cliente",
      customerOptional: "Opcional. Vincula un cliente existente.",
      customerPlaceholder: "Buscar clientes por nombre o teléfono",
      customerSearching: "Buscando clientes...",
      customerSearchError: "No se pudieron buscar clientes.",
      lead: "Lead",
      leadOptional: "Opcional. Vincula este trabajo con un lead.",
      leadPlaceholder: "Buscar leads por nombre, teléfono o tipo de trabajo",
      leadSearching: "Buscando leads...",
      leadSearchError: "No se pudieron buscar leads.",
      noExtraDetails: "Sin detalles extra",
      typeAtLeastTwo: "Escribe al menos 2 caracteres.",
      customerName: "Nombre del cliente",
      customerNamePlaceholder: "Residencia Rivera",
      phone: "Teléfono",
      serviceType: "Tipo de servicio",
      serviceTypePlaceholder: "Tratamiento de césped",
      address: "Dirección",
      addressPlaceholder: "123 Main St, Seattle, WA",
      scheduledDate: "Fecha programada",
      assignedCrew: "Cuadrilla asignada",
      unassigned: "Sin asignar",
      startTime: "Hora de inicio",
      endTime: "Hora de fin",
      priority: "Prioridad",
      none: "Ninguna",
      status: "Estado",
      notes: "Notas",
      notesPlaceholder: "Código de acceso, notas de entrada o recordatorios del alcance.",
      priorityLabels: {
        low: "Baja",
        medium: "Media",
        high: "Alta",
        urgent: "Urgente",
      },
      statusLabels: {
        scheduled: "Programado",
        on_the_way: "En camino",
        on_site: "En sitio",
        completed: "Completado",
        rescheduled: "Reprogramado",
        canceled: "Cancelado",
      },
    };
  }

  return {
    clear: "Clear",
    customer: "Customer",
    customerOptional: "Optional. Link an existing customer record.",
    customerPlaceholder: "Search customers by name or phone",
    customerSearching: "Searching customers...",
    customerSearchError: "Failed to search customers.",
    lead: "Lead",
    leadOptional: "Optional. Link the job back to a lead record.",
    leadPlaceholder: "Search leads by name, phone, or work type",
    leadSearching: "Searching leads...",
    leadSearchError: "Failed to search leads.",
    noExtraDetails: "No extra details",
    typeAtLeastTwo: "Type at least 2 characters.",
    customerName: "Customer name",
    customerNamePlaceholder: "Rivera Residence",
    phone: "Phone",
    serviceType: "Service type",
    serviceTypePlaceholder: "Lawn treatment",
    address: "Address",
    addressPlaceholder: "123 Main St, Seattle, WA",
    scheduledDate: "Scheduled date",
    assignedCrew: "Assigned crew",
    unassigned: "Unassigned",
    startTime: "Start time",
    endTime: "End time",
    priority: "Priority",
    none: "None",
    status: "Status",
    notes: "Notes",
    notesPlaceholder: "Gate code, access notes, or scope reminders.",
    priorityLabels: {
      low: "Low",
      medium: "Medium",
      high: "High",
      urgent: "Urgent",
    },
    statusLabels: {
      scheduled: "Scheduled",
      on_the_way: "On the way",
      on_site: "On site",
      completed: "Completed",
      rescheduled: "Rescheduled",
      canceled: "Canceled",
    },
  };
}

export function createDispatchJobFormState(date: string): DispatchJobFormState {
  return {
    customerId: "",
    customerLabel: "",
    leadId: "",
    leadLabel: "",
    customerName: "",
    phone: "",
    serviceType: "",
    address: "",
    scheduledDate: date,
    scheduledStartTime: "",
    scheduledEndTime: "",
    assignedCrewId: "",
    notes: "",
    priority: "",
    status: "scheduled",
  };
}

function createLookupQuery(query: string, orgId: string, internalUser: boolean): string {
  const params = new URLSearchParams({
    q: query,
  });
  if (internalUser) {
    params.set("orgId", orgId);
  }
  return params.toString();
}

function SelectedRecordChip(input: {
  label: string;
  clearLabel: string;
  onClear: () => void;
  disabled: boolean;
}) {
  return (
    <span className="dispatch-picker-chip">
      {input.label}
      <button type="button" className="dispatch-picker-clear" onClick={input.onClear} disabled={input.disabled}>
        {input.clearLabel}
      </button>
    </span>
  );
}

export default function DispatchJobForm({
  orgId,
  internalUser,
  form,
  crews,
  disabled = false,
  disableScheduleFields = false,
  disableStatusField = false,
  scheduleHint = null,
  includeStatus = false,
  submitLabel,
  submitBusyLabel,
  isSubmitting = false,
  secondaryActions,
  onChange,
  onSubmit,
}: DispatchJobFormProps) {
  const locale = useLocale();
  const copy = getDispatchJobFormCopy(locale);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<DispatchCustomerLookupItem[]>([]);
  const [customerLookupError, setCustomerLookupError] = useState<string | null>(null);
  const [customerLookupLoading, setCustomerLookupLoading] = useState(false);

  const [leadQuery, setLeadQuery] = useState("");
  const [leadResults, setLeadResults] = useState<DispatchLeadLookupItem[]>([]);
  const [leadLookupError, setLeadLookupError] = useState<string | null>(null);
  const [leadLookupLoading, setLeadLookupLoading] = useState(false);

  useEffect(() => {
    if (!customerQuery.trim()) {
      setCustomerResults([]);
      setCustomerLookupError(null);
      return;
    }
    if (customerQuery.trim().length < 2) {
      setCustomerResults([]);
      setCustomerLookupError(copy.typeAtLeastTwo);
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      setCustomerLookupLoading(true);
      setCustomerLookupError(null);
      try {
        const response = await fetch(`/api/dispatch/lookups?${createLookupQuery(customerQuery, orgId, internalUser)}`, {
          method: "GET",
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as LookupResponse;
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || copy.customerSearchError);
        }
        if (cancelled) return;
        setCustomerResults(payload.customers || []);
      } catch (error) {
        if (cancelled) return;
        setCustomerResults([]);
        setCustomerLookupError(error instanceof Error ? error.message : copy.customerSearchError);
      } finally {
        if (!cancelled) {
          setCustomerLookupLoading(false);
        }
      }
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [copy.customerSearchError, copy.typeAtLeastTwo, customerQuery, internalUser, orgId]);

  useEffect(() => {
    if (!leadQuery.trim()) {
      setLeadResults([]);
      setLeadLookupError(null);
      return;
    }
    if (leadQuery.trim().length < 2) {
      setLeadResults([]);
      setLeadLookupError(copy.typeAtLeastTwo);
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      setLeadLookupLoading(true);
      setLeadLookupError(null);
      try {
        const response = await fetch(`/api/dispatch/lookups?${createLookupQuery(leadQuery, orgId, internalUser)}`, {
          method: "GET",
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as LookupResponse;
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || copy.leadSearchError);
        }
        if (cancelled) return;
        setLeadResults(payload.leads || []);
      } catch (error) {
        if (cancelled) return;
        setLeadResults([]);
        setLeadLookupError(error instanceof Error ? error.message : copy.leadSearchError);
      } finally {
        if (!cancelled) {
          setLeadLookupLoading(false);
        }
      }
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [copy.leadSearchError, copy.typeAtLeastTwo, internalUser, leadQuery, orgId]);

  return (
    <form className="dispatch-job-form" onSubmit={onSubmit}>
      <div className="dispatch-form-grid dispatch-form-grid--records">
        <label className="dispatch-picker-field">
          {copy.customer}
          {form.customerId ? (
            <SelectedRecordChip
              label={form.customerLabel || form.customerName}
              clearLabel={copy.clear}
              onClear={() => onChange({ customerId: "", customerLabel: "" })}
              disabled={disabled}
            />
          ) : (
            <span className="muted">{copy.customerOptional}</span>
          )}
          <input
            value={customerQuery}
            onChange={(event) => setCustomerQuery(event.target.value)}
            placeholder={copy.customerPlaceholder}
            disabled={disabled}
          />
          {customerLookupLoading ? <span className="muted">{copy.customerSearching}</span> : null}
          {customerLookupError ? <span className="muted text-danger">{customerLookupError}</span> : null}
          {!customerLookupLoading && customerResults.length > 0 ? (
            <div className="dispatch-picker-results">
              {customerResults.map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  className="dispatch-picker-option"
                  onClick={() => {
                    onChange({
                      customerId: customer.id,
                      customerLabel: customer.name,
                      customerName: customer.name || form.customerName,
                      phone: customer.phone || form.phone,
                      address: customer.address || form.address,
                    });
                    setCustomerQuery("");
                    setCustomerResults([]);
                  }}
                  disabled={disabled}
                >
                  <strong>{customer.name}</strong>
                  <span className="muted">
                    {[customer.phone, customer.address].filter(Boolean).join(" · ") || copy.noExtraDetails}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </label>

        <label className="dispatch-picker-field">
          {copy.lead}
          {form.leadId ? (
            <SelectedRecordChip
              label={form.leadLabel || form.customerName}
              clearLabel={copy.clear}
              onClear={() => onChange({ leadId: "", leadLabel: "" })}
              disabled={disabled}
            />
          ) : (
            <span className="muted">{copy.leadOptional}</span>
          )}
          <input
            value={leadQuery}
            onChange={(event) => setLeadQuery(event.target.value)}
            placeholder={copy.leadPlaceholder}
            disabled={disabled}
          />
          {leadLookupLoading ? <span className="muted">{copy.leadSearching}</span> : null}
          {leadLookupError ? <span className="muted text-danger">{leadLookupError}</span> : null}
          {!leadLookupLoading && leadResults.length > 0 ? (
            <div className="dispatch-picker-results">
              {leadResults.map((lead) => (
                <button
                  key={lead.id}
                  type="button"
                  className="dispatch-picker-option"
                  onClick={() => {
                    onChange({
                      leadId: lead.id,
                      leadLabel: lead.label,
                      customerName: lead.label || form.customerName,
                      phone: lead.phone || form.phone,
                      serviceType: lead.serviceType || form.serviceType,
                      address: lead.address || form.address,
                      ...(lead.customerId
                        ? {
                            customerId: lead.customerId,
                            customerLabel: lead.customerName || form.customerLabel || lead.label,
                          }
                        : {}),
                    });
                    setLeadQuery("");
                    setLeadResults([]);
                  }}
                  disabled={disabled}
                >
                  <strong>{lead.label}</strong>
                  <span className="muted">
                    {[lead.serviceType, lead.phone, lead.address].filter(Boolean).join(" · ") || copy.noExtraDetails}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </label>
      </div>

      <div className="dispatch-form-grid">
        <label>
          {copy.customerName}
          <input
            value={form.customerName}
            onChange={(event) => onChange({ customerName: event.target.value })}
            placeholder={copy.customerNamePlaceholder}
            disabled={disabled}
            required
          />
        </label>

        <label>
          {copy.phone}
          <input
            value={form.phone}
            onChange={(event) => onChange({ phone: event.target.value })}
            placeholder="+12065550101"
            disabled={disabled}
          />
        </label>

        <label>
          {copy.serviceType}
          <input
            value={form.serviceType}
            onChange={(event) => onChange({ serviceType: event.target.value })}
            placeholder={copy.serviceTypePlaceholder}
            disabled={disabled}
            required
          />
        </label>

        <label>
          {copy.address}
          <input
            value={form.address}
            onChange={(event) => onChange({ address: event.target.value })}
            placeholder={copy.addressPlaceholder}
            disabled={disabled}
            required
          />
        </label>

        <label>
          {copy.scheduledDate}
          {scheduleHint ? <span className="muted">{scheduleHint}</span> : null}
          <input
            type="date"
            value={form.scheduledDate}
            onChange={(event) => onChange({ scheduledDate: event.target.value })}
            disabled={disabled || disableScheduleFields}
            required
          />
        </label>

        <label>
          {copy.assignedCrew}
          <select
            value={form.assignedCrewId}
            onChange={(event) => onChange({ assignedCrewId: event.target.value })}
            disabled={disabled}
          >
            <option value="">{copy.unassigned}</option>
            {crews.map((crew) => (
              <option key={crew.id} value={crew.id}>
                {crew.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          {copy.startTime}
          <input
            type="time"
            value={form.scheduledStartTime}
            onChange={(event) => onChange({ scheduledStartTime: event.target.value })}
            disabled={disabled || disableScheduleFields}
          />
        </label>

        <label>
          {copy.endTime}
          <input
            type="time"
            value={form.scheduledEndTime}
            onChange={(event) => onChange({ scheduledEndTime: event.target.value })}
            disabled={disabled || disableScheduleFields}
          />
        </label>

        <label>
          {copy.priority}
          <select
            value={form.priority}
            onChange={(event) => onChange({ priority: event.target.value })}
            disabled={disabled}
          >
            <option value="">{copy.none}</option>
            {dispatchPriorityValues.map((value) => (
              <option key={value} value={value}>
                {copy.priorityLabels[value]}
              </option>
            ))}
          </select>
        </label>

        {includeStatus ? (
          <label>
            {copy.status}
            <select
              value={form.status}
              onChange={(event) => onChange({ status: event.target.value as DispatchStatusValue })}
              disabled={disabled || disableStatusField}
            >
              {dispatchStatusValues.map((value) => (
                <option key={value} value={value}>
                  {copy.statusLabels[value]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <label>
        {copy.notes}
        <textarea
          value={form.notes}
          onChange={(event) => onChange({ notes: event.target.value })}
          placeholder={copy.notesPlaceholder}
          rows={4}
          disabled={disabled}
        />
      </label>

      <div className="dispatch-form-actions">
        {secondaryActions}
        <button className="btn primary" type="submit" disabled={disabled || isSubmitting}>
          {isSubmitting ? submitBusyLabel || submitLabel : submitLabel}
        </button>
      </div>
    </form>
  );
}
