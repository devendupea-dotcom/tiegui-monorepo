import type { CSSProperties } from "react";
import { notFound } from "next/navigation";

const DARK_AUTH_OVERRIDES = {
  "--auth-page-bg": "#0b1220",
  "--auth-card-bg": "#0f172a",
  "--auth-card-border": "rgba(255, 255, 255, 0.12)",
  "--auth-card-shadow": "0 14px 30px rgba(0, 0, 0, 0.55)",
  "--auth-text-heading": "#f9fafb",
  "--auth-text-primary": "#e5e7eb",
  "--auth-text-secondary": "#9ca3af",
  "--auth-input-bg": "#111827",
  "--auth-input-border": "#374151",
  "--auth-input-text": "#f9fafb",
  "--auth-placeholder": "#9ca3af",
  "--auth-divider": "rgba(229, 231, 235, 0.22)",
  "--auth-gold": "#c7a54b",
  "--auth-gold-hover": "#ad8e3f",
} as CSSProperties;

function AuthSurfacePreview(props: {
  title: string;
  note: string;
  style?: CSSProperties;
}) {
  const { title, note, style } = props;

  return (
    <section className="auth-surface" style={{ borderRadius: 20, padding: 20, ...style }}>
      <div className="auth-card" style={{ margin: 0, maxWidth: "none" }}>
        <p className="secondary-text" style={{ marginBottom: 10, fontWeight: 700 }}>
          {title}
        </p>
        <h1>Client Command Center</h1>
        <p className="muted">{note}</p>

        <form className="auth-form" onSubmit={(event) => event.preventDefault()}>
          <label className="form-label">
            Email
            <input type="email" placeholder="you@business.com" />
          </label>
          <label className="form-label">
            Password
            <input type="password" placeholder="Your password" />
          </label>
          <p className="form-status">
            Helper text sample for contrast, readability, and spacing checks.
          </p>

          <button type="button" className="btn primary">
            Primary button
          </button>
          <a className="btn primary" href="#primary-link-preview">
            Primary link
          </a>
          <button type="button" className="btn secondary">
            Secondary button
          </button>
        </form>

        <div className="auth-divider" />

        <small className="secondary-text">Secondary copy sample</small>
      </div>
    </section>
  );
}

export default function AuthPreviewPage() {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  return (
    <main className="page" style={{ background: "#0b1220", gap: 16 }}>
      <header className="card" style={{ display: "grid", gap: 8 }}>
        <h1>Auth Surface Regression Preview</h1>
        <p className="muted">
          Dev-only check for auth heading, labels, helper text, placeholders, and button variants.
        </p>
      </header>

      <section
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
        }}
      >
        <AuthSurfacePreview
          title="Light"
          note="Light mode baseline with scoped auth variables."
          style={{ background: "#f7f8fa" }}
        />
        <AuthSurfacePreview
          title="Dark"
          note="Dark token override for side-by-side regression checks."
          style={DARK_AUTH_OVERRIDES}
        />
      </section>

      <section className="card" style={{ display: "grid", gap: 8 }}>
        <h2>Scope Guard</h2>
        <p className="muted">
          This page intentionally keeps auth variables on <code>.auth-surface</code> only. Dashboard/onboarding/admin
          surfaces should not inherit these values unless wrapped with that class.
        </p>
      </section>
    </main>
  );
}
