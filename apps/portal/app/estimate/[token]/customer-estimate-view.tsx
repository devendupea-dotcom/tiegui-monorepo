"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatEstimateCurrency, formatEstimateStatusLabel } from "@/lib/estimates";
import type { CustomerEstimateShareDetail, CustomerEstimateShareLineItem } from "@/lib/estimate-share";

type CustomerEstimateViewProps = {
  token: string;
  initialEstimate: CustomerEstimateShareDetail | null;
  initialError: string | null;
};

type ShareResponse =
  | {
      ok?: boolean;
      estimate?: CustomerEstimateShareDetail;
      error?: string;
    }
  | null;

type ScopeSection = {
  id: "LABOR" | "MATERIALS" | "OTHER";
  title: string;
  eyebrow: string;
  description: string;
  total: number;
  items: CustomerEstimateShareLineItem[];
};

function formatReadableDate(value: string | null): string {
  if (!value) return "Open";
  return new Date(value).toLocaleDateString();
}

function buildScopeSections(lineItems: CustomerEstimateShareLineItem[]): ScopeSection[] {
  const labor = lineItems.filter((line) => line.type === "LABOR");
  const materials = lineItems.filter((line) => line.type === "MATERIAL");
  const other = lineItems.filter((line) => line.type !== "LABOR" && line.type !== "MATERIAL");

  const sections: ScopeSection[] = [
    {
      id: "LABOR",
      title: "Labor",
      eyebrow: "Work included",
      description: "The hands-on work required to complete the project.",
      total: labor.reduce((sum, line) => sum + line.total, 0),
      items: labor,
    },
    {
      id: "MATERIALS",
      title: "Materials",
      eyebrow: "Included materials",
      description: "Products, supplies, and installed materials included in this estimate.",
      total: materials.reduce((sum, line) => sum + line.total, 0),
      items: materials,
    },
    {
      id: "OTHER",
      title: "Other scope",
      eyebrow: "Custom work",
      description: "Special items, custom work, or bundled scope unique to this project.",
      total: other.reduce((sum, line) => sum + line.total, 0),
      items: other,
    },
  ];

  return sections.filter((section) => section.items.length > 0);
}

function joinReadableList(values: string[]): string {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0] || "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function buildIncludedSummary(sections: ScopeSection[]): string {
  const labels: string[] = [];
  if (sections.some((section) => section.id === "LABOR")) labels.push("labor");
  if (sections.some((section) => section.id === "MATERIALS")) labels.push("materials");
  if (sections.some((section) => section.id === "OTHER")) labels.push("custom scope");
  if (labels.length === 0) return "the listed scope";
  return joinReadableList(labels);
}

function buildValueBullets(estimate: CustomerEstimateShareDetail, sections: ScopeSection[]): string[] {
  const includedSummary = buildIncludedSummary(sections);
  const contactDetail = estimate.branding.phone || estimate.branding.email || estimate.branding.website || "";

  const bullets = [
    estimate.validUntil
      ? `Pricing is valid through ${formatReadableDate(estimate.validUntil)}.`
      : "Review the scope and move forward when you're ready.",
    `Includes ${includedSummary} with the full scope listed below.`,
    `Approve online and ${estimate.branding.name} will follow up to confirm scheduling and next steps.`,
    contactDetail ? `Questions? Reach ${estimate.branding.name} at ${contactDetail}.` : `Prepared by ${estimate.branding.name}.`,
  ].filter(Boolean);

  return bullets.slice(0, 4);
}

function buildDecisionSupportLine(estimate: CustomerEstimateShareDetail, sections: ScopeSection[]): string {
  const includedSummary = buildIncludedSummary(sections);
  return `Includes ${includedSummary} shown below so you can review the full investment with confidence.`;
}

export default function CustomerEstimateView({
  token,
  initialEstimate,
  initialError,
}: CustomerEstimateViewProps) {
  const [estimate, setEstimate] = useState<CustomerEstimateShareDetail | null>(initialEstimate);
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState(initialEstimate?.customerDecisionName || initialEstimate?.customerName || "");
  const [decisionNote, setDecisionNote] = useState(initialEstimate?.customerDecisionNote || "");
  const [submitting, setSubmitting] = useState<"approve" | "decline" | null>(null);
  const viewRecorded = useRef(false);

  const scopeSections = useMemo(() => buildScopeSections(estimate?.lineItems || []), [estimate?.lineItems]);
  const valueBullets = useMemo(
    () => (estimate ? buildValueBullets(estimate, scopeSections) : []),
    [estimate, scopeSections],
  );

  useEffect(() => {
    if (!estimate || viewRecorded.current) return;
    viewRecorded.current = true;

    void (async () => {
      try {
        const response = await fetch(`/api/estimate-share/${token}/view`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
        });
        const payload = (await response.json().catch(() => null)) as ShareResponse;
        if (!response.ok || !payload?.ok || !payload.estimate) {
          throw new Error(payload?.error || "Failed to record estimate view.");
        }
        setEstimate(payload.estimate);
      } catch (viewError) {
        setError(viewError instanceof Error ? viewError.message : "Failed to record estimate view.");
      }
    })();
  }, [estimate, token]);

  async function submitDecision(nextAction: "approve" | "decline") {
    if (!estimate?.canRespond) return;

    setSubmitting(nextAction);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/estimate-share/${token}/${nextAction}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          customerName,
          note: decisionNote,
        }),
      });
      const payload = (await response.json().catch(() => null)) as ShareResponse;
      if (!response.ok || !payload?.ok || !payload.estimate) {
        throw new Error(payload?.error || `Failed to ${nextAction} estimate.`);
      }

      setEstimate(payload.estimate);
      setNotice(
        nextAction === "approve"
          ? `Approval recorded. ${payload.estimate.branding.name} will follow up with scheduling and next steps.`
          : `Request recorded. ${payload.estimate.branding.name} can review your note and send back an updated estimate.`,
      );
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : `Failed to ${nextAction} estimate.`);
    } finally {
      setSubmitting(null);
    }
  }

  const outcomeMessage =
    estimate?.status === "APPROVED"
      ? "Approved"
      : estimate?.status === "DECLINED"
        ? "Request received"
        : estimate?.status === "EXPIRED" || estimate?.shareState === "EXPIRED"
          ? "Expired"
          : estimate?.shareState === "REVOKED"
            ? "Link revoked"
            : null;
  const displayStatusLabel =
    estimate?.status === "DECLINED"
      ? "Revision Requested"
      : estimate
        ? formatEstimateStatusLabel(estimate.status)
        : "";

  return (
    <main className="estimate-share-page">
      <section className="card estimate-share-card">
        {!estimate ? (
          <div className="portal-empty-state estimate-share-empty">
            <strong>Estimate unavailable</strong>
            <p className="muted">{error || "This estimate link is invalid, expired, or has been revoked."}</p>
          </div>
        ) : (
          <>
            <header className="estimate-sales-hero">
              <div className="estimate-sales-main">
                <div className="estimate-share-brand">
                  {estimate.branding.logoUrl ? (
                    <Image
                      src={estimate.branding.logoUrl}
                      alt={`${estimate.branding.name} logo`}
                      className="estimate-share-logo"
                      width={72}
                      height={72}
                      unoptimized
                      loader={({ src }) => src}
                    />
                  ) : null}
                  <div className="stack-cell">
                    <span className="estimate-share-eyebrow">Estimate for {estimate.customerName || "Customer"}</span>
                    <h1>{estimate.title}</h1>
                    <p className="estimate-sales-summary-copy">
                      {estimate.description || "Review the scope, investment, and next steps below to move this project forward."}
                    </p>
                  </div>
                </div>

                <div className="estimate-sales-context">
                  <span className="badge">{estimate.estimateNumber}</span>
                  {estimate.projectType ? <span className="badge">{estimate.projectType}</span> : null}
                  {estimate.siteAddress ? <span className="badge">{estimate.siteAddress}</span> : null}
                </div>

                <div className="estimate-sales-trust">
                  <strong>{estimate.branding.legalName || estimate.branding.name}</strong>
                  {estimate.branding.phone ? <span>{estimate.branding.phone}</span> : null}
                  {estimate.branding.email ? <span>{estimate.branding.email}</span> : null}
                  {estimate.branding.website ? <span>{estimate.branding.website}</span> : null}
                </div>

                {valueBullets.length > 0 ? (
                  <ul className="estimate-sales-bullets">
                    {valueBullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <aside className="estimate-sales-decision-card">
                <div className="estimate-sales-decision-header">
                  <span className="estimate-share-eyebrow">Total Investment</span>
                  <span className="badge">{displayStatusLabel}</span>
                </div>
                <strong className="estimate-sales-decision-total">{formatEstimateCurrency(estimate.total)}</strong>
                <p className="estimate-sales-reassurance">{buildDecisionSupportLine(estimate, scopeSections)}</p>
                <div className="estimate-sales-decision-meta">
                  <div>
                    <span className="muted">Valid through</span>
                    <strong>{formatReadableDate(estimate.validUntil)}</strong>
                  </div>
                  <div>
                    <span className="muted">Prepared by</span>
                    <strong>{estimate.branding.name}</strong>
                  </div>
                </div>
                {estimate.canRespond ? (
                  <div className="estimate-sales-decision-actions">
                    <a className="btn primary" href="#estimate-approval">
                      Approve Estimate
                    </a>
                    <a className="btn secondary" href="#estimate-approval">
                      Request Changes
                    </a>
                  </div>
                ) : (
                  <div className="estimate-sales-outcome-card">
                    <strong>{outcomeMessage || "Response recorded"}</strong>
                    <p className="muted">
                      {estimate.status === "APPROVED"
                        ? `${estimate.branding.name} will follow up with scheduling and next steps.`
                        : estimate.status === "DECLINED"
                          ? `${estimate.branding.name} can review your note and send an updated estimate if needed.`
                          : "Contact the contractor directly if you need an updated estimate or next-step help."}
                    </p>
                  </div>
                )}
              </aside>
            </header>

            {estimate.canRespond ? (
              <div className="estimate-sales-sticky-actions">
                <a className="btn primary" href="#estimate-approval">
                  Approve
                </a>
                <a className="btn secondary" href="#estimate-approval">
                  Request Changes
                </a>
              </div>
            ) : null}

            {notice ? <p className="form-status">{notice}</p> : null}
            {error ? <p className="form-status">{error}</p> : null}

            <section className="estimate-share-section">
              <div className="estimate-sales-section-header">
                <div className="stack-cell">
                  <h2>What’s included</h2>
                  <p className="muted">Everything below is part of this estimate so you can review the scope quickly on any device.</p>
                </div>
              </div>

              <div className="estimate-scope-sections">
                {scopeSections.map((section) => (
                  <article key={section.id} className="estimate-scope-card">
                    <div className="estimate-scope-card-header">
                      <div className="stack-cell">
                        <span className="estimate-share-eyebrow">{section.eyebrow}</span>
                        <h3>{section.title}</h3>
                        <p className="muted">{section.description}</p>
                      </div>
                      <div className="estimate-scope-card-total">
                        <span className="muted">Section total</span>
                        <strong>{formatEstimateCurrency(section.total)}</strong>
                      </div>
                    </div>

                    <div className="estimate-scope-items">
                      {section.items.map((line) => (
                        <div key={line.id} className="estimate-scope-item">
                          <div className="estimate-scope-item-main">
                            <strong>{line.name}</strong>
                            {line.description ? <p>{line.description}</p> : null}
                            <div className="estimate-scope-item-meta">
                              <span>
                                {line.quantity}
                                {line.unit ? ` ${line.unit}` : ""}
                              </span>
                              <span>{formatEstimateCurrency(line.unitPrice)} each</span>
                            </div>
                          </div>
                          <div className="estimate-scope-item-price">
                            <span className="muted">Included</span>
                            <strong>{formatEstimateCurrency(line.total)}</strong>
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="estimate-share-section">
              <div className="estimate-sales-investment-grid">
                <article className="card estimate-sales-investment-card">
                  <span className="estimate-share-eyebrow">Investment summary</span>
                  <div className="estimate-sales-investment-row">
                    <span>Subtotal</span>
                    <strong>{formatEstimateCurrency(estimate.subtotal)}</strong>
                  </div>
                  <div className="estimate-sales-investment-row">
                    <span>Tax</span>
                    <strong>{formatEstimateCurrency(estimate.tax)}</strong>
                  </div>
                  <div className="estimate-sales-investment-row estimate-sales-investment-row--total">
                    <span>Total</span>
                    <strong>{formatEstimateCurrency(estimate.total)}</strong>
                  </div>
                  <p className="muted estimate-sales-investment-note">
                    This investment includes the labor, materials, and scope shown above for straightforward review.
                  </p>
                </article>

                <article className="card estimate-sales-investment-card">
                  <span className="estimate-share-eyebrow">What happens next</span>
                  <div className="stack-cell" style={{ gap: 10 }}>
                    <div className="estimate-sales-step">
                      <strong>1. Review and approve</strong>
                      <span className="muted">Confirm the scope and investment online.</span>
                    </div>
                    <div className="estimate-sales-step">
                      <strong>2. Contractor follows up</strong>
                      <span className="muted">{estimate.branding.name} will reach out to confirm details and next steps.</span>
                    </div>
                    <div className="estimate-sales-step">
                      <strong>3. Scheduling gets finalized</strong>
                      <span className="muted">Scheduling is confirmed directly with the contractor after approval.</span>
                    </div>
                  </div>
                </article>
              </div>
            </section>

            {estimate.terms ? (
              <section className="estimate-share-section">
                <div className="estimate-sales-section-header">
                  <div className="stack-cell">
                    <h2>Important details</h2>
                    <p className="muted">A few final details from your contractor before you approve.</p>
                  </div>
                </div>
                <div className="estimate-share-panel estimate-sales-terms-panel" style={{ whiteSpace: "pre-wrap" }}>
                  {estimate.terms}
                </div>
              </section>
            ) : null}

            <section className="estimate-share-section" id="estimate-approval">
              <div className="estimate-sales-section-header">
                <div className="stack-cell">
                  <h2>Approve or request changes</h2>
                  <p className="muted">
                    Approve this estimate to move the project forward. If you want something adjusted first, leave a note and request changes.
                  </p>
                </div>
              </div>

              {estimate.canRespond ? (
                <form className="auth-form estimate-share-form estimate-sales-approval-form" onSubmit={(event) => event.preventDefault()}>
                  <div className="grid two-col">
                    <label>
                      Your name
                      <input
                        value={customerName}
                        onChange={(event) => setCustomerName(event.currentTarget.value)}
                        placeholder="Name"
                      />
                    </label>
                    <label>
                      Estimate
                      <input value={`${estimate.estimateNumber} · ${displayStatusLabel}`} disabled />
                    </label>
                  </div>

                  <label>
                    Questions or requested changes
                    <textarea
                      rows={4}
                      value={decisionNote}
                      onChange={(event) => setDecisionNote(event.currentTarget.value)}
                      placeholder="Optional note for the contractor, scheduling detail, or revision request."
                    />
                  </label>

                  <div className="estimate-sales-approval-actions">
                    <button
                      className="btn primary"
                      type="button"
                      disabled={submitting !== null}
                      onClick={() => void submitDecision("approve")}
                    >
                      {submitting === "approve" ? "Approving..." : "Approve Estimate"}
                    </button>
                    <button
                      className="btn secondary"
                      type="button"
                      disabled={submitting !== null}
                      onClick={() => void submitDecision("decline")}
                    >
                      {submitting === "decline" ? "Sending..." : "Request Changes"}
                    </button>
                  </div>

                  <p className="muted estimate-sales-approval-note">
                    Approval tells {estimate.branding.name} you’re ready for follow-up and scheduling. Requesting changes sends your note back so the estimate can be revised and resent.
                  </p>
                </form>
              ) : (
                <div className="estimate-share-panel estimate-sales-response-panel">
                  <strong>{outcomeMessage || "Response recorded"}</strong>
                  <p className="muted">
                    {estimate.status === "APPROVED"
                      ? `${estimate.branding.name} will follow up to confirm scheduling and next steps.`
                      : estimate.status === "DECLINED"
                        ? `${estimate.branding.name} can review your note and send an updated estimate if needed.`
                        : "This estimate is no longer open for a new response."}
                  </p>
                  {estimate.customerDecisionName ? <p>Response from {estimate.customerDecisionName}.</p> : null}
                  {estimate.customerDecisionNote ? <p className="muted">{estimate.customerDecisionNote}</p> : null}
                </div>
              )}
            </section>
          </>
        )}
      </section>
    </main>
  );
}
