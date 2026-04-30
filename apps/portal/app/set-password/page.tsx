"use client";

import { useEffect, useState } from "react";
import { SessionProvider, signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { isPasswordWithinPolicy, PASSWORD_POLICY_MESSAGE } from "@/lib/password-policy";
import { sanitizeRedirectPath, sanitizeSameOriginRedirectUrl } from "@/lib/safe-redirect";

type SessionUserWithPasswordGate = {
  email?: string | null;
  mustChangePassword?: boolean;
};

function SetPasswordScreen() {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [nextPath, setNextPath] = useState("/");
  const [submitting, setSubmitting] = useState(false);

  const sessionUser = session?.user as SessionUserWithPasswordGate | undefined;
  const mustChangePassword = Boolean(sessionUser?.mustChangePassword);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setNextPath(sanitizeRedirectPath(params.get("next"), "/"));
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

    if (!isPasswordWithinPolicy(password)) {
      setStatus(PASSWORD_POLICY_MESSAGE);
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
      const email = sessionUser?.email || "";
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

      router.push(sanitizeSameOriginRedirectUrl(signInResult?.url, window.location.origin, nextPath));
    } catch {
      setStatus("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <main className="page auth-surface">
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
              placeholder="12 characters minimum"
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

export default function SetPasswordPage() {
  return (
    <SessionProvider refetchOnWindowFocus={false}>
      <SetPasswordScreen />
    </SessionProvider>
  );
}
