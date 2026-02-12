"use client";

export default function PricingPdfActions() {
  return (
    <div className="pricing-pdf-actions no-print">
      <button
        className="cta-button gold"
        type="button"
        onClick={() => window.print()}
      >
        Download Pricing PDF
      </button>
      <p className="muted">Use Save as PDF in the print dialog for the 2026 beta pricing sheet.</p>
    </div>
  );
}
