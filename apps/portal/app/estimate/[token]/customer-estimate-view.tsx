"use client";

import { useEffect, useRef, useState } from "react";
import { formatEstimateCurrency, formatEstimateStatusLabel } from "@/lib/estimates";
import type { CustomerEstimateShareDetail } from "@/lib/estimate-share";

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
          ? "Estimate approved. Your contractor will follow up with next steps."
          : "Estimate declined. Your contractor can revise it and resend an updated version.",
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
        ? "Declined"
        : estimate?.status === "EXPIRED" || estimate?.shareState === "EXPIRED"
          ? "Expired"
          : estimate?.shareState === "REVOKED"
            ? "Link revoked"
            : null;

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
            <header className="estimate-share-header">
              <div className="estimate-share-brand">
                {estimate.branding.logoUrl ? (
                  <img
                    src={estimate.branding.logoUrl}
                    alt={`${estimate.branding.name} logo`}
                    className="estimate-share-logo"
                  />
                ) : null}
                <div className="stack-cell">
                  <span className="estimate-share-eyebrow">Estimate</span>
                  <h1>{estimate.branding.name}</h1>
                  {estimate.branding.website ? (
                    <a href={estimate.branding.website} target="_blank" rel="noreferrer">
                      {estimate.branding.website}
                    </a>
                  ) : null}
                </div>
              </div>
              <div className="stack-cell estimate-share-status">
                <span className="badge">{formatEstimateStatusLabel(estimate.status)}</span>
                <strong>{estimate.estimateNumber}</strong>
                <span className="muted">{estimate.title}</span>
              </div>
            </header>

            <div className="estimate-share-meta-grid">
              <article className="estimate-share-panel">
                <span className="muted">Customer</span>
                <strong>{estimate.customerName || "Customer"}</strong>
                <span>{estimate.projectType || "Project"}</span>
                <span className="muted">{estimate.siteAddress || "Address to be confirmed"}</span>
              </article>
              <article className="estimate-share-panel">
                <span className="muted">Contact</span>
                <strong>{estimate.branding.legalName || estimate.branding.name}</strong>
                {estimate.branding.phone ? <span>{estimate.branding.phone}</span> : null}
                {estimate.branding.email ? <span>{estimate.branding.email}</span> : null}
              </article>
              <article className="estimate-share-panel">
                <span className="muted">Valid Until</span>
                <strong>{estimate.validUntil ? new Date(estimate.validUntil).toLocaleDateString() : "Open"}</strong>
                <span className="muted">{estimate.description || "Review the scope and totals below before responding."}</span>
              </article>
            </div>

            {notice ? <p className="form-status">{notice}</p> : null}
            {error ? <p className="form-status">{error}</p> : null}

            <section className="estimate-share-section">
              <div className="invoice-header-row">
                <div className="stack-cell">
                  <h2>Scope & Pricing</h2>
                  <p className="muted">Review the line items, totals, and terms before approving or declining.</p>
                </div>
              </div>

              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table className="data-table estimate-module-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Description</th>
                      <th>Qty</th>
                      <th>Unit</th>
                      <th>Unit Price</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {estimate.lineItems.map((line) => (
                      <tr key={line.id}>
                        <td>{line.name}</td>
                        <td>{line.description || " "}</td>
                        <td>{line.quantity}</td>
                        <td>{line.unit || " "}</td>
                        <td>{formatEstimateCurrency(line.unitPrice)}</td>
                        <td>
                          <strong>{formatEstimateCurrency(line.total)}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="estimate-module-section">
              <div className="estimate-summary-grid">
                <article className="card estimate-summary-card">
                  <span className="muted">Subtotal</span>
                  <strong>{formatEstimateCurrency(estimate.subtotal)}</strong>
                </article>
                <article className="card estimate-summary-card">
                  <span className="muted">Tax</span>
                  <strong>{formatEstimateCurrency(estimate.tax)}</strong>
                </article>
                <article className="card estimate-summary-card estimate-summary-card--final">
                  <span className="muted">Total</span>
                  <strong>{formatEstimateCurrency(estimate.total)}</strong>
                </article>
              </div>
            </section>

            {estimate.terms ? (
              <section className="estimate-share-section">
                <div className="invoice-header-row">
                  <div className="stack-cell">
                    <h2>Terms</h2>
                  </div>
                </div>
                <div className="estimate-share-panel" style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>
                  {estimate.terms}
                </div>
              </section>
            ) : null}

            <section className="estimate-share-section">
              <div className="invoice-header-row">
                <div className="stack-cell">
                  <h2>Approval</h2>
                  <p className="muted">
                    {estimate.canRespond
                      ? "Approve or decline after reviewing the estimate. Your response is recorded but nothing is auto-booked yet."
                      : outcomeMessage
                        ? `This estimate is currently ${outcomeMessage.toLowerCase()}.`
                        : "This estimate is no longer open for a new response."}
                  </p>
                </div>
              </div>

              {estimate.canRespond ? (
                <form className="auth-form estimate-share-form" style={{ marginTop: 12 }} onSubmit={(event) => event.preventDefault()}>
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
                      Current status
                      <input value={formatEstimateStatusLabel(estimate.status)} disabled />
                    </label>
                  </div>
                  <label>
                    Note for the contractor
                    <textarea
                      rows={4}
                      value={decisionNote}
                      onChange={(event) => setDecisionNote(event.currentTarget.value)}
                      placeholder="Optional note, scheduling detail, or requested revision."
                    />
                  </label>
                  <div className="portal-empty-actions" style={{ marginTop: 12 }}>
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
                      {submitting === "decline" ? "Declining..." : "Decline Estimate"}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="estimate-share-panel" style={{ marginTop: 12 }}>
                  <strong>{outcomeMessage || "Response recorded"}</strong>
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
