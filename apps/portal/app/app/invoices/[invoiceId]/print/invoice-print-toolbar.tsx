"use client";

import { useEffect } from "react";

type InvoicePrintToolbarProps = {
  autoprint: boolean;
  backHref: string;
};

export default function InvoicePrintToolbar({ autoprint, backHref }: InvoicePrintToolbarProps) {
  useEffect(() => {
    if (!autoprint) return;
    const timeout = window.setTimeout(() => window.print(), 250);
    return () => window.clearTimeout(timeout);
  }, [autoprint]);

  return (
    <div className="invoice-print-toolbar">
      <a className="btn secondary" href={backHref}>
        Back to Invoice
      </a>
      <button className="btn primary" type="button" onClick={() => window.print()}>
        Print / Save PDF
      </button>
    </div>
  );
}
