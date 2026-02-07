"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function ResetPasswordPage() {
  const router = useRouter();
  const token = useMemo(() => {
    if (typeof window === "undefined") return "";
    const params = new URLSearchParams(window.location.search);
    return params.get("token") || "";
  }, []);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) setStatus("This reset link is missing a token.");
  }, [token]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    if (password.length < 8) {
      setStatus("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setStatus("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    setStatus("Resetting password…");

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        setStatus(data.error || "This reset link is invalid or expired.");
        setSubmitting(false);
        return;
      }

      setStatus("Password reset. Redirecting to login…");
      setTimeout(() => router.push("/login"), 900);
    } catch {
      setStatus("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <main className="page">
      <section className="auth-card">
        <h1>Reset password</h1>
        <p className="muted">Choose a new password for your account.</p>

        <form onSubmit={handleSubmit} className="auth-form">
          <label>
            New password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 8 characters"
              required
              disabled={!token || submitting}
            />
          </label>
          <label>
            Confirm password
            <input
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              placeholder="Repeat your password"
              required
              disabled={!token || submitting}
            />
          </label>

          <button className="btn primary" type="submit" disabled={!token || submitting}>
            Reset password
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

