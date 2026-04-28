"use client";

import { FormEvent, useMemo, useState } from "react";
import type {
  WebsiteLeadReceiptDto,
  WebsiteLeadSourceDto,
} from "@/lib/website-lead-sources";

type SecretReveal = {
  sourceId: string;
  sourceName: string;
  plaintextSecret: string;
  reason: "created" | "rotated";
};

type ApiSourceResponse = {
  ok: boolean;
  source?: WebsiteLeadSourceDto;
  plaintextSecret?: string;
  error?: string;
};

type ApiListResponse = {
  ok: boolean;
  sources?: WebsiteLeadSourceDto[];
  recentReceipts?: WebsiteLeadReceiptDto[];
  error?: string;
};

type EditState = {
  id: string;
  name: string;
  description: string;
  allowedOrigin: string;
};

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function samplePayload() {
  return JSON.stringify(
    {
      name: "Cesar Homeowner",
      phone: "+12065550100",
      email: "cesar@example.com",
      reason: "Custom outdoor living project",
      budgetRange: "$25k-$50k",
      timeline: "Next 60 days",
      message: "Looking for design help and an estimate.",
      sourcePath: "/contact",
      pageTitle: "Velocity Landscapes Contact",
      smsOptIn: true,
      attribution: {
        utm_source: "google",
        utm_medium: "cpc",
        utm_campaign: "spring-hardscapes",
      },
    },
    null,
    2,
  );
}

function signingHelper(sourceId: string) {
  return `import { createHmac, randomUUID } from "node:crypto";

const sourceId = "${sourceId}";
const sourceSecret = process.env.TIEGUI_WEBSITE_LEAD_SECRET!;

export async function submitTieGuiLead(payload: Record<string, unknown>) {
  const rawBody = JSON.stringify(payload);
  const timestamp = new Date().toISOString();
  const idempotencyKey = randomUUID();
  const signatureBase = \`\${timestamp}.\${sourceId}.\${rawBody}\`;
  const signature = createHmac("sha256", sourceSecret)
    .update(signatureBase, "utf8")
    .digest("hex");

  const response = await fetch("https://app.tieguisolutions.com/api/public/website-leads", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-TieGui-Source-Id": sourceId,
      "X-TieGui-Timestamp": timestamp,
      "X-TieGui-Signature": signature,
      "X-TieGui-Idempotency-Key": idempotencyKey,
    },
    body: rawBody,
  });

  if (!response.ok) {
    throw new Error(\`TieGui intake failed: \${response.status}\`);
  }

  return response.json();
}`;
}

async function parseResponse(response: Response): Promise<ApiSourceResponse & ApiListResponse> {
  const body = (await response.json().catch(() => ({}))) as ApiSourceResponse & ApiListResponse;
  if (!response.ok || body.ok === false) {
    throw new Error(body.error || `Request failed with ${response.status}`);
  }
  return body;
}

export default function WebsiteLeadSourcesManager({
  orgId,
  orgName,
  initialSources,
  initialReceipts,
}: {
  orgId: string;
  orgName: string;
  initialSources: WebsiteLeadSourceDto[];
  initialReceipts: WebsiteLeadReceiptDto[];
}) {
  const [sources, setSources] = useState(initialSources);
  const [receipts, setReceipts] = useState(initialReceipts);
  const [secretReveal, setSecretReveal] = useState<SecretReveal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    allowedOrigin: "",
  });

  const selectedInstructionSource = useMemo(
    () => secretReveal?.sourceId || sources[0]?.id || "SOURCE_ID",
    [secretReveal?.sourceId, sources],
  );

  function upsertSource(source: WebsiteLeadSourceDto) {
    setSources((current) => {
      const index = current.findIndex((item) => item.id === source.id);
      if (index === -1) return [source, ...current];
      const copy = current.slice();
      copy[index] = source;
      return copy;
    });
  }

  async function refreshSources() {
    const response = await fetch(`/api/hq/orgs/${orgId}/website-lead-sources`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const data = await parseResponse(response);
    if (data.sources) setSources(data.sources);
    if (data.recentReceipts) setReceipts(data.recentReceipts);
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusyAction("create");

    try {
      const response = await fetch(`/api/hq/orgs/${orgId}/website-lead-sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await parseResponse(response);
      if (!data.source || !data.plaintextSecret) {
        throw new Error("Create response was missing source secret output.");
      }

      upsertSource(data.source);
      setSecretReveal({
        sourceId: data.source.id,
        sourceName: data.source.name,
        plaintextSecret: data.plaintextSecret,
        reason: "created",
      });
      setForm({ name: "", description: "", allowedOrigin: "" });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Create failed.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handlePatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setError(null);
    setBusyAction(`patch:${editing.id}`);

    try {
      const response = await fetch(
        `/api/hq/orgs/${orgId}/website-lead-sources/${editing.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: editing.name,
            description: editing.description,
            allowedOrigin: editing.allowedOrigin,
          }),
        },
      );
      const data = await parseResponse(response);
      if (!data.source) throw new Error("Update response was missing source.");
      upsertSource(data.source);
      setEditing(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Update failed.");
    } finally {
      setBusyAction(null);
    }
  }

  async function postSourceAction(source: WebsiteLeadSourceDto, action: "enable" | "disable" | "rotate-secret") {
    setError(null);
    setBusyAction(`${action}:${source.id}`);

    try {
      const response = await fetch(
        `/api/hq/orgs/${orgId}/website-lead-sources/${source.id}/${action}`,
        { method: "POST" },
      );
      const data = await parseResponse(response);
      if (!data.source) throw new Error("Action response was missing source.");
      upsertSource(data.source);
      if (action === "rotate-secret") {
        if (!data.plaintextSecret) throw new Error("Rotation response was missing source secret output.");
        setSecretReveal({
          sourceId: data.source.id,
          sourceName: data.source.name,
          plaintextSecret: data.plaintextSecret,
          reason: "rotated",
        });
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Action failed.");
    } finally {
      setBusyAction(null);
    }
  }

  async function copyText(value: string) {
    await navigator.clipboard.writeText(value);
  }

  return (
    <>
      {error ? (
        <section className="card" role="alert">
          <span className="badge status-overdue">Error</span>
          <p className="muted" style={{ marginTop: 8 }}>{error}</p>
        </section>
      ) : null}

      {secretReveal ? (
        <section className="card">
          <span className="badge status-success">
            Secret {secretReveal.reason === "created" ? "created" : "rotated"}
          </span>
          <h3 style={{ marginTop: 10 }}>{secretReveal.sourceName}</h3>
          <p className="muted">
            This is the only time the plaintext source secret is shown. Store it in the external website server
            environment, then close this panel.
          </p>
          <div className="quick-links" style={{ marginTop: 12 }}>
            <button className="btn secondary" type="button" onClick={() => copyText(secretReveal.sourceId)}>
              Copy source id
            </button>
            <button className="btn secondary" type="button" onClick={() => copyText(secretReveal.plaintextSecret)}>
              Copy secret
            </button>
            <button className="btn secondary" type="button" onClick={() => setSecretReveal(null)}>
              Hide
            </button>
          </div>
          <dl style={{ display: "grid", gap: 10, marginTop: 14 }}>
            <div>
              <dt className="muted">Source id</dt>
              <dd><code>{secretReveal.sourceId}</code></dd>
            </div>
            <div>
              <dt className="muted">Plaintext secret</dt>
              <dd>
                <pre style={{ whiteSpace: "pre-wrap", overflowX: "auto" }}>{secretReveal.plaintextSecret}</pre>
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      <section className="card">
        <h3>Create Website Lead Source</h3>
        <p className="muted">
          Creates a per-site source for {orgName}. The secret is generated once, encrypted at rest, and shown once.
        </p>
        <form onSubmit={handleCreate} style={{ marginTop: 14 }}>
          <label>
            Source name
            <input
              required
              maxLength={100}
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Velocity Landscapes website"
            />
          </label>
          <label>
            Description
            <textarea
              maxLength={500}
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="Main public contact form"
            />
          </label>
          <label>
            Allowed origin
            <input
              value={form.allowedOrigin}
              onChange={(event) => setForm((current) => ({ ...current, allowedOrigin: event.target.value }))}
              placeholder="https://velocitylandscapes.com"
            />
          </label>
          <div className="quick-links" style={{ marginTop: 12 }}>
            <button className="btn primary" type="submit" disabled={busyAction === "create"}>
              {busyAction === "create" ? "Creating..." : "Create source"}
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <div className="hq-header-top">
          <div>
            <h3>Sources</h3>
            <p className="muted">Active sources can create leads through the signed public intake endpoint.</p>
          </div>
          <button className="btn secondary" type="button" onClick={() => refreshSources()} disabled={busyAction !== null}>
            Refresh
          </button>
        </div>

        <table className="data-table" style={{ marginTop: 14 }}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Origin</th>
              <th>Last Used</th>
              <th>Receipts</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sources.length ? sources.map((source) => (
              <tr key={source.id}>
                <td>
                  <strong>{source.name}</strong>
                  <div className="muted">{source.description || "No description"}</div>
                  <div><code>{source.id}</code></div>
                  {source.rateLimitKey ? <div className="muted">Rate key: <code>{source.rateLimitKey}</code></div> : null}
                </td>
                <td>
                  <span className={`badge ${source.active ? "status-success" : "status-overdue"}`}>
                    {source.active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td>{source.allowedOrigin || "Server-to-server"}</td>
                <td>{formatDate(source.lastUsedAt)}</td>
                <td>{source.submissionCount}</td>
                <td>
                  <div className="quick-links">
                    <button
                      className="btn secondary"
                      type="button"
                      onClick={() => setEditing({
                        id: source.id,
                        name: source.name,
                        description: source.description || "",
                        allowedOrigin: source.allowedOrigin || "",
                      })}
                    >
                      Edit
                    </button>
                    <button
                      className="btn secondary"
                      type="button"
                      onClick={() => postSourceAction(source, "rotate-secret")}
                      disabled={busyAction === `rotate-secret:${source.id}`}
                    >
                      Rotate
                    </button>
                    <button
                      className="btn secondary"
                      type="button"
                      onClick={() => postSourceAction(source, source.active ? "disable" : "enable")}
                      disabled={busyAction === `${source.active ? "disable" : "enable"}:${source.id}`}
                    >
                      {source.active ? "Disable" : "Enable"}
                    </button>
                  </div>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={6} className="muted">No website lead sources yet.</td>
              </tr>
            )}
          </tbody>
        </table>

        {editing ? (
          <form onSubmit={handlePatch} style={{ marginTop: 18 }}>
            <h4>Edit Source</h4>
            <label>
              Source name
              <input
                required
                maxLength={100}
                value={editing.name}
                onChange={(event) => setEditing((current) => current ? { ...current, name: event.target.value } : current)}
              />
            </label>
            <label>
              Description
              <textarea
                maxLength={500}
                value={editing.description}
                onChange={(event) => setEditing((current) => current ? { ...current, description: event.target.value } : current)}
              />
            </label>
            <label>
              Allowed origin
              <input
                value={editing.allowedOrigin}
                onChange={(event) => setEditing((current) => current ? { ...current, allowedOrigin: event.target.value } : current)}
              />
            </label>
            <div className="quick-links" style={{ marginTop: 12 }}>
              <button className="btn primary" type="submit" disabled={busyAction === `patch:${editing.id}`}>
                {busyAction === `patch:${editing.id}` ? "Saving..." : "Save"}
              </button>
              <button className="btn secondary" type="button" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </form>
        ) : null}
      </section>

      <section className="card">
        <h3>Integration Instructions</h3>
        <p className="muted">
          Sign requests server-side only. The source secret must never ship in browser JavaScript.
        </p>
        <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
          <div>
            <h4>Required headers</h4>
            <pre style={{ whiteSpace: "pre-wrap", overflowX: "auto" }}>{`Content-Type: application/json
X-TieGui-Source-Id: ${selectedInstructionSource}
X-TieGui-Timestamp: <ISO timestamp or unix timestamp>
X-TieGui-Signature: <HMAC-SHA256 hex>
X-TieGui-Idempotency-Key: <stable unique key per submission>`}</pre>
          </div>
          <div>
            <h4>Signature base string</h4>
            <pre style={{ whiteSpace: "pre-wrap", overflowX: "auto" }}>{"<timestamp>.<sourceId>.<raw JSON body>"}</pre>
          </div>
          <div>
            <h4>Sample payload</h4>
            <pre style={{ whiteSpace: "pre-wrap", overflowX: "auto" }}>{samplePayload()}</pre>
          </div>
          <div>
            <h4>Server-side TypeScript helper</h4>
            <pre style={{ whiteSpace: "pre-wrap", overflowX: "auto" }}>{signingHelper(selectedInstructionSource)}</pre>
          </div>
        </div>
      </section>

      <section className="card">
        <h3>Recent Submission Receipts</h3>
        <p className="muted">
          Receipts show idempotency and replay handling without exposing submitted customer payloads.
        </p>
        <table className="data-table" style={{ marginTop: 14 }}>
          <thead>
            <tr>
              <th>Created</th>
              <th>Source</th>
              <th>Idempotency Key</th>
              <th>Lead</th>
              <th>Customer</th>
              <th>Request Hash</th>
            </tr>
          </thead>
          <tbody>
            {receipts.length ? receipts.map((receipt) => (
              <tr key={receipt.id}>
                <td>{formatDate(receipt.createdAt)}</td>
                <td><code>{receipt.sourceId}</code></td>
                <td><code>{receipt.idempotencyKey}</code></td>
                <td>{receipt.createdLeadId ? <code>{receipt.createdLeadId}</code> : "-"}</td>
                <td>{receipt.createdCustomerId ? <code>{receipt.createdCustomerId}</code> : "-"}</td>
                <td><code>{receipt.requestHashPrefix}</code></td>
              </tr>
            )) : (
              <tr>
                <td colSpan={6} className="muted">No receipts yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
