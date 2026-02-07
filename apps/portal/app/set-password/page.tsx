"use client";

import { useEffect, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function SetPasswordPage() {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [nextPath, setNextPath] = useState("/dashboard");
  const [submitting, setSubmitting] = useState(false);

  const mustChangePassword = Boolean((session?.user as any)?.mustChangePassword);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setNextPath(params.get("next") || "/dashboard");
  }, []);

  useEffect(() => {
    if (sessionStatus === "unauthenticated") {
      router.push(`/login?next=${encodeURIComponent("/set-password")}`);
    }
  }, [router, sessionStatus]);

  useEffect(() => {
    if (sessionStatus === "authenticated" && !mustChangePassword) {
      router.push(nextPath);
    }
  }, [mustChangePassword, nextPath, router, sessionStatus]);

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
    setStatus("Saving password…");

    try {
      const response = await fetch("/api/account/set-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        setStatus(data.error || "Couldn’t save password. Please try again.");
        setSubmitting(false);
        return;
      }

      // Re-issue a clean JWT (mustChangePassword=false) by signing in with the new password.
      const email = session?.user?.email || "";
      const signInResult = await signIn("credentials", {
        email,
        password,
        redirect: false,
        callbackUrl: nextPath,
      });

      if (signInResult?.error) {
        setStatus("Password saved. Please sign in again.");
        router.push("/login");
        return;
      }

      router.push(nextPath);
    } catch {
      setStatus("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <main className="page">
      <section className="auth-card">
        <h1>Set your password</h1>
        <p className="muted">
          For security, you need to choose a new password before continuing.
        </p>

        <form onSubmit={handleSubmit} className="auth-form">
          <label>
            New password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 8 characters"
              required
              disabled={sessionStatus !== "authenticated" || submitting}
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
              disabled={sessionStatus !== "authenticated" || submitting}
            />
          </label>

          <button className="btn primary" type="submit" disabled={sessionStatus !== "authenticated" || submitting}>
            Save password
          </button>

          {status && <p className="form-status">{status}</p>}
        </form>
      </section>
    </main>
  );
}

