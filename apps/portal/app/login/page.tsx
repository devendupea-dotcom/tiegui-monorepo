"use client";

import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";

function getFriendlyAuthError(errorCode: string): string {
  switch (errorCode) {
    case "Configuration":
      return "Sign-in isn’t configured yet. Check EMAIL_SERVER/SMTP_URL, EMAIL_FROM, NEXTAUTH_SECRET, and DATABASE_URL in Vercel.";
    case "EmailSignin":
      return "We couldn’t send the email. Double-check your SMTP credentials and sender settings.";
    case "Verification":
      return "That sign-in link is invalid or expired. Request a new one.";
    case "AccessDenied":
      return "Access denied.";
    default:
      return "Sign-in failed. Please try again.";
  }
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [nextPath, setNextPath] = useState("/dashboard");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [verify, setVerify] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setNextPath(params.get("next") || "/dashboard");
    setErrorCode(params.get("error"));
    setVerify(params.has("verify"));
  }, []);

  useEffect(() => {
    if (errorCode) setStatus(getFriendlyAuthError(errorCode));
  }, [errorCode]);

  useEffect(() => {
    if (verify) setStatus("Check your email for a secure sign-in link.");
  }, [verify]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("Sending login link...");
    const result = await signIn("email", {
      email,
      redirect: false,
      callbackUrl: nextPath,
    });
    if (result?.error) {
      setStatus(getFriendlyAuthError(result.error));
      return;
    }
    setStatus("Check your email for a secure sign-in link.");
  };

  return (
    <main className="page">
      <section className="auth-card">
        <h1>Client Portal Login</h1>
        <p className="muted">Invite-only access. Use the email on your account.</p>
        <form onSubmit={handleSubmit} className="auth-form">
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@business.com"
              required
            />
          </label>
          <button className="btn primary" type="submit">Send login link</button>
          {status && <p className="form-status">{status}</p>}
        </form>
      </section>
    </main>
  );
}
