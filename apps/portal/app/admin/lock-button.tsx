"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LockButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLock = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/lock", { method: "POST" });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Couldn’t lock admin.");
      }
      router.push("/admin/unlock");
    } catch (lockError) {
      setError(lockError instanceof Error ? lockError.message : "Couldn’t lock admin.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <button type="button" className="btn secondary" onClick={handleLock} disabled={loading}>
        {loading ? "Locking…" : "Lock admin"}
      </button>
      {error ? <p className="form-status">{error}</p> : null}
    </div>
  );
}
