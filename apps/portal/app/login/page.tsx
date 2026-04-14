"use client";

import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";

function getFriendlyAuthError(errorCode: string): string {
  switch (errorCode) {
    case "Configuration":
      return "Sign-in isn’t configured yet. Check SMTP_URL, EMAIL_FROM, NEXTAUTH_SECRET, and DATABASE_URL in Vercel.";
    case "EmailSignin":
      return "We couldn’t send the email. Double-check your SMTP credentials and sender settings.";
    case "Verification":
      return "That sign-in link is invalid or expired. Request a new one.";
    case "AccessDenied":
      return "Access denied.";
    case "CredentialsSignin":
      return "Incorrect email or password.";
    default:
      return "Sign-in failed. Please try again.";
  }
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [magicLinkSubmitting, setMagicLinkSubmitting] = useState(false);
  const [nextPath, setNextPath] = useState("/");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [verify, setVerify] = useState(false);
  const [showRequestAccess, setShowRequestAccess] = useState(false);
  const [requestName, setRequestName] = useState("");
  const [requestCompany, setRequestCompany] = useState("");
  const [requestPhone, setRequestPhone] = useState("");
  const [requestNote, setRequestNote] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setNextPath(params.get("next") || "/");
    setErrorCode(params.get("error"));
    setVerify(params.has("verify"));
  }, []);

  useEffect(() => {
    if (errorCode) setStatus(getFriendlyAuthError(errorCode));
  }, [errorCode]);

  useEffect(() => {
    if (verify) setStatus("Check your email for a secure sign-in link.");
  }, [verify]);

  const handleRequestAccess = () => {
    const to = "admin@tieguisolutions.com";
    const subject = "Portal access request";
    const bodyLines = [
      "Please grant portal access for:",
      "",
      `Email: ${email || "(enter email above)"}`,
      requestName ? `Name: ${requestName}` : null,
      requestCompany ? `Company: ${requestCompany}` : null,
      requestPhone ? `Phone: ${requestPhone}` : null,
      requestNote ? `Notes: ${requestNote}` : null,
      "",
      `Requested from: ${typeof window !== "undefined" ? window.location.href : ""}`,
    ].filter(Boolean);
    const body = bodyLines.join("\n");

    window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const handlePasswordSignIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (passwordSubmitting) return;

    const trimmedEmail = email.trim();
    const nextEmailError = trimmedEmail ? null : "Enter your email.";
    const nextPasswordError = password ? null : "Enter your password.";
    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    if (nextEmailError || nextPasswordError) {
      setStatus("Complete the required fields to continue.");
      return;
    }

    setPasswordSubmitting(true);
    setStatus("Signing in…");

    try {
      const result = await signIn("credentials", {
        email: trimmedEmail,
        password,
        redirect: false,
        callbackUrl: nextPath,
      });

      if (result?.error) {
        setStatus(getFriendlyAuthError(result.error));
        return;
      }

      router.push(result?.url || nextPath);
    } catch {
      setStatus("Sign-in failed. Please try again.");
    } finally {
      setPasswordSubmitting(false);
    }
  };

  const handleMagicLink = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (magicLinkSubmitting) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setEmailError("Enter your email before requesting a login link.");
      setStatus("Enter your email before requesting a login link.");
      return;
    }

    setEmailError(null);
    setMagicLinkSubmitting(true);
    setStatus("Sending login link...");
    try {
      const result = await signIn("email", {
        email: trimmedEmail,
        redirect: false,
        callbackUrl: nextPath,
      });
      if (result?.error) {
        setStatus(getFriendlyAuthError(result.error));
        return;
      }
      setStatus("Check your email for a secure sign-in link.");
    } catch {
      setStatus("We couldn’t send the email. Double-check your SMTP credentials and sender settings.");
    } finally {
      setMagicLinkSubmitting(false);
    }
  };

  return (
    <main className="page auth-surface">
      <section className="auth-card">
        <h1>Client Command Center</h1>
        <p className="muted">Invite-only access for active TieGui clients.</p>
        <form onSubmit={handlePasswordSignIn} className="auth-form">
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                if (emailError) setEmailError(null);
              }}
              placeholder="you@business.com"
              required
              disabled={passwordSubmitting || magicLinkSubmitting}
              aria-invalid={Boolean(emailError)}
            />
            {emailError ? <span className="form-status">{emailError}</span> : null}
          </label>
          <label>
            Password
            <div className="auth-password-field">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  if (passwordError) setPasswordError(null);
                }}
                placeholder="Your password"
                autoComplete="current-password"
                required
                disabled={passwordSubmitting}
                aria-invalid={Boolean(passwordError)}
              />
              <button
                type="button"
                className="auth-password-toggle"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                disabled={passwordSubmitting}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            {passwordError ? <span className="form-status">{passwordError}</span> : null}
          </label>

          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <Link className="muted" href={`/forgot-password?email=${encodeURIComponent(email)}`}>
              Forgot password?
            </Link>
          </div>

          <button className="btn primary" type="submit" disabled={passwordSubmitting}>
            {passwordSubmitting ? "Signing in…" : "Access Dashboard"}
          </button>
          <p className="form-status">
            New here? We’ll send you a temporary password when your account is created — you can change it after your
            first login.
          </p>
          {status && <p className="form-status">{status}</p>}
        </form>

        <div className="auth-divider" />

        <div className="auth-secondary">
          <p className="auth-secondary-kicker">Prefer passwordless access?</p>
          <p className="muted">Use a secure sign-in link (magic link).</p>
          <form onSubmit={handleMagicLink} className="auth-form" style={{ marginTop: 12 }}>
            <button className="btn secondary" type="submit" disabled={magicLinkSubmitting}>
              {magicLinkSubmitting ? "Sending login link…" : "Send login link"}
            </button>
          </form>
        </div>

        <div className="auth-divider" />

        <div className="auth-secondary">
          <div className="auth-secondary-head">
            <h2>Don’t have access?</h2>
            <p className="muted">
              Request access and we’ll get you set up.
            </p>
          </div>

          {!showRequestAccess ? (
            <button
              type="button"
              className="btn secondary"
              onClick={() => setShowRequestAccess(true)}
            >
              Request access
            </button>
          ) : (
            <div className="auth-form" style={{ marginTop: 12 }}>
              <label>
                Name (optional)
                <input
                  value={requestName}
                  onChange={(event) => setRequestName(event.target.value)}
                  placeholder="Your name"
                />
              </label>
              <label>
                Company (optional)
                <input
                  value={requestCompany}
                  onChange={(event) => setRequestCompany(event.target.value)}
                  placeholder="Business name"
                />
              </label>
              <label>
                Phone (optional)
                <input
                  value={requestPhone}
                  onChange={(event) => setRequestPhone(event.target.value)}
                  placeholder="(555) 555-5555"
                />
              </label>
              <label>
                Notes (optional)
                <textarea
                  value={requestNote}
                  onChange={(event) => setRequestNote(event.target.value)}
                  placeholder="Anything we should know?"
                  rows={3}
                />
              </label>

              <div className="auth-secondary-actions">
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => setShowRequestAccess(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn primary"
                  onClick={handleRequestAccess}
                  disabled={!email}
                >
                  Email request
                </button>
              </div>

              <p className="form-status">
                This opens your email app to send a request to <strong>admin@tieguisolutions.com</strong>.
              </p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
