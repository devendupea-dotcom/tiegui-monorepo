import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { Navigate, useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth, db, firebaseReady } from "../lib/firebase";
import { useAuth } from "./AuthContext";
import PortalAccessDenied from "./PortalAccessDenied";
import PortalConfigMissing from "./PortalConfigMissing";

const ClientPortalHome = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);

  const email = useMemo(() => user?.email?.toLowerCase() || "", [user]);

  useEffect(() => {
    if (!firebaseReady) {
      setLoading(false);
      return undefined;
    }
    if (!db || !email) {
      setLoading(false);
      return undefined;
    }
    const clientsQuery = query(
      collection(db, "clients"),
      where("allowedEmails", "array-contains", email)
    );
    const unsubscribe = onSnapshot(clientsQuery, (snapshot) => {
      const nextClients = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));
      setClients(nextClients);
      setLoading(false);
    });
    return unsubscribe;
  }, [email]);

  useEffect(() => {
    if (!loading && clients.length === 1) {
      navigate(`/portal/${clients[0].id}`, { replace: true });
    }
  }, [clients, loading, navigate]);

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

  if (clients.length === 0) {
    return <PortalAccessDenied email={user.email} />;
  }

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
            <div className="portal-title">Client Portal</div>
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
        <h2>Your accounts</h2>
        <div className="portal-client-list">
          {clients.map((client) => (
            <div key={client.id} className="portal-client-card">
              <div>
                <div className="portal-client-name">{client.companyName || "Client account"}</div>
                <div className="portal-client-meta">Managed by TieGui</div>
              </div>
              <button
                className="btn small"
                type="button"
                onClick={() => navigate(`/portal/${client.id}`)}
              >
                Open portal
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default ClientPortalHome;
