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
      const formData = new FormData();
      formData.set("photoFile", file);
      if (caption.trim()) {
        formData.set("caption", caption.trim());
      }

      const uploadResponse = await fetch(`/api/jobs/${jobId}/photos`, {
        method: "POST",
        body: formData,
      });

      const uploaded = (await uploadResponse.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
          }
        | null;

      if (!uploadResponse.ok || !uploaded?.ok) {
        throw new Error(uploaded?.error || "Couldn't upload photo.");
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
