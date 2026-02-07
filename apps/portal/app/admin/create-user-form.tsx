"use client";

import { useMemo, useState } from "react";

type OrganizationOption = {
  id: string;
  name: string;
};

type CreateUserFormProps = {
  organizations: OrganizationOption[];
};

export default function CreateUserForm({ organizations }: CreateUserFormProps) {
  const defaultOrgId = useMemo(() => organizations[0]?.id ?? "", [organizations]);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"CLIENT" | "INTERNAL">("CLIENT");
  const [orgId, setOrgId] = useState(defaultOrgId);
  const [sendEmail, setSendEmail] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [setupUrl, setSetupUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    if (role === "CLIENT" && !orgId) {
      setStatus("Select an organization for client users.");
      return;
    }

    setSubmitting(true);
    setStatus("Creating user…");
    setSetupUrl(null);

    try {
      const response = await fetch("/api/admin/create-user", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, role, orgId: role === "CLIENT" ? orgId : null, sendEmail }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        setupUrl?: string;
      };

      if (!response.ok || !data.ok) {
        setStatus(data.error || "Couldn’t create user.");
        setSubmitting(false);
        return;
      }

      setSetupUrl(data.setupUrl || null);
      setStatus(sendEmail ? "User created and emailed setup link." : "User created.");
      setEmail("");
      setRole("CLIENT");
      setOrgId(defaultOrgId);
    } catch {
      setStatus("Couldn’t create user. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const copySetupUrl = async () => {
    if (!setupUrl) return;
    try {
      await navigator.clipboard.writeText(setupUrl);
      setStatus("Setup link copied.");
    } catch {
      setStatus("Couldn’t copy. Select and copy it manually.");
    }
  };

  return (
    <form className="auth-form" onSubmit={handleSubmit} style={{ marginTop: 14 }}>
      <label>
        Email
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="contractor@business.com"
          required
          disabled={submitting}
        />
      </label>

      <label>
        Role
        <select
          value={role}
          onChange={(event) => setRole(event.target.value as "CLIENT" | "INTERNAL")}
          disabled={submitting}
        >
          <option value="CLIENT">Client</option>
          <option value="INTERNAL">Internal</option>
        </select>
      </label>

      {role === "CLIENT" && (
        <label>
          Organization
          <select
            value={orgId}
            onChange={(event) => setOrgId(event.target.value)}
            disabled={submitting || organizations.length === 0}
            required
          >
            {organizations.length === 0 ? (
              <option value="">No organizations available</option>
            ) : (
              organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))
            )}
          </select>
        </label>
      )}

      <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <input
          type="checkbox"
          checked={sendEmail}
          onChange={(event) => setSendEmail(event.target.checked)}
          disabled={submitting}
        />
        Send setup email
      </label>

      <button className="btn primary" type="submit" disabled={submitting}>
        Create user
      </button>

      {setupUrl && (
        <div className="card" style={{ marginTop: 10, padding: 14 }}>
          <div className="muted" style={{ marginBottom: 6 }}>
            Setup link (share with user)
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <code
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                background: "rgba(0,0,0,0.25)",
                wordBreak: "break-all",
              }}
            >
              {setupUrl}
            </code>
            <button type="button" className="btn secondary" onClick={copySetupUrl}>
              Copy
            </button>
          </div>
          <p className="form-status" style={{ marginTop: 8 }}>
            This link expires in about 60 minutes.
          </p>
        </div>
      )}

      {status && <p className="form-status">{status}</p>}
    </form>
  );
}
