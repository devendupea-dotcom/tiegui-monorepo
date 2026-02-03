import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { Navigate, useParams } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth, db, firebaseReady } from "../lib/firebase";
import { useAuth } from "./AuthContext";
import PortalAccessDenied from "./PortalAccessDenied";
import PortalConfigMissing from "./PortalConfigMissing";

const METRICS = [
  { key: "spend", label: "Spend", format: "currency" },
  { key: "clicks", label: "Clicks", format: "number" },
  { key: "calls", label: "Calls", format: "number" },
  { key: "leads", label: "Leads", format: "number" },
  { key: "jobs", label: "Jobs", format: "number" },
  { key: "revenue", label: "Revenue", format: "currency" },
];

const formatValue = (value, format) => {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "number") {
    if (format === "currency") {
      return `$${value.toLocaleString()}`;
    }
    return value.toLocaleString();
  }
  return value;
};

const ClientPortalView = () => {
  const { clientId } = useParams();
  const { user } = useAuth();
  const [client, setClient] = useState(null);
  const [loading, setLoading] = useState(true);

  const email = useMemo(() => user?.email?.toLowerCase() || "", [user]);

  useEffect(() => {
    if (!firebaseReady) {
      setLoading(false);
      return undefined;
    }
    if (!db || !clientId) {
      setLoading(false);
      return undefined;
    }
    const clientRef = doc(db, "clients", clientId);
    const unsubscribe = onSnapshot(clientRef, (snapshot) => {
      if (!snapshot.exists()) {
        setClient({ missing: true });
      } else {
        setClient({ id: snapshot.id, ...snapshot.data() });
      }
      setLoading(false);
    });
    return unsubscribe;
  }, [clientId]);

  if (!firebaseReady) {
    return <PortalConfigMissing />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (loading) {
    return (
      <div className="portal-shell">
        <div className="portal-card">Loading portal...</div>
      </div>
    );
  }

  if (!client || client.missing) {
    return (
      <div className="portal-shell">
        <div className="portal-card">Client account not found.</div>
      </div>
    );
  }

  const allowedEmails = (client.allowedEmails || []).map((entry) => String(entry).toLowerCase());
  if (!allowedEmails.includes(email)) {
    return <PortalAccessDenied email={user.email} />;
  }

  const snapshot = client.adsSnapshot || {};
  const leadsUrl = String(client.leadsEmbedUrl || "").trim();

  return (
    <div className="portal-page portal-client">
      <header className="portal-topbar">
        <div className="portal-brand">
          <img
            src="/logo/tiegui-mark.png"
            alt="TieGui mark"
            className="portal-logo"
          />
          <div>
            <div className="portal-title">{client.companyName || "Client Portal"}</div>
            <div className="portal-sub">Managed by TieGui</div>
          </div>
        </div>
        <div className="portal-user">
          <span className="portal-email">{user.email}</span>
          <button className="btn ghost" type="button" onClick={() => signOut(auth)}>
            Sign out
          </button>
        </div>
      </header>

      <section className="portal-section">
        <h2>Leads</h2>
        {leadsUrl ? (
          <iframe
            className="portal-iframe"
            src={leadsUrl}
            title={`${client.companyName || "Client"} leads`}
            loading="lazy"
            allow="fullscreen"
          />
        ) : (
          <div className="portal-empty">Leads view is not available yet.</div>
        )}
      </section>

      <section className="portal-section">
        <h2>Ads snapshot</h2>
        <div className="portal-metrics">
          {METRICS.map((metric) => (
            <div key={metric.key} className="portal-metric">
              <div className="portal-metric-label">{metric.label}</div>
              <div className="portal-metric-value">
                {formatValue(snapshot[metric.key], metric.format)}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="portal-section">
        <h2>Notes</h2>
        <p className="portal-notes">{client.notes || "No notes yet."}</p>
      </section>
    </div>
  );
};

export default ClientPortalView;
