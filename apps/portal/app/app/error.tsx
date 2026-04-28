"use client";

import Link from "next/link";

type AppErrorProps = {
  error: Error & {
    digest?: string;
  };
  reset: () => void;
};

export default function AppError({ error, reset }: AppErrorProps) {
  return (
    <main className="page">
      <section className="card">
        <h1>Client Portal temporarily unavailable</h1>
        <p className="muted">
          We hit a server issue loading this workspace. Refresh the page or use one of the fallback routes below.
        </p>
        <div className="quick-actions" style={{ marginTop: 12 }}>
          <button className="btn primary" type="button" onClick={() => reset()}>
            Try Again
          </button>
          <Link className="btn secondary" href="/dashboard">
            Return to Dashboard
          </Link>
          <Link className="btn secondary" href="/login">
            Sign in again
          </Link>
        </div>
        {error.digest ? (
          <p className="muted" style={{ marginTop: 12 }}>
            Error ID: {error.digest}
          </p>
        ) : null}
      </section>
    </main>
  );
}
