"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type OrgLogoUploaderProps = {
  orgId: string;
  disabled?: boolean;
};

type SignedUrlResponse =
  | {
      ok?: boolean;
      url?: string | null;
      error?: string;
    }
  | null;

export default function OrgLogoUploader({ orgId, disabled }: OrgLogoUploaderProps) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function refreshSignedUrl() {
    try {
      const res = await fetch(`/api/branding/logo/signed-url?orgId=${encodeURIComponent(orgId)}`, {
        method: "GET",
      });
      const data = (await res.json().catch(() => null)) as SignedUrlResponse;
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Couldn't load logo preview.");
      }
      setLogoUrl(typeof data.url === "string" ? data.url : null);
    } catch (err) {
      setLogoUrl(null);
    }
  }

  useEffect(() => {
    void refreshSignedUrl();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  async function handleUpload(file: File) {
    setUploading(true);
    setError(null);
    setSuccess(null);

    try {
      const formData = new FormData();
      formData.set("orgId", orgId);
      formData.set("logo", file);

      const attachResponse = await fetch("/api/branding/logo", {
        method: "POST",
        body: formData,
      });

      const attached = (await attachResponse.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
          }
        | null;

      if (!attachResponse.ok || !attached?.ok) {
        throw new Error(attached?.error || "Couldn't save logo.");
      }

      if (fileRef.current) {
        fileRef.current.value = "";
      }
      setSelectedFile(null);
      setSuccess("Logo updated.");
      await refreshSignedUrl();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't upload logo.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="auth-form" style={{ marginTop: 12 }}>
      {logoUrl ? (
        <div className="surface-preview-card">
          <strong>Current logo preview</strong>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoUrl}
            alt="Organization logo"
            style={{ maxHeight: 60, maxWidth: 220, objectFit: "contain" }}
          />
        </div>
      ) : (
        <p className="muted" style={{ marginTop: 0 }}>
          No logo uploaded yet.
        </p>
      )}

      <label>
        Upload logo (PNG/JPG/WebP)
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={disabled || uploading}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            setSelectedFile(file || null);
            setError(null);
            setSuccess(null);
          }}
        />
      </label>

      <button
        className="btn primary"
        type="button"
        disabled={disabled || uploading || !selectedFile}
        onClick={() => {
          if (!selectedFile) return;
          void handleUpload(selectedFile);
        }}
      >
        {uploading ? "Uploading..." : "Upload Logo"}
      </button>

      {success ? <p className="form-status">{success}</p> : null}
      {error ? <p className="form-status">{error}</p> : null}
    </div>
  );
}
