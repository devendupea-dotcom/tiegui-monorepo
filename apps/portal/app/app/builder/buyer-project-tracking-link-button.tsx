"use client";

import { useState } from "react";

type TrackingLinkResponse = {
  ok?: boolean;
  error?: string;
  tracking?: {
    url?: string;
    smsDraft?: string;
  };
};

export default function BuyerProjectTrackingLinkButton({
  buyerProjectId,
}: {
  buyerProjectId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trackingUrl, setTrackingUrl] = useState<string | null>(null);

  async function handleCopyTrackingText() {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    setError(null);

    try {
      const response = await fetch(
        `/api/buyer-projects/${encodeURIComponent(buyerProjectId)}/tracking-link`,
        { method: "POST" },
      );
      const payload = (await response.json().catch(() => null)) as TrackingLinkResponse | null;
      const url = payload?.tracking?.url || "";
      const smsDraft = payload?.tracking?.smsDraft || url;
      if (!response.ok || !payload?.ok || !url) {
        throw new Error(payload?.error || "Failed to create tracking link.");
      }

      setTrackingUrl(url);
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(smsDraft);
        setNotice("Tracking text copied.");
      } else {
        setNotice("Tracking link generated below.");
      }
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : "Failed to copy tracking text.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-cell">
      <button
        className="btn primary"
        type="button"
        disabled={busy}
        onClick={() => void handleCopyTrackingText()}
      >
        {busy ? "Preparing..." : "Copy Tracking Text"}
      </button>
      {notice ? <span className="form-status">{notice}</span> : null}
      {error ? <span className="form-status error">{error}</span> : null}
      {trackingUrl ? (
        <input
          aria-label="Generated buyer project tracking link"
          readOnly
          value={trackingUrl}
        />
      ) : null}
    </div>
  );
}
