import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { auth, db, firebaseReady } from "../lib/firebase";
import { useAuth } from "./AuthContext";
import PortalConfigMissing from "./PortalConfigMissing";

const STATUS_OPTIONS = [
  "New Lead",
  "Contacted",
  "Call Scheduled",
  "Closed - Paid",
  "In Progress",
  "Live",
  "Monthly Maintenance",
];

const SERVICE_OPTIONS = ["Website", "Hosting", "Ads", "Other"];

const ASSIGNED_OPTIONS = ["Deven", "Marcus"];

const PortalJobs = () => {
  const { user } = useAuth();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [activeJobId, setActiveJobId] = useState("");
  const [formState, setFormState] = useState({
    businessName: "",
    contactName: "",
    phone: "",
    email: "",
    serviceRequested: "Website",
    status: "New Lead",
    assignedTo: "Deven",
    nextAction: "",
    notes: "",
  });

  useEffect(() => {
    if (!firebaseReady || !db) {
      setLoading(false);
      return undefined;
    }
    const jobsQuery = query(collection(db, "jobs"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(jobsQuery, (snapshot) => {
      const nextJobs = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
      setJobs(nextJobs);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const activeJob = useMemo(
    () => jobs.find((job) => job.id === activeJobId) || null,
    [jobs, activeJobId]
  );

  const updateJob = async (id, updates) => {
    if (!db) return;
    await updateDoc(doc(db, "jobs", id), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    if (!db) return;
    await addDoc(collection(db, "jobs"), {
      ...formState,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    setFormState({
      businessName: "",
      contactName: "",
      phone: "",
      email: "",
      serviceRequested: "Website",
      status: "New Lead",
      assignedTo: "Deven",
      nextAction: "",
      notes: "",
    });
    setShowNew(false);
  };

  const handleDelete = async (id) => {
    if (!db) return;
    if (!window.confirm("Delete this job?")) return;
    await deleteDoc(doc(db, "jobs", id));
    if (activeJobId === id) setActiveJobId("");
  };

  if (!firebaseReady) {
    return <PortalConfigMissing />;
  }

  return (
    <div className="portal-page">
      <header className="portal-topbar">
        <div className="portal-brand">
          <img
            src="/logo/tiegui-logo-transparent.png"
            alt="Tiegui Solutions"
            className="portal-logo"
          />
          <div>
            <div className="portal-title">Tiegui Portal</div>
            <div className="portal-sub">Jobs board</div>
          </div>
        </div>
        <div className="portal-user">
          <span className="portal-email">{user?.email}</span>
          <button className="btn ghost" type="button" onClick={() => signOut(auth)}>
            Sign out
          </button>
        </div>
      </header>

      <div className="portal-actions">
        <button className="btn primary" type="button" onClick={() => setShowNew((prev) => !prev)}>
          {showNew ? "Close" : "New Job"}
        </button>
        <div className="portal-hint">Only Deven + Marcus can access this portal.</div>
      </div>

      {showNew && (
        <form className="portal-card portal-new" onSubmit={handleCreate}>
          <div className="portal-grid">
            <label>
              Business Name
              <input
                required
                value={formState.businessName}
                onChange={(event) => setFormState({ ...formState, businessName: event.target.value })}
              />
            </label>
            <label>
              Contact Name
              <input
                required
                value={formState.contactName}
                onChange={(event) => setFormState({ ...formState, contactName: event.target.value })}
              />
            </label>
            <label>
              Phone
              <input
                required
                value={formState.phone}
                onChange={(event) => setFormState({ ...formState, phone: event.target.value })}
              />
            </label>
            <label>
              Email
              <input
                value={formState.email}
                onChange={(event) => setFormState({ ...formState, email: event.target.value })}
              />
            </label>
            <label>
              Service Requested
              <select
                value={formState.serviceRequested}
                onChange={(event) => setFormState({ ...formState, serviceRequested: event.target.value })}
              >
                {SERVICE_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <label>
              Assigned To
              <select
                value={formState.assignedTo}
                onChange={(event) => setFormState({ ...formState, assignedTo: event.target.value })}
              >
                {ASSIGNED_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select
                value={formState.status}
                onChange={(event) => setFormState({ ...formState, status: event.target.value })}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <label>
              Next Action
              <input
                value={formState.nextAction}
                onChange={(event) => setFormState({ ...formState, nextAction: event.target.value })}
              />
            </label>
          </div>
          <label>
            Notes
            <textarea
              rows="3"
              value={formState.notes}
              onChange={(event) => setFormState({ ...formState, notes: event.target.value })}
            />
          </label>
          <button className="btn primary" type="submit">Create Job</button>
        </form>
      )}

      <div className="portal-table">
        <div className="portal-row portal-head">
          <div>Business</div>
          <div>Service</div>
          <div>Status</div>
          <div>Assigned</div>
          <div>Next Action</div>
          <div>Open</div>
        </div>
        {loading && <div className="portal-empty">Loading jobs...</div>}
        {!loading && jobs.length === 0 && (
          <div className="portal-empty">No jobs yet. Add one to get started.</div>
        )}
        {jobs.map((job) => (
          <div key={job.id} className="portal-row">
            <div>{job.businessName}</div>
            <div>{job.serviceRequested}</div>
            <div>
              <select
                value={job.status || "New Lead"}
                onChange={(event) => updateJob(job.id, { status: event.target.value })}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
            <div>
              <select
                value={job.assignedTo || "Deven"}
                onChange={(event) => updateJob(job.id, { assignedTo: event.target.value })}
              >
                {ASSIGNED_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
            <div>
              <input
                defaultValue={job.nextAction || ""}
                onBlur={(event) => updateJob(job.id, { nextAction: event.target.value })}
              />
            </div>
            <div>
              <button className="btn small" type="button" onClick={() => setActiveJobId(job.id)}>
                Open
              </button>
            </div>
          </div>
        ))}
      </div>

      {activeJob && (
        <div className="portal-drawer">
          <div className="portal-drawer-card">
            <div className="portal-drawer-header">
              <div>
                <div className="card-title">{activeJob.businessName}</div>
                <div className="muted">{activeJob.contactName} • {activeJob.phone}</div>
              </div>
              <button className="btn ghost" type="button" onClick={() => setActiveJobId("")}>
                Close
              </button>
            </div>
            <div className="portal-drawer-grid">
              <div>
                <div className="portal-label">Email</div>
                <div>{activeJob.email || "—"}</div>
              </div>
              <div>
                <div className="portal-label">Service</div>
                <div>{activeJob.serviceRequested}</div>
              </div>
              <div>
                <div className="portal-label">Status</div>
                <div>{activeJob.status}</div>
              </div>
              <div>
                <div className="portal-label">Assigned</div>
                <div>{activeJob.assignedTo}</div>
              </div>
            </div>
            <label>
              Notes
              <textarea
                rows="4"
                defaultValue={activeJob.notes || ""}
                onBlur={(event) => updateJob(activeJob.id, { notes: event.target.value })}
              />
            </label>
            <div className="portal-drawer-actions">
              <button className="btn ghost" type="button" onClick={() => handleDelete(activeJob.id)}>
                Delete Job
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PortalJobs;
