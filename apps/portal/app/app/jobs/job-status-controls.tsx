"use client";

import { useEffect, useMemo, useState } from "react";
import {
  enqueueOfflineMutation,
  getOfflineOutboxCount,
  subscribeOfflineOutbox,
} from "../_lib/offline-outbox";

type JobStatusControlsProps = {
  operationalJobId: string | null;
  hasActiveBooking: boolean;
  initialStatus: string;
  offlineModeEnabled: boolean;
};

type MutableStatus = "scheduled" | "on_the_way" | "on_site" | "completed" | "canceled";

type StatusOption = {
  value: MutableStatus;
  label: string;
};

const STATUS_OPTIONS: StatusOption[] = [
  { value: "scheduled", label: "Scheduled" },
  { value: "on_the_way", label: "On The Way" },
  { value: "on_site", label: "On Site" },
  { value: "completed", label: "Completed" },
  { value: "canceled", label: "Canceled" },
];

function normalizeStatus(value: string): MutableStatus {
  const normalized = value.trim().toLowerCase();
  return STATUS_OPTIONS.some((option) => option.value === normalized)
    ? (normalized as MutableStatus)
    : "scheduled";
}

export default function JobStatusControls({
  operationalJobId,
  hasActiveBooking,
  initialStatus,
  offlineModeEnabled,
}: JobStatusControlsProps) {
  const [currentStatus, setCurrentStatus] = useState<MutableStatus>(normalizeStatus(initialStatus));
  const [saving, setSaving] = useState(false);
  const [pendingRetryStatus, setPendingRetryStatus] = useState<MutableStatus | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusToast, setStatusToast] = useState<{ tone: "ok" | "error"; message: string } | null>(null);
  const [inputFocused, setInputFocused] = useState(false);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);

  const statusIndex = useMemo(
    () => STATUS_OPTIONS.findIndex((option) => option.value === currentStatus),
    [currentStatus],
  );
  const currentStatusLabel = STATUS_OPTIONS[statusIndex]?.label || "Scheduled";

  useEffect(() => {
    if (!statusToast) return;
    const timer = setTimeout(() => setStatusToast(null), 2800);
    return () => clearTimeout(timer);
  }, [statusToast]);

  useEffect(() => {
    let cancelled = false;

    async function refreshPendingCount() {
      if (!operationalJobId) {
        setPendingSyncCount(0);
        return;
      }
      const next = await getOfflineOutboxCount(operationalJobId);
      if (!cancelled) {
        setPendingSyncCount(next);
      }
    }

    void refreshPendingCount();
    const unsubscribe = subscribeOfflineOutbox(() => {
      void refreshPendingCount();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [operationalJobId]);

  useEffect(() => {
    function onFocusIn(event: FocusEvent) {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName.toLowerCase();
      const editingTarget =
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        target.getAttribute("contenteditable") === "true";
      setInputFocused(editingTarget);
    }

    function onFocusOut() {
      window.setTimeout(() => {
        const active = document.activeElement as HTMLElement | null;
        if (!active) {
          setInputFocused(false);
          return;
        }
        const tag = active.tagName.toLowerCase();
        const editingTarget =
          tag === "input" ||
          tag === "textarea" ||
          tag === "select" ||
          active.getAttribute("contenteditable") === "true";
        setInputFocused(editingTarget);
      }, 0);
    }

    window.addEventListener("focusin", onFocusIn);
    window.addEventListener("focusout", onFocusOut);
    return () => {
      window.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  async function pushStatus(nextStatus: MutableStatus) {
    if (saving) return;
    if (!operationalJobId) {
      setStatusMessage("Create or link an operational job before changing execution status.");
      setStatusToast({
        tone: "error",
        message: "Schedule or link an operational job first.",
      });
      return;
    }
    if (!hasActiveBooking && ["on_the_way", "on_site", "completed"].includes(nextStatus)) {
      setStatusMessage("Schedule the work in Calendar before moving it into execution.");
      setStatusToast({
        tone: "error",
        message: "A real booking is required before advancing execution.",
      });
      return;
    }

    setSaving(true);
    setCurrentStatus(nextStatus);
    setStatusMessage(null);
    setStatusToast(null);

    try {
      const response = await fetch(`/api/dispatch/jobs/${operationalJobId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: nextStatus,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
            job?: { status?: string };
          }
        | null;

      if (!response.ok || !payload?.ok) {
        setPendingRetryStatus(nextStatus);
        setStatusMessage(payload?.error || "Couldn't save - retry.");
        setStatusToast({
          tone: "error",
          message: "Couldn't save status. Tap Retry.",
        });
        return;
      }

      if (payload.job?.status) {
        setCurrentStatus(normalizeStatus(payload.job.status));
      }

      setPendingRetryStatus(null);
      setStatusMessage("Status saved.");
        setStatusToast({
          tone: "ok",
          message: `${STATUS_OPTIONS.find((option) => option.value === normalizeStatus(payload.job?.status || nextStatus))?.label || "Status"} saved`,
        });
    } catch {
      if (offlineModeEnabled) {
        try {
          await enqueueOfflineMutation({
            action: "updateJobStatus",
            jobId: operationalJobId,
            endpoint: `/api/dispatch/jobs/${operationalJobId}`,
            method: "PATCH",
            body: {
              status: nextStatus,
            },
          });
          setPendingRetryStatus(null);
          setStatusMessage("Saved offline. Syncing when online.");
          setStatusToast({
            tone: "ok",
            message: "Saved offline. Will sync when online.",
          });
          return;
        } catch {
          setPendingRetryStatus(nextStatus);
          setStatusMessage("Couldn't save - retry.");
          setStatusToast({
            tone: "error",
            message: "Couldn't save status. Tap Retry.",
          });
          return;
        }
      }

      setPendingRetryStatus(nextStatus);
      setStatusMessage("Couldn't save - retry.");
      setStatusToast({
        tone: "error",
        message: "Couldn't save status. Tap Retry.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="job-status-controls">
      <div className="job-status-chip-row">
        {STATUS_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`job-status-chip ${currentStatus === option.value ? "active" : ""}`}
            onClick={() => void pushStatus(option.value)}
            disabled={saving}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="job-status-meta">
        <span className={`badge job-current-status-badge status-${currentStatus.toLowerCase()}`}>
          {currentStatusLabel}
          {saving ? " • Saving..." : ""}
        </span>
        {pendingRetryStatus ? (
          <button type="button" className="btn secondary" onClick={() => void pushStatus(pendingRetryStatus)} disabled={saving}>
            Retry
          </button>
        ) : null}
      </div>

      {offlineModeEnabled && pendingSyncCount > 0 ? (
        <p className="form-status">Pending sync: {pendingSyncCount}</p>
      ) : null}
      {statusMessage ? <p className="form-status">{statusMessage}</p> : null}

      <div className={`job-complete-sticky ${inputFocused ? "hidden" : ""}`}>
        <button
          type="button"
          className="btn primary job-complete-btn"
          onClick={() => void pushStatus("completed")}
          disabled={saving || currentStatus === "completed"}
        >
          Mark Complete
        </button>
      </div>

      {statusToast ? (
        <aside className={`job-status-toast ${statusToast.tone}`} role="status" aria-live="polite">
          <p>{statusToast.message}</p>
        </aside>
      ) : null}
    </section>
  );
}
