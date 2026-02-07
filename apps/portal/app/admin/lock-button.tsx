"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LockButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleLock = async () => {
    if (loading) return;
    setLoading(true);
    try {
      await fetch("/api/admin/lock", { method: "POST" });
    } finally {
      router.push("/admin/unlock");
      setLoading(false);
    }
  };

  return (
    <button type="button" className="btn secondary" onClick={handleLock} disabled={loading}>
      {loading ? "Locking…" : "Lock admin"}
    </button>
  );
}

