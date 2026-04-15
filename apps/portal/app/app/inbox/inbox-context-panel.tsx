"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useLocale } from "next-intl";
import { formatLabel } from "@/lib/hq";
import { sanitizeLeadBusinessTypeLabel } from "@/lib/lead-display";
import {
  formatRevenueInputCents,
  fromDateTimeLocalInputValue,
  parseRevenueInputToCents,
  toDateTimeLocalInputValue,
} from "@/lib/inbox-ui";

const LEAD_STATUS_OPTIONS = [
  "NEW",
  "CALLED_NO_ANSWER",
  "VOICEMAIL",
  "INTERESTED",
  "FOLLOW_UP",
  "BOOKED",
  "NOT_INTERESTED",
  "DNC",
] as const;

const LEAD_PRIORITY_OPTIONS = ["HIGH", "MEDIUM", "LOW"] as const;

export type InboxLeadContext = {
  id: string;
  orgId: string;
  contactName: string | null;
  businessName: string | null;
  phoneE164: string;
  city: string | null;
  businessType: string | null;
  status: string;
  priority: string;
  nextFollowUpAt: string | null;
  estimatedRevenueCents: number | null;
  notes: string | null;
  customer:
    | {
        id: string;
        name: string;
        email: string | null;
        addressLine: string | null;
      }
    | null;
};

type InboxLeadUpdate = {
  id: string;
  contactName: string | null;
  businessName: string | null;
  phoneE164: string;
  city: string | null;
  businessType: string | null;
  status: string;
  priority: string;
  notes: string | null;
  nextFollowUpAt: string | null;
  estimatedRevenueCents: number | null;
};

type InboxContextPanelProps = {
  leadContext: InboxLeadContext | null;
  canManage: boolean;
  jobHref: string;
  calendarHref: string;
  initialEditing?: boolean;
  onSaved: (nextLead: InboxLeadContext) => void;
};

type ContextFormState = {
  contactName: string;
  businessName: string;
  phone: string;
  city: string;
  businessType: string;
  status: string;
  priority: string;
  nextFollowUpAt: string;
  estimatedRevenue: string;
  notes: string;
};

type LeadPatchResponse =
  | {
      ok?: boolean;
      error?: string;
      lead?: InboxLeadUpdate;
    }
  | null;

type InboxContextCopy = {
  selectConversation: string;
  estimatedValueInvalid: string;
  followUpInvalid: string;
  updateError: string;
  saved: string;
  overdue: string;
  workType: string;
  followUp: string;
  estimatedValue: string;
  customer: string;
  notes: string;
  openJob: string;
  calendar: string;
  closeEdit: string;
  editContext: string;
  contactName: string;
  businessName: string;
  phone: string;
  city: string;
  status: string;
  priority: string;
  saveContext: string;
  cancel: string;
};

function updateFormField<K extends keyof ContextFormState>(
  setForm: Dispatch<SetStateAction<ContextFormState>>,
  field: K,
  value: ContextFormState[K],
) {
  setForm((current) => ({ ...current, [field]: value }));
}

function getInboxContextCopy(locale: string): InboxContextCopy {
  if (locale.startsWith("es")) {
    return {
      selectConversation: "Selecciona una conversacion para ver detalles.",
      estimatedValueInvalid: "El valor estimado debe ser una cantidad valida en dolares.",
      followUpInvalid: "El seguimiento debe ser una fecha y hora validas.",
      updateError: "No se pudo actualizar esta conversacion.",
      saved: "Contexto guardado.",
      overdue: "Vencido",
      workType: "Tipo de trabajo",
      followUp: "Seguimiento",
      estimatedValue: "Valor estimado",
      customer: "Cliente",
      notes: "Notas",
      openJob: "Abrir lead",
      calendar: "Calendario",
      closeEdit: "Cerrar edicion",
      editContext: "Editar contexto",
      contactName: "Nombre de contacto",
      businessName: "Nombre del negocio",
      phone: "Telefono",
      city: "Ciudad",
      status: "Estado",
      priority: "Prioridad",
      saveContext: "Guardar contexto",
      cancel: "Cancelar",
    };
  }

  return {
    selectConversation: "Select a conversation to see details.",
    estimatedValueInvalid: "Estimated value must be a valid dollar amount.",
    followUpInvalid: "Follow-up must be a valid date and time.",
    updateError: "Could not update this conversation.",
    saved: "Context saved.",
    overdue: "Overdue",
    workType: "Work type",
    followUp: "Follow-up",
    estimatedValue: "Estimated value",
    customer: "Customer",
    notes: "Notes",
    openJob: "Open lead",
    calendar: "Calendar",
    closeEdit: "Close Edit",
    editContext: "Edit Context",
    contactName: "Contact name",
    businessName: "Business name",
    phone: "Phone",
    city: "City",
    status: "Status",
    priority: "Priority",
    saveContext: "Save Context",
    cancel: "Cancel",
  };
}

function createEmptyFormState(): ContextFormState {
  return {
    contactName: "",
    businessName: "",
    phone: "",
    city: "",
    businessType: "",
    status: "NEW",
    priority: "MEDIUM",
    nextFollowUpAt: "",
    estimatedRevenue: "",
    notes: "",
  };
}

function buildFormState(leadContext: InboxLeadContext | null): ContextFormState {
  if (!leadContext) {
    return createEmptyFormState();
  }

  return {
    contactName: leadContext.contactName || "",
    businessName: leadContext.businessName || "",
    phone: leadContext.phoneE164 || "",
    city: leadContext.city || "",
    businessType: sanitizeLeadBusinessTypeLabel(leadContext.businessType) || "",
    status: leadContext.status || "NEW",
    priority: leadContext.priority || "MEDIUM",
    nextFollowUpAt: toDateTimeLocalInputValue(leadContext.nextFollowUpAt),
    estimatedRevenue: formatRevenueInputCents(leadContext.estimatedRevenueCents),
    notes: leadContext.notes || "",
  };
}

export default function InboxContextPanel({
  leadContext,
  canManage,
  jobHref,
  calendarHref,
  initialEditing = false,
  onSaved,
}: InboxContextPanelProps) {
  const locale = useLocale();
  const copy = getInboxContextCopy(locale);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ContextFormState>(createEmptyFormState);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const appliedInitialEditingRef = useRef(false);

  useEffect(() => {
    if (editing) return;
    setForm(buildFormState(leadContext));
  }, [editing, leadContext]);

  useEffect(() => {
    if (!initialEditing || appliedInitialEditingRef.current || !leadContext || !canManage) {
      return;
    }

    appliedInitialEditingRef.current = true;
    setEditing(true);
    setError(null);
    setNotice(null);
  }, [initialEditing, leadContext, canManage]);

  if (!leadContext) {
    return <p className="muted">{copy.selectConversation}</p>;
  }

  const currentLeadContext = leadContext;

  async function handleSave() {
    if (!canManage || saving) return;

    const estimatedRevenueCents = parseRevenueInputToCents(form.estimatedRevenue);
    if (Number.isNaN(estimatedRevenueCents)) {
      setError(copy.estimatedValueInvalid);
      return;
    }

    const nextFollowUpAt = fromDateTimeLocalInputValue(form.nextFollowUpAt);
    if (form.nextFollowUpAt.trim() && !nextFollowUpAt) {
      setError(copy.followUpInvalid);
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/leads/${currentLeadContext.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          contactName: form.contactName || null,
          businessName: form.businessName || null,
          phone: form.phone || null,
          city: form.city || null,
          businessType: form.businessType || null,
          status: form.status,
          priority: form.priority,
          nextFollowUpAt,
          estimatedRevenueCents,
          notes: form.notes || null,
        }),
      });

      const payload = (await response.json().catch(() => null)) as LeadPatchResponse;
      if (!response.ok || !payload?.ok || !payload.lead) {
        throw new Error(payload?.error || copy.updateError);
      }

      onSaved({
        ...currentLeadContext,
        contactName: payload.lead.contactName || null,
        businessName: payload.lead.businessName || null,
        phoneE164: payload.lead.phoneE164,
        city: payload.lead.city || null,
        businessType: payload.lead.businessType || null,
        status: payload.lead.status,
        priority: payload.lead.priority,
        nextFollowUpAt: payload.lead.nextFollowUpAt,
        estimatedRevenueCents: payload.lead.estimatedRevenueCents,
        notes: payload.lead.notes || null,
      });

      setEditing(false);
      setNotice(copy.saved);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : copy.updateError);
    } finally {
      setSaving(false);
    }
  }

  const leadTitle =
    currentLeadContext.contactName?.trim() ||
    currentLeadContext.businessName?.trim() ||
    currentLeadContext.customer?.name?.trim() ||
    currentLeadContext.phoneE164;
  const displayBusinessType = sanitizeLeadBusinessTypeLabel(currentLeadContext.businessType);

  return (
    <div className="stack-cell">
      <div className="stack-cell">
        <strong>{leadTitle}</strong>
        {currentLeadContext.businessName && currentLeadContext.businessName !== leadTitle ? (
          <span className="muted">{currentLeadContext.businessName}</span>
        ) : null}
        <span className="muted">{currentLeadContext.phoneE164}</span>
        {currentLeadContext.city ? <span className="muted">{currentLeadContext.city}</span> : null}
      </div>

      <div className="quick-meta">
        <span className={`badge status-${currentLeadContext.status.toLowerCase()}`}>{formatLabel(currentLeadContext.status)}</span>
        <span className={`badge priority-${currentLeadContext.priority.toLowerCase()}`}>{formatLabel(currentLeadContext.priority)}</span>
        {currentLeadContext.nextFollowUpAt && new Date(currentLeadContext.nextFollowUpAt).getTime() < Date.now() ? (
          <span className="badge status-overdue">{copy.overdue}</span>
        ) : null}
      </div>

      {displayBusinessType ? (
        <div className="stack-cell">
          <span className="muted">{copy.workType}</span>
          <span>{displayBusinessType}</span>
        </div>
      ) : null}

      {currentLeadContext.nextFollowUpAt ? (
        <div className="stack-cell">
          <span className="muted">{copy.followUp}</span>
          <span>{new Date(currentLeadContext.nextFollowUpAt).toLocaleString()}</span>
        </div>
      ) : null}

      {currentLeadContext.estimatedRevenueCents !== null ? (
        <div className="stack-cell">
          <span className="muted">{copy.estimatedValue}</span>
          <span>${(currentLeadContext.estimatedRevenueCents / 100).toFixed(0)}</span>
        </div>
      ) : null}

      {currentLeadContext.customer ? (
        <div className="stack-cell">
          <span className="muted">{copy.customer}</span>
          <span>{currentLeadContext.customer.name}</span>
          {currentLeadContext.customer.email ? <span className="muted">{currentLeadContext.customer.email}</span> : null}
          {currentLeadContext.customer.addressLine ? <span className="muted">{currentLeadContext.customer.addressLine}</span> : null}
        </div>
      ) : null}

      {currentLeadContext.notes ? (
        <div className="stack-cell">
          <span className="muted">{copy.notes}</span>
          <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{currentLeadContext.notes}</p>
        </div>
      ) : null}

      <div className="portal-empty-actions" style={{ justifyContent: "flex-start" }}>
        <Link className="btn secondary" href={jobHref}>
          {copy.openJob}
        </Link>
        <Link className="btn secondary" href={calendarHref}>
          {copy.calendar}
        </Link>
        {canManage ? (
          <button
            className="btn secondary"
            type="button"
            onClick={() => {
              setEditing((current) => {
                const next = !current;
                if (!next) {
                  setForm(buildFormState(currentLeadContext));
                }
                setError(null);
                setNotice(null);
                return next;
              });
            }}
          >
            {editing ? copy.closeEdit : copy.editContext}
          </button>
        ) : null}
      </div>

      {editing ? (
        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSave();
          }}
        >
          <div className="grid two-col">
            <label>
              {copy.contactName}
              <input
                value={form.contactName}
                onChange={(event) => updateFormField(setForm, "contactName", event.currentTarget.value)}
                maxLength={160}
              />
            </label>

            <label>
              {copy.businessName}
              <input
                value={form.businessName}
                onChange={(event) => updateFormField(setForm, "businessName", event.currentTarget.value)}
                maxLength={160}
              />
            </label>
          </div>

          <div className="grid two-col">
            <label>
              {copy.phone}
              <input
                value={form.phone}
                onChange={(event) => updateFormField(setForm, "phone", event.currentTarget.value)}
                placeholder="+12065551212"
                maxLength={20}
              />
            </label>

            <label>
              {copy.city}
              <input
                value={form.city}
                onChange={(event) => updateFormField(setForm, "city", event.currentTarget.value)}
                maxLength={120}
              />
            </label>
          </div>

          <div className="grid two-col">
            <label>
              {copy.status}
              <select
                value={form.status}
                onChange={(event) => updateFormField(setForm, "status", event.currentTarget.value)}
              >
                {LEAD_STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {formatLabel(status)}
                  </option>
                ))}
              </select>
            </label>

            <label>
              {copy.priority}
              <select
                value={form.priority}
                onChange={(event) => updateFormField(setForm, "priority", event.currentTarget.value)}
              >
                {LEAD_PRIORITY_OPTIONS.map((priority) => (
                  <option key={priority} value={priority}>
                    {formatLabel(priority)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid two-col">
            <label>
              {copy.followUp}
              <input
                type="datetime-local"
                value={form.nextFollowUpAt}
                onChange={(event) => updateFormField(setForm, "nextFollowUpAt", event.currentTarget.value)}
              />
            </label>

            <label>
              {copy.estimatedValue}
              <input
                value={form.estimatedRevenue}
                onChange={(event) => updateFormField(setForm, "estimatedRevenue", event.currentTarget.value)}
                placeholder="4200"
              />
            </label>
          </div>

          <label>
            {copy.workType}
            <input
              value={form.businessType}
              onChange={(event) => updateFormField(setForm, "businessType", event.currentTarget.value)}
              maxLength={160}
            />
          </label>

          <label>
            {copy.notes}
            <textarea
              value={form.notes}
              onChange={(event) => updateFormField(setForm, "notes", event.currentTarget.value)}
              rows={4}
              maxLength={4000}
            />
          </label>

          <div className="message-compose-actions">
            <button className="btn primary" type="submit" disabled={saving}>
              {saving ? "Saving..." : copy.saveContext}
            </button>
            <button
              className="btn secondary"
              type="button"
              disabled={saving}
              onClick={() => {
                setForm(buildFormState(currentLeadContext));
                setEditing(false);
                setError(null);
                setNotice(null);
              }}
            >
              {copy.cancel}
            </button>
          </div>
        </form>
      ) : null}

      {notice ? <p className="form-status">{notice}</p> : null}
      {error ? <p className="form-status">{error}</p> : null}
    </div>
  );
}
