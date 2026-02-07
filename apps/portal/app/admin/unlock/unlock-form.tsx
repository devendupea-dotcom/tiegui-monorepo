"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function UnlockForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "/admin";

  const [key, setKey] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setStatus("Unlocking…");

    try {
      const response = await fetch("/api/admin/unlock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        setStatus(data.error || "Couldn’t unlock admin.");
        setSubmitting(false);
        return;
      }

      router.push(nextPath);
    } catch {
      setStatus("Couldn’t unlock admin. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={handleSubmit} style={{ marginTop: 14 }}>
      <label>
        Admin vault key
        <input
          type="password"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder="Enter the vault key"
          required
          disabled={submitting}
        />
      </label>
      <button className="btn primary" type="submit" disabled={submitting}>
        Unlock admin
      </button>
      {status && <p className="form-status">{status}</p>}
    </form>
  );
}

