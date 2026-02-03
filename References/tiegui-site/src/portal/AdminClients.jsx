import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, updateDoc } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { auth, db, firebaseReady } from "../lib/firebase";
import { useAuth } from "./AuthContext";
import PortalConfigMissing from "./PortalConfigMissing";

const EMPTY_SNAPSHOT = {
  spend: "",
  clicks: "",
  calls: "",
  leads: "",
  jobs: "",
  revenue: "",
};

const AdminClients = () => {
  const { user } = useAuth();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!firebaseReady || !db) {
      setLoading(false);
      return undefined;
    }
    const unsubscribe = onSnapshot(collection(db, "clients"), (snapshot) => {
      const next = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));
      setClients(next);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const clientForms = useMemo(
    () => clients.map((client) => ({
      ...client,
      allowedEmailsText: (client.allowedEmails || []).join(", "),
      adsSnapshot: { ...EMPTY_SNAPSHOT, ...(client.adsSnapshot || {}) },
    })),
    [clients]
  );

  const [drafts, setDrafts] = useState({});

  useEffect(() => {
    const nextDrafts = {};
    clientForms.forEach((client) => {
      nextDrafts[client.id] = client;
    });
    setDrafts(nextDrafts);
  }, [clientForms]);

  const updateDraft = (id, updates) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        ...updates,
      },
    }));
  };

  const updateSnapshot = (id, field, value) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        adsSnapshot: {
          ...prev[id].adsSnapshot,
          [field]: value,
        },
      },
    }));
  };

  const handleSave = async (id) => {
    if (!db) return;
    const draft = drafts[id];
    if (!draft) return;
    const emails = String(draft.allowedEmailsText || "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);

    const payload = {
      companyName: draft.companyName || "",
      allowedEmails: emails,
      leadsEmbedUrl: draft.leadsEmbedUrl || "",
      notes: draft.notes || "",
      adsSnapshot: {
        spend: draft.adsSnapshot?.spend || "",
        clicks: draft.adsSnapshot?.clicks || "",
        calls: draft.adsSnapshot?.calls || "",
        leads: draft.adsSnapshot?.leads || "",
        jobs: draft.adsSnapshot?.jobs || "",
        revenue: draft.adsSnapshot?.revenue || "",
      },
    };

    setSavingId(id);
    setStatus("");
    try {
      await updateDoc(doc(db, "clients", id), payload);
      setStatus("Saved.");
    } catch (err) {
      setStatus(err?.message || "Save failed.");
    } finally {
      setSavingId("");
      setTimeout(() => setStatus(""), 3000);
    }
  };

  if (!firebaseReady) {
    return <PortalConfigMissing />;
  }

  return (
    <div className="portal-page portal-admin">
      <header className="portal-topbar">
        <div className="portal-brand">
          <img src="/logo/tiegui-mark.png" alt="TieGui mark" className="portal-logo" />
          <div>
            <div className="portal-title">Client Admin</div>
            <div className="portal-sub">Manage client portal data</div>
          </div>
        </div>
        <div className="portal-user">
          <span className="portal-email">{user?.email}</span>
          <button className="btn ghost" type="button" onClick={() => signOut(auth)}>
            Sign out
          </button>
        </div>
      </header>

      {loading ? (
        <div className="portal-empty">Loading clients...</div>
      ) : (
        <div className="admin-grid">
          {clients.length === 0 && <div className="portal-empty">No clients yet.</div>}
          {clients.map((client) => {
            const draft = drafts[client.id];
            if (!draft) return null;
            return (
              <article key={client.id} className="portal-section admin-card">
                <div className="admin-card-header">
                  <h2>{draft.companyName || "Client"}</h2>
                  <span className="admin-id">ID: {client.id}</span>
                </div>

                <div className="admin-grid-fields">
                  <label>
                    Company name
                    <input
                      value={draft.companyName || ""}
                      onChange={(event) => updateDraft(client.id, { companyName: event.target.value })}
                    />
                  </label>
                  <label>
                    Allowed emails (comma separated)
                    <input
                      value={draft.allowedEmailsText || ""}
                      onChange={(event) => updateDraft(client.id, { allowedEmailsText: event.target.value })}
                    />
                  </label>
                  <label>
                    Leads embed URL
                    <input
                      value={draft.leadsEmbedUrl || ""}
                      onChange={(event) => updateDraft(client.id, { leadsEmbedUrl: event.target.value })}
                    />
                  </label>
                </div>

                <label>
                  Notes
                  <textarea
                    rows="4"
                    value={draft.notes || ""}
                    onChange={(event) => updateDraft(client.id, { notes: event.target.value })}
                  />
                </label>

                <div className="admin-snapshot">
                  <h3>Ads snapshot</h3>
                  <div className="admin-snapshot-grid">
                    {Object.keys(EMPTY_SNAPSHOT).map((key) => (
                      <label key={key}>
                        {key}
                        <input
                          value={draft.adsSnapshot?.[key] ?? ""}
                          onChange={(event) => updateSnapshot(client.id, key, event.target.value)}
                        />
                      </label>
                    ))}
                  </div>
                </div>

                <div className="admin-actions">
                  <button
                    className="btn primary"
                    type="button"
                    onClick={() => handleSave(client.id)}
                    disabled={savingId === client.id}
                  >
                    {savingId === client.id ? "Saving..." : "Save changes"}
                  </button>
                  {status && <span className="portal-hint">{status}</span>}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AdminClients;
