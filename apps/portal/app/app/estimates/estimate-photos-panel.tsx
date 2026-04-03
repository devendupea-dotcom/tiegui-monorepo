"use client";

import { useEffect, useRef, useState } from "react";

type EstimatePhotosPanelProps = {
  estimateId: string;
  savedLeadId: string | null;
  pendingLeadId: string | null;
  canManage: boolean;
};

type EstimatePhoto = {
  id: string;
  photoId: string | null;
  fileName: string;
  mimeType: string;
  imageDataUrl: string | null;
  caption: string | null;
  createdAt: string;
  resolvedUrl: string | null;
  createdBy:
    | {
        id: string;
        name: string | null;
        email: string | null;
      }
    | null
    | undefined;
};

type EstimatePhotosResponse =
  | {
      ok?: boolean;
      photos?: EstimatePhoto[];
      error?: string;
    }
  | null;

type UploadResponse =
  | {
      ok?: boolean;
      error?: string;
    }
  | null;

type SignUploadResponse =
  | {
      ok?: boolean;
      uploadUrl?: string;
      photoId?: string;
      error?: string;
    }
  | null;

type EstimatePhotoUploaderProps = {
  estimateId: string;
  leadId: string;
  disabled: boolean;
  onUploaded: () => void;
};

function normalizeLeadId(value: string | null): string | null {
  const trimmed = value?.trim() || "";
  return trimmed || null;
}

function getLeadSyncMessage(input: {
  savedLeadId: string | null;
  pendingLeadId: string | null;
}): string {
  const savedLeadId = normalizeLeadId(input.savedLeadId);
  const pendingLeadId = normalizeLeadId(input.pendingLeadId);

  if (!savedLeadId && pendingLeadId) {
    return "Save this estimate after attaching a lead to unlock estimate photos.";
  }

  if (savedLeadId && pendingLeadId !== savedLeadId) {
    return "Save the lead change first so photos attach to the right customer record.";
  }

  return "Attach a lead to this estimate to store photos with the customer record and future job.";
}

function EstimatePhotoUploader({ estimateId, leadId, disabled, onUploaded }: EstimatePhotoUploaderProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function attachUploadedPhoto(photoId: string) {
    const attachResponse = await fetch(`/api/estimates/${estimateId}/photos`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        photoId,
        caption: caption.trim() || null,
      }),
    });

    const attached = (await attachResponse.json().catch(() => null)) as UploadResponse;
    if (!attachResponse.ok || !attached?.ok) {
      throw new Error(attached?.error || "Couldn't save photo.");
    }
  }

  async function uploadViaSignedUrl(file: File) {
    const signResponse = await fetch("/api/photos/sign-upload", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        leadId,
        contentType: file.type,
        sizeBytes: file.size,
        originalName: file.name,
      }),
    });

    const signed = (await signResponse.json().catch(() => null)) as SignUploadResponse;
    if (!signResponse.ok || !signed?.ok || !signed.uploadUrl || !signed.photoId) {
      throw new Error(signed?.error || "Couldn't start photo upload.");
    }

    const uploadResponse = await fetch(signed.uploadUrl, {
      method: "PUT",
      headers: {
        "content-type": file.type,
      },
      body: file,
    });

    if (!uploadResponse.ok) {
      throw new Error("Photo upload to storage failed.");
    }

    await attachUploadedPhoto(signed.photoId);
  }

  async function uploadDirectly(file: File) {
    const formData = new FormData();
    formData.set("photoFile", file);
    if (caption.trim()) {
      formData.set("caption", caption.trim());
    }

    const uploadResponse = await fetch(`/api/estimates/${estimateId}/photos`, {
      method: "POST",
      body: formData,
    });

    const uploaded = (await uploadResponse.json().catch(() => null)) as UploadResponse;
    if (!uploadResponse.ok || !uploaded?.ok) {
      throw new Error(uploaded?.error || "Couldn't upload photo.");
    }
  }

  async function handleUpload(file: File) {
    setUploading(true);
    setError(null);
    setSuccess(null);

    try {
      try {
        await uploadViaSignedUrl(file);
      } catch (signedUploadError) {
        const message = signedUploadError instanceof Error ? signedUploadError.message : "";
        const canFallback =
          message.includes("Object storage is unavailable") ||
          message.includes("Couldn't start photo upload.") ||
          message.includes("Photo upload to storage failed.");

        if (!canFallback) {
          throw signedUploadError;
        }

        await uploadDirectly(file);
      }

      setCaption("");
      if (fileRef.current) {
        fileRef.current.value = "";
      }
      setSelectedFile(null);
      setSuccess("Photo uploaded.");
      onUploaded();
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
          disabled={disabled || uploading}
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
          placeholder="Before cleanup - side yard"
          disabled={disabled || uploading}
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
        {uploading ? "Uploading..." : "Upload Photo"}
      </button>

      {success ? <p className="form-status">{success}</p> : null}
      {error ? <p className="form-status">{error}</p> : null}
    </div>
  );
}

export default function EstimatePhotosPanel({
  estimateId,
  savedLeadId,
  pendingLeadId,
  canManage,
}: EstimatePhotosPanelProps) {
  const [photos, setPhotos] = useState<EstimatePhoto[]>([]);
  const [loading, setLoading] = useState(Boolean(savedLeadId));
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const normalizedSavedLeadId = normalizeLeadId(savedLeadId);
  const normalizedPendingLeadId = normalizeLeadId(pendingLeadId);
  const leadSelectionDirty = normalizedSavedLeadId !== normalizedPendingLeadId;
  const canUpload = Boolean(normalizedSavedLeadId) && !leadSelectionDirty;

  useEffect(() => {
    if (!normalizedSavedLeadId) {
      setPhotos([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    async function loadPhotos() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/estimates/${estimateId}/photos`, {
          method: "GET",
          cache: "no-store",
        });

        const payload = (await response.json().catch(() => null)) as EstimatePhotosResponse;
        if (!response.ok || !payload?.ok || !Array.isArray(payload.photos)) {
          throw new Error(payload?.error || "Failed to load estimate photos.");
        }

        if (cancelled) return;
        setPhotos(payload.photos);
      } catch (loadError) {
        if (cancelled) return;
        setPhotos([]);
        setError(loadError instanceof Error ? loadError.message : "Failed to load estimate photos.");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadPhotos();
    return () => {
      cancelled = true;
    };
  }, [estimateId, normalizedSavedLeadId, refreshToken]);

  return (
    <section className="estimate-module-section">
      <div className="invoice-header-row">
        <div className="stack-cell">
          <h4>Photos</h4>
          <p className="muted">Keep estimate site photos with the linked lead so they carry forward into the job folder.</p>
        </div>
      </div>

      {!normalizedSavedLeadId ? (
        <div className="portal-empty-state estimate-module-empty" style={{ marginTop: 12 }}>
          <strong>No lead linked yet.</strong>
          <p className="muted">{getLeadSyncMessage({ savedLeadId: normalizedSavedLeadId, pendingLeadId: normalizedPendingLeadId })}</p>
        </div>
      ) : (
        <div className="grid two-col" style={{ marginTop: 12 }}>
          <article className="card">
            <h5 style={{ margin: 0 }}>Upload Estimate Photo</h5>
            <p className="muted" style={{ marginTop: 8 }}>
              {leadSelectionDirty
                ? getLeadSyncMessage({ savedLeadId: normalizedSavedLeadId, pendingLeadId: normalizedPendingLeadId })
                : "Upload reference photos, measurements, and site conditions directly from the estimate."}
            </p>

            {!canManage ? (
              <p className="muted" style={{ marginTop: 12 }}>Read-only users cannot upload photos.</p>
            ) : (
              <EstimatePhotoUploader
                estimateId={estimateId}
                leadId={normalizedSavedLeadId}
                disabled={!canUpload}
                onUploaded={() => setRefreshToken((current) => current + 1)}
              />
            )}
          </article>

          <article className="card">
            <h5 style={{ margin: 0 }}>Estimate Photo Gallery</h5>
            {leadSelectionDirty ? (
              <p className="muted" style={{ marginTop: 8 }}>
                These photos belong to the currently saved lead until you save the new lead selection.
              </p>
            ) : (
              <p className="muted" style={{ marginTop: 8 }}>Photo history stays shared with the linked lead and future job.</p>
            )}

            {loading ? (
              <div className="portal-empty-state estimate-module-empty" style={{ marginTop: 12 }}>
                <strong>Loading photos...</strong>
              </div>
            ) : error ? (
              <p className="form-status" style={{ marginTop: 12 }}>{error}</p>
            ) : photos.length === 0 ? (
              <div className="portal-empty-state estimate-module-empty" style={{ marginTop: 12 }}>
                <strong>No photos yet.</strong>
                <p className="muted">Upload the first site photo from this estimate view.</p>
              </div>
            ) : (
              <div className="photo-grid" style={{ marginTop: 12 }}>
                {photos.map((photo) => (
                  <figure key={photo.id} className="photo-item">
                    {photo.resolvedUrl ? (
                      <img src={photo.resolvedUrl} alt={photo.caption || photo.fileName} loading="lazy" />
                    ) : (
                      <div className="muted" style={{ padding: 12 }}>Photo unavailable.</div>
                    )}
                    <figcaption>
                      <p>{photo.caption || photo.fileName}</p>
                      <p className="muted">
                        {new Date(photo.createdAt).toLocaleString()} • {photo.createdBy?.name || photo.createdBy?.email || "Team"}
                      </p>
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </article>
        </div>
      )}
    </section>
  );
}
