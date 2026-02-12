"use client";

import { useState } from "react";

type RoundRobinTestResult = {
  ok?: boolean;
  error?: string;
  pass?: boolean;
  summary?: string;
  assignments?: Array<{
    turn: number;
    workerName: string;
  }>;
  skippedUnavailableWorkers?: Array<{ id: string; name: string }>;
};

export default function RoundRobinTestCard({ orgId }: { orgId: string }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RoundRobinTestResult | null>(null);

  async function runDiagnostic() {
    if (running) return;
    setRunning(true);
    setResult(null);
    try {
      const response = await fetch("/api/internal/diagnostics/round-robin-test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId,
          iterations: 6,
          lookaheadDays: 7,
          durationMinutes: 30,
        }),
      });
      const payload = (await response.json().catch(() => null)) as RoundRobinTestResult | null;
      setResult(payload || { ok: false, error: "Unexpected response." });
    } catch {
      setResult({ ok: false, error: "Failed to run round-robin test." });
    } finally {
      setRunning(false);
    }
  }

  return (
    <article className="card">
      <h2>Round-Robin Verification</h2>
      <p className="muted">
        INTERNAL diagnostic: runs 6 deterministic scheduling turns and validates rotation with unavailable workers skipped.
      </p>
      <button type="button" className="btn secondary" onClick={() => void runDiagnostic()} disabled={running}>
        {running ? "Running test..." : "Run RR test"}
      </button>
      {result?.error ? <p className="form-status">{result.error}</p> : null}
      {result?.ok ? (
        <div className="stack-cell" style={{ marginTop: 10 }}>
          <span className={`badge ${result.pass ? "status-success" : "status-error"}`}>
            {result.pass ? "PASS" : "CHECK"}
          </span>
          <p className="muted">{result.summary || "No assignments produced."}</p>
          {result.assignments && result.assignments.length > 0 ? (
            <p className="muted">
              Sequence:{" "}
              {result.assignments.map((item) => `${item.turn}:${item.workerName}`).join(" -> ")}
            </p>
          ) : null}
          {result.skippedUnavailableWorkers && result.skippedUnavailableWorkers.length > 0 ? (
            <p className="muted">
              Skipped unavailable: {result.skippedUnavailableWorkers.map((item) => item.name).join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
