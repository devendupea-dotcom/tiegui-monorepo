import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth, firebaseReady } from "../lib/firebase";
import { useAuth } from "./AuthContext";
import PortalConfigMissing from "./PortalConfigMissing";

const PortalLogin = () => {
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const mode = "login";

  if (!firebaseReady) {
    return <PortalConfigMissing />;
  }

  if (user) {
    return <Navigate to="/portal" replace />;
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const trimmedEmail = email.trim().toLowerCase();

    try {
      await signInWithEmailAndPassword(auth, trimmedEmail, password);
    } catch (err) {
      setError(err?.message || "Sign in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="portal-shell">
      <div className="portal-card">
        <div className="portal-header">
          <div className="portal-brand">
            <img
              src="/logo/tiegui-mark.png"
              alt="Tiegui mark"
              className="portal-mark"
            />
            <div>
              <div className="portal-title">Client Portal</div>
              <div className="portal-sub">Invite-only access</div>
            </div>
          </div>
        </div>

        <form className="portal-form" onSubmit={handleSubmit}>
          <label>
            Email
            <input
              type="email"
              required
              autoComplete="email"
              placeholder="name@tiegui.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              required
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error && <div className="portal-error">{error}</div>}
          <button className="btn primary full" type="submit" disabled={busy}>
            {busy ? "Working..." : "Sign in"}
          </button>
        </form>

        <div className="portal-footer">
          <span>Need access?</span>
          <Link className="link-button" to="/request-access">
            Request access
          </Link>
        </div>
        <div className="portal-back">
          <Link to="/">Back to site</Link>
        </div>
      </div>
    </div>
  );
};

export default PortalLogin;
