"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("Sending login link...");
    const result = await signIn("email", { email, redirect: false, callbackUrl: "/dashboard" });
    if (result?.error) {
      setStatus("Unable to send login link. Check your email settings.");
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
