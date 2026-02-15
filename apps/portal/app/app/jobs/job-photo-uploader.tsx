"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type JobPhotoUploaderProps = {
  jobId: string;
};

export default function JobPhotoUploader({ jobId }: JobPhotoUploaderProps) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleUpload(file: File) {
    setUploading(true);
    setError(null);
    setSuccess(null);

    try {
      const signResponse = await fetch("/api/photos/sign-upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leadId: jobId,
          contentType: file.type,
          sizeBytes: file.size,
          originalName: file.name,
        }),
      });

      const signed = (await signResponse.json().catch(() => null)) as
        | {
            ok?: boolean;
            uploadUrl?: string;
            photoId?: string;
            error?: string;
          }
        | null;

      if (!signResponse.ok || !signed?.ok || !signed.uploadUrl || !signed.photoId) {
        throw new Error(signed?.error || "Couldn't start upload.");
      }

      const putResponse = await fetch(signed.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });

      if (!putResponse.ok) {
        throw new Error("Upload failed.");
      }

      const attachResponse = await fetch(`/api/jobs/${jobId}/photos`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ photoId: signed.photoId, caption: caption.trim() || null }),
      });

      const attached = (await attachResponse.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
          }
        | null;

      if (!attachResponse.ok || !attached?.ok) {
        throw new Error(attached?.error || "Couldn't attach photo to job.");
      }

      setCaption("");
      if (fileRef.current) {
        fileRef.current.value = "";
      }
      setSelectedFile(null);
      setSuccess("Photo uploaded.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't upload photo.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="auth-form" style={{ marginTop: 12 }}>
      <label>
        Photo file
        <input
          ref={fileRef}
          name="photoFile"
          type="file"
          accept="image/*"
          capture="environment"
          required
          disabled={uploading}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            setSelectedFile(file || null);
            setError(null);
            setSuccess(null);
          }}
        />
      </label>

      <label>
        Caption (optional)
        <input
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          maxLength={200}
          placeholder="Before cleanup - front yard"
          disabled={uploading}
        />
      </label>

      <button
        className="btn primary"
        type="button"
        disabled={uploading || !selectedFile}
        onClick={() => {
          if (!selectedFile) return;
          void handleUpload(selectedFile);
        }}
      >
        {uploading ? "Uploading..." : "Upload Photo"}
      </button>

      {success ? <p className="form-status">{success}</p> : null}
      {error ? <p className="form-status">{error}</p> : null}
    </div>
  );
}
