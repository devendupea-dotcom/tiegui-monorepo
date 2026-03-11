import Link from "next/link";
import type { ReactNode } from "react";

type StatusTone = "good" | "warn" | "accent" | "neutral";

export function StatusPill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: StatusTone;
}) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}

export function KpiCard({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  href?: string;
}) {
  const content = (
    <>
      <span className="dashboard-kpi-label">{label}</span>
      <strong className="dashboard-kpi-value">{value}</strong>
      {hint ? <span className="dashboard-kpi-hint">{hint}</span> : <span className="dashboard-kpi-hint">&nbsp;</span>}
    </>
  );

  if (href) {
    return (
      <Link className="dashboard-kpi-card" href={href}>
        {content}
      </Link>
    );
  }

  return <article className="dashboard-kpi-card">{content}</article>;
}

export function PanelCard({
  eyebrow,
  title,
  subtitle,
  actionHref,
  actionLabel,
  children,
  className = "",
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actionHref?: string;
  actionLabel?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card dashboard-panel ${className}`.trim()}>
      <header className="dashboard-panel-head">
        <div className="dashboard-panel-copy">
          {eyebrow ? <p className="dashboard-panel-eyebrow">{eyebrow}</p> : null}
          <h2>{title}</h2>
          {subtitle ? <p className="muted">{subtitle}</p> : null}
        </div>
        {actionHref && actionLabel ? (
          <Link className="table-link" href={actionHref}>
            {actionLabel}
          </Link>
        ) : null}
      </header>
      {children}
    </section>
  );
}

export function SkeletonCard({
  rows = 3,
  compact = false,
}: {
  rows?: number;
  compact?: boolean;
}) {
  return (
    <section className={`card dashboard-skeleton-card ${compact ? "compact" : ""}`}>
      <div className="skeleton skeleton-kicker" />
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-subtitle" />
      <div className="dashboard-skeleton-list">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="skeleton skeleton-list-item" />
        ))}
      </div>
    </section>
  );
}
