"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type RevenueKpiMode = "gross" | "collected";

type RevenueKpiCardProps = {
  userId: string;
  href?: string;
  grossRevenueThisMonthCents: number | null | undefined;
  collectedRevenueThisMonthCents: number | null | undefined;
};

const STORAGE_KEY = "revenue_kpi_mode";

function formatUsdCents(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value / 100);
}

function readStoredMode(userId: string): RevenueKpiMode {
  if (typeof window === "undefined") {
    return "gross";
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return "gross";
  }

  if (raw === "gross" || raw === "collected") {
    return raw;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const value = parsed?.[userId];
    return value === "gross" || value === "collected" ? value : "gross";
  } catch {
    return "gross";
  }
}

function writeStoredMode(userId: string, mode: RevenueKpiMode) {
  if (typeof window === "undefined") {
    return;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  let nextState: Record<string, RevenueKpiMode> = {};

  if (raw) {
    if (raw === "gross" || raw === "collected") {
      nextState = { [userId]: mode };
    } else {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        nextState = Object.fromEntries(
          Object.entries(parsed || {}).filter(
            (entry): entry is [string, RevenueKpiMode] => entry[1] === "gross" || entry[1] === "collected",
          ),
        );
      } catch {
        nextState = {};
      }
    }
  }

  nextState[userId] = mode;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
}

export default function RevenueKpiCard({
  userId,
  href,
  grossRevenueThisMonthCents,
  collectedRevenueThisMonthCents,
}: RevenueKpiCardProps) {
  const [mode, setMode] = useState<RevenueKpiMode>("gross");

  useEffect(() => {
    setMode(readStoredMode(userId));
  }, [userId]);

  function updateMode(nextMode: RevenueKpiMode) {
    setMode(nextMode);
    writeStoredMode(userId, nextMode);
  }

  const displayValue = mode === "gross" ? grossRevenueThisMonthCents : collectedRevenueThisMonthCents;
  const helper =
    displayValue === null || displayValue === undefined
      ? mode === "gross"
        ? "No completed jobs this month"
        : "No payments recorded this month"
      : null;

  return (
    <article className={`dashboard-kpi-card ${href ? "dashboard-kpi-card-linkable" : ""}`.trim()}>
      {href ? <Link aria-label="Open invoices" className="dashboard-kpi-overlay-link" href={href} /> : null}
      <div className="dashboard-kpi-content">
        <div className="dashboard-kpi-head">
          <span className="dashboard-kpi-label">Revenue</span>
          <div aria-label="Revenue mode" className="dashboard-kpi-toggle" role="group">
            <button
              aria-pressed={mode === "gross"}
              className={mode === "gross" ? "active" : ""}
              type="button"
              onClick={() => updateMode("gross")}
            >
              Gross
            </button>
            <button
              aria-pressed={mode === "collected"}
              className={mode === "collected" ? "active" : ""}
              type="button"
              onClick={() => updateMode("collected")}
            >
              Collected
            </button>
          </div>
        </div>
        <strong className="dashboard-kpi-value">{formatUsdCents(displayValue)}</strong>
        <span className="dashboard-kpi-hint">This month</span>
        {helper ? <span className="dashboard-kpi-helper">{helper}</span> : null}
      </div>
    </article>
  );
}
