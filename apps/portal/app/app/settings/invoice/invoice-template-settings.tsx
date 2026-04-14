"use client";

import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useRouter } from "next/navigation";
import InvoicePreview, { type InvoicePreviewData } from "../../_components/invoice-preview";
import InvoiceTemplateCard from "./invoice-template-card";
import type { InvoiceTemplate } from "@/lib/invoice-template";

type ToastState = {
  tone: "success" | "error";
  title: string;
  message: string;
} | null;

type InvoiceTemplateSettingsProps = {
  orgId: string;
  canManage: boolean;
  initialTemplate: InvoiceTemplate;
  previewInvoice: InvoicePreviewData;
};

function ClassicThumbnail() {
  return (
    <svg viewBox="0 0 220 140" aria-hidden="true">
      <rect x="0" y="0" width="220" height="140" rx="18" fill="#ffffff" />
      <rect x="18" y="18" width="48" height="18" rx="4" fill="#111827" />
      <rect x="18" y="48" width="88" height="8" rx="4" fill="#d1d5db" />
      <rect x="18" y="62" width="64" height="8" rx="4" fill="#e5e7eb" />
      <rect x="132" y="18" width="70" height="42" rx="10" fill="#f3f4f6" />
      <rect x="18" y="82" width="184" height="10" rx="5" fill="#111827" opacity="0.08" />
      <rect x="18" y="98" width="184" height="9" rx="4.5" fill="#111827" opacity="0.06" />
      <rect x="18" y="114" width="112" height="8" rx="4" fill="#111827" opacity="0.05" />
      <rect x="146" y="112" width="56" height="12" rx="6" fill="#111827" />
    </svg>
  );
}

function BoldThumbnail() {
  return (
    <svg viewBox="0 0 220 140" aria-hidden="true">
      <rect x="0" y="0" width="220" height="140" rx="18" fill="#111827" />
      <rect x="0" y="0" width="220" height="58" rx="18" fill="#1f2937" />
      <rect x="18" y="16" width="54" height="12" rx="6" fill="#f97316" />
      <rect x="18" y="34" width="130" height="12" rx="6" fill="#ffffff" />
      <rect x="152" y="18" width="50" height="26" rx="13" fill="#f97316" />
      <rect x="18" y="74" width="90" height="8" rx="4" fill="#9ca3af" />
      <rect x="18" y="88" width="184" height="9" rx="4.5" fill="#ffffff" opacity="0.08" />
      <rect x="18" y="104" width="184" height="9" rx="4.5" fill="#ffffff" opacity="0.08" />
      <rect x="128" y="118" width="74" height="10" rx="5" fill="#f97316" />
    </svg>
  );
}

function MinimalThumbnail() {
  return (
    <svg viewBox="0 0 220 140" aria-hidden="true">
      <rect x="0" y="0" width="220" height="140" rx="18" fill="#fafafa" />
      <rect x="18" y="18" width="92" height="10" rx="5" fill="#6b7280" />
      <rect x="18" y="36" width="62" height="6" rx="3" fill="#d1d5db" />
      <rect x="144" y="20" width="58" height="32" rx="12" fill="#f3f4f6" />
      <line x1="18" y1="68" x2="202" y2="68" stroke="#e5e7eb" strokeWidth="3" />
      <line x1="18" y1="90" x2="202" y2="90" stroke="#f3f4f6" strokeWidth="8" />
      <line x1="18" y1="106" x2="202" y2="106" stroke="#f3f4f6" strokeWidth="8" />
      <rect x="148" y="118" width="54" height="8" rx="4" fill="#9ca3af" />
    </svg>
  );
}

const templateCards: Array<{
  key: InvoiceTemplate;
  name: string;
  description: string;
  previewImage: JSX.Element;
}> = [
  {
    key: "classic",
    name: "Classic",
    description: "Clean black, white, and gray layout for general contractor invoices.",
    previewImage: <ClassicThumbnail />,
  },
  {
    key: "bold",
    name: "Bold",
    description: "Dark header, accent color, and a stronger total-first presentation for trades.",
    previewImage: <BoldThumbnail />,
  },
  {
    key: "minimal",
    name: "Minimal",
    description: "Ultra-clean compact layout with soft gray accents for smaller crews and operators.",
    previewImage: <MinimalThumbnail />,
  },
];

export default function InvoiceTemplateSettings({
  orgId,
  canManage,
  initialTemplate,
  previewInvoice,
}: InvoiceTemplateSettingsProps) {
  const router = useRouter();
  const [selectedTemplate, setSelectedTemplate] = useState<InvoiceTemplate>(initialTemplate);
  const [savedTemplate, setSavedTemplate] = useState<InvoiceTemplate>(initialTemplate);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);

  useEffect(() => {
    setSelectedTemplate(initialTemplate);
    setSavedTemplate(initialTemplate);
  }, [initialTemplate]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), toast.tone === "error" ? 7000 : 4200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  async function handleSave() {
    if (!canManage || saving || selectedTemplate === savedTemplate) {
      return;
    }

    setSaving(true);
    setToast(null);

    try {
      const response = await fetch("/api/settings/invoice-template", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          orgId,
          template: selectedTemplate,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
            template?: InvoiceTemplate;
          }
        | null;

      if (!response.ok || !payload?.ok || !payload.template) {
        throw new Error(payload?.error || "Could not save invoice template preference.");
      }

      setSavedTemplate(payload.template);
      setSelectedTemplate(payload.template);
      setToast({
        tone: "success",
        title: "Saved",
        message: "Invoice template preference updated.",
      });
      router.refresh();
    } catch (error) {
      setToast({
        tone: "error",
        title: "Save failed",
        message: error instanceof Error ? error.message : "Could not save invoice template preference.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="invoice-template-settings">
      <section className="invoice-template-settings__selector card">
        <div className="invoice-header-row">
          <div className="stack-cell">
            <h2>Invoice Style</h2>
            <p className="muted">Choose the default template your team uses when opening invoice previews and printing PDFs.</p>
          </div>
          <div className="quick-links">
            <button
              className="btn primary"
              type="button"
              onClick={() => void handleSave()}
              disabled={!canManage || saving || selectedTemplate === savedTemplate}
            >
              {saving ? "Saving..." : "Save Preference"}
            </button>
          </div>
        </div>

        {!canManage ? (
          <p className="form-status" style={{ marginTop: 12 }}>
            Read-only users can preview the current invoice style, but only owners and admins can change it.
          </p>
        ) : null}

        <div className="invoice-template-settings__grid">
          {templateCards.map((card) => (
            <InvoiceTemplateCard
              key={card.key}
              name={card.name}
              description={card.description}
              previewImage={card.previewImage}
              isSelected={selectedTemplate === card.key}
              onSelect={() => setSelectedTemplate(card.key)}
            />
          ))}
        </div>
      </section>

      <section className="card invoice-template-settings__preview-card">
        <div className="invoice-header-row">
          <div className="stack-cell">
            <h2>Live Preview</h2>
            <p className="muted">This sample uses your saved branding and the currently selected layout.</p>
          </div>
        </div>

        <div className="invoice-template-settings__preview-wrap">
          <InvoicePreview template={selectedTemplate} invoice={previewInvoice} />
        </div>
      </section>

      {toast ? (
        <aside className={`portal-action-feedback ${toast.tone}`} role={toast.tone === "error" ? "alert" : "status"}>
          <div className="portal-action-feedback-copy">
            <strong>{toast.title}</strong>
            <p>{toast.message}</p>
          </div>
          <button type="button" className="portal-action-feedback-close" onClick={() => setToast(null)} aria-label="Dismiss">
            ×
          </button>
        </aside>
      ) : null}
    </div>
  );
}
