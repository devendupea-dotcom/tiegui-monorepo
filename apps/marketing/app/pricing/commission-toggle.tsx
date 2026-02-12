"use client";

import { useMemo, useState } from "react";

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(rate: number): string {
  const pct = Math.round(rate * 100);
  return `${pct}%`;
}

type CommissionToggleProps = {
  standardMonthly: number;
  commissionMonthly: number;
  commissionRate: number;
  rules: string;
};

export default function CommissionToggle({
  standardMonthly,
  commissionMonthly,
  commissionRate,
  rules,
}: CommissionToggleProps) {
  const options = useMemo(
    () => [
      {
        id: "standard" as const,
        label: "Standard",
        summary: `${formatUsd(standardMonthly)}/mo`,
      },
      {
        id: "commission" as const,
        label: "Commission-based",
        summary: `${formatUsd(commissionMonthly)}/mo + ${formatPercent(commissionRate)}`,
      },
    ],
    [commissionMonthly, commissionRate, standardMonthly],
  );

  const [active, setActive] = useState<(typeof options)[number]["id"]>("standard");
  const selected = options.find((opt) => opt.id === active) ?? options[0]!;

  return (
    <section className="commission-toggle" aria-label="Commission options">
      <div className="commission-toggle-buttons" role="tablist" aria-label="Pricing option">
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={`commission-toggle-button${opt.id === active ? " active" : ""}`}
            role="tab"
            aria-selected={opt.id === active}
            onClick={() => setActive(opt.id)}
          >
            <span className="commission-toggle-label">{opt.label}</span>
            <span className="commission-toggle-summary">{opt.summary}</span>
          </button>
        ))}
      </div>

      <div className="commission-toggle-panel" role="tabpanel">
        <p className="commission-toggle-selected">
          <strong>{selected.label}:</strong> {selected.summary}
        </p>
        {active === "commission" ? (
          <p className="commission-toggle-rules">{rules}</p>
        ) : (
          <p className="commission-toggle-muted">No commission.</p>
        )}
      </div>
    </section>
  );
}
