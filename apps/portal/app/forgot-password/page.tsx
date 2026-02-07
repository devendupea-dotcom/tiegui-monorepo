"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const prefill = params.get("email");
    if (prefill) setEmail(prefill);
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("Sending reset link…");
    setSubmitted(true);

    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch {
      // We intentionally show the same message to avoid leaking whether an email exists.
    }

    setStatus("If this email exists, we sent a reset link. Check your inbox (and spam).");
  };

  return (
    <main className="page">
      <section className="auth-card">
        <h1>Forgot password</h1>
        <p className="muted">We’ll email you a reset link.</p>

        <form onSubmit={handleSubmit} className="auth-form">
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@business.com"
              required
              disabled={submitted}
            />
          </label>
          <button className="btn primary" type="submit" disabled={submitted}>
            Send reset link
          </button>
          {status && <p className="form-status">{status}</p>}
        </form>

        <div className="auth-divider" />
        <Link className="btn secondary" href="/login">
          Back to login
        </Link>
      </section>
    </main>
  );
}

