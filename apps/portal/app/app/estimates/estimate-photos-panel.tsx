"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { formatDateTimeForDisplay } from "@/lib/calendar/dates";

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
  copy: EstimatePhotosCopy;
  displayLocale: string;
};

type EstimatePhotosCopy = {
  sectionTitle: string;
  sectionBody: string;
  noLeadLinked: string;
  noLeadSelected: string;
  saveAfterAttachLead: string;
  saveLeadChange: string;
  uploaderTitle: string;
  uploaderBody: string;
  readOnlyUpload: string;
  galleryTitle: string;
  galleryDirty: string;
  galleryBody: string;
  loadingPhotos: string;
  noPhotosTitle: string;
  noPhotosBody: string;
  photoUnavailable: string;
  teamFallback: string;
  photoFile: string;
  captionOptional: string;
  captionPlaceholder: string;
  uploading: string;
  uploadPhoto: string;
  photoUploaded: string;
  couldntSavePhoto: string;
  couldntStartUpload: string;
  storageUploadFailed: string;
  couldntUploadPhoto: string;
  failedLoadPhotos: string;
};

function normalizeLeadId(value: string | null): string | null {
  const trimmed = value?.trim() || "";
  return trimmed || null;
}

function getEstimatePhotosCopy(locale: string): EstimatePhotosCopy {
  if (locale.startsWith("es")) {
    return {
      sectionTitle: "Fotos",
      sectionBody: "Mantén las fotos del sitio del estimado con el lead vinculado para que se conserven en la carpeta del trabajo.",
      noLeadLinked: "Aun no hay lead vinculado.",
      noLeadSelected: "Adjunta un lead a este estimado para guardar fotos con el registro del cliente y el trabajo futuro.",
      saveAfterAttachLead: "Guarda este estimado despues de adjuntar un lead para desbloquear las fotos del estimado.",
      saveLeadChange: "Guarda primero el cambio de lead para que las fotos se adjunten al registro correcto del cliente.",
      uploaderTitle: "Subir foto del estimado",
      uploaderBody: "Sube fotos de referencia, medidas y condiciones del sitio directamente desde este estimado.",
      readOnlyUpload: "Los usuarios de solo lectura no pueden subir fotos.",
      galleryTitle: "Galeria de fotos del estimado",
      galleryDirty: "Estas fotos pertenecen al lead guardado actualmente hasta que guardes la nueva seleccion de lead.",
      galleryBody: "El historial de fotos sigue compartido con el lead vinculado y el trabajo futuro.",
      loadingPhotos: "Cargando fotos...",
      noPhotosTitle: "Aun no hay fotos.",
      noPhotosBody: "Sube la primera foto del sitio desde esta vista del estimado.",
      photoUnavailable: "Foto no disponible.",
      teamFallback: "Equipo",
      photoFile: "Archivo de foto",
      captionOptional: "Descripcion (opcional)",
      captionPlaceholder: "Antes de la limpieza - patio lateral",
      uploading: "Subiendo...",
      uploadPhoto: "Subir foto",
      photoUploaded: "Foto subida.",
      couldntSavePhoto: "No se pudo guardar la foto.",
      couldntStartUpload: "No se pudo iniciar la carga de la foto.",
      storageUploadFailed: "Fallo la carga de la foto al almacenamiento.",
      couldntUploadPhoto: "No se pudo subir la foto.",
      failedLoadPhotos: "No se pudieron cargar las fotos del estimado.",
    };
  }

  return {
    sectionTitle: "Photos",
    sectionBody: "Keep estimate site photos with the linked lead so they carry forward into the job folder.",
    noLeadLinked: "No lead linked yet.",
    noLeadSelected: "Attach a lead to this estimate to store photos with the customer record and future job.",
    saveAfterAttachLead: "Save this estimate after attaching a lead to unlock estimate photos.",
    saveLeadChange: "Save the lead change first so photos attach to the right customer record.",
    uploaderTitle: "Upload Estimate Photo",
    uploaderBody: "Upload reference photos, measurements, and site conditions directly from the estimate.",
    readOnlyUpload: "Read-only users cannot upload photos.",
    galleryTitle: "Estimate Photo Gallery",
    galleryDirty: "These photos belong to the currently saved lead until you save the new lead selection.",
    galleryBody: "Photo history stays shared with the linked lead and future job.",
    loadingPhotos: "Loading photos...",
    noPhotosTitle: "No photos yet.",
    noPhotosBody: "Upload the first site photo from this estimate view.",
    photoUnavailable: "Photo unavailable.",
    teamFallback: "Team",
    photoFile: "Photo file",
    captionOptional: "Caption (optional)",
    captionPlaceholder: "Before cleanup - side yard",
    uploading: "Uploading...",
    uploadPhoto: "Upload Photo",
    photoUploaded: "Photo uploaded.",
    couldntSavePhoto: "Couldn't save photo.",
    couldntStartUpload: "Couldn't start photo upload.",
    storageUploadFailed: "Photo upload to storage failed.",
    couldntUploadPhoto: "Couldn't upload photo.",
    failedLoadPhotos: "Failed to load estimate photos.",
  };
}

function getLeadSyncMessage(input: {
  savedLeadId: string | null;
  pendingLeadId: string | null;
  copy: EstimatePhotosCopy;
}): string {
  const savedLeadId = normalizeLeadId(input.savedLeadId);
  const pendingLeadId = normalizeLeadId(input.pendingLeadId);

  if (!savedLeadId && pendingLeadId) {
    return input.copy.saveAfterAttachLead;
  }

  if (savedLeadId && pendingLeadId !== savedLeadId) {
    return input.copy.saveLeadChange;
  }

  return input.copy.noLeadSelected;
}

function EstimatePhotoUploader({
  estimateId,
  leadId,
  disabled,
  onUploaded,
  copy,
}: EstimatePhotoUploaderProps) {
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
      throw new Error(attached?.error || copy.couldntSavePhoto);
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
      throw new Error(signed?.error || copy.couldntStartUpload);
    }

    const uploadResponse = await fetch(signed.uploadUrl, {
      method: "PUT",
      headers: {
        "content-type": file.type,
      },
      body: file,
    });

    if (!uploadResponse.ok) {
      throw new Error(copy.storageUploadFailed);
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
      throw new Error(uploaded?.error || copy.couldntUploadPhoto);
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
          message.includes(copy.couldntStartUpload) ||
          message.includes(copy.storageUploadFailed);

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
      setSuccess(copy.photoUploaded);
      onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.couldntUploadPhoto);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="auth-form" style={{ marginTop: 12 }}>
      <label>
        {copy.photoFile}
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
        {copy.captionOptional}
        <input
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          maxLength={200}
          placeholder={copy.captionPlaceholder}
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
        {uploading ? copy.uploading : copy.uploadPhoto}
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
  const locale = useLocale();
  const copy = useMemo(() => getEstimatePhotosCopy(locale), [locale]);
  const displayLocale = locale.startsWith("es") ? "es-US" : "en-US";
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
          throw new Error(payload?.error || copy.failedLoadPhotos);
        }

        if (cancelled) return;
        setPhotos(payload.photos);
      } catch (loadError) {
        if (cancelled) return;
        setPhotos([]);
        setError(loadError instanceof Error ? loadError.message : copy.failedLoadPhotos);
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
  }, [copy, estimateId, normalizedSavedLeadId, refreshToken]);

  return (
    <section className="estimate-module-section">
      <div className="invoice-header-row">
        <div className="stack-cell">
          <h4>{copy.sectionTitle}</h4>
          <p className="muted">{copy.sectionBody}</p>
        </div>
      </div>

      {!normalizedSavedLeadId ? (
        <div className="portal-empty-state estimate-module-empty" style={{ marginTop: 12 }}>
          <strong>{copy.noLeadLinked}</strong>
          <p className="muted">{getLeadSyncMessage({ savedLeadId: normalizedSavedLeadId, pendingLeadId: normalizedPendingLeadId, copy })}</p>
        </div>
      ) : (
        <div className="grid two-col" style={{ marginTop: 12 }}>
          <article className="card">
            <h5 style={{ margin: 0 }}>{copy.uploaderTitle}</h5>
            <p className="muted" style={{ marginTop: 8 }}>
              {leadSelectionDirty
                ? getLeadSyncMessage({ savedLeadId: normalizedSavedLeadId, pendingLeadId: normalizedPendingLeadId, copy })
                : copy.uploaderBody}
            </p>

            {!canManage ? (
              <p className="muted" style={{ marginTop: 12 }}>{copy.readOnlyUpload}</p>
            ) : (
              <EstimatePhotoUploader
                estimateId={estimateId}
                leadId={normalizedSavedLeadId}
                disabled={!canUpload}
                onUploaded={() => setRefreshToken((current) => current + 1)}
                copy={copy}
                displayLocale={displayLocale}
              />
            )}
          </article>

          <article className="card">
            <h5 style={{ margin: 0 }}>{copy.galleryTitle}</h5>
            {leadSelectionDirty ? (
              <p className="muted" style={{ marginTop: 8 }}>
                {copy.galleryDirty}
              </p>
            ) : (
              <p className="muted" style={{ marginTop: 8 }}>{copy.galleryBody}</p>
            )}

            {loading ? (
              <div className="portal-empty-state estimate-module-empty" style={{ marginTop: 12 }}>
                <strong>{copy.loadingPhotos}</strong>
              </div>
            ) : error ? (
              <p className="form-status" style={{ marginTop: 12 }}>{error}</p>
            ) : photos.length === 0 ? (
              <div className="portal-empty-state estimate-module-empty" style={{ marginTop: 12 }}>
                <strong>{copy.noPhotosTitle}</strong>
                <p className="muted">{copy.noPhotosBody}</p>
              </div>
            ) : (
              <div className="photo-grid" style={{ marginTop: 12 }}>
                {photos.map((photo) => (
                  <figure key={photo.id} className="photo-item">
                    {photo.resolvedUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={photo.resolvedUrl}
                        alt={photo.caption || photo.fileName}
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <div className="muted" style={{ padding: 12 }}>{copy.photoUnavailable}</div>
                    )}
                    <figcaption>
                      <p>{photo.caption || photo.fileName}</p>
                      <p className="muted">
                        {formatDateTimeForDisplay(photo.createdAt, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        }, { locale: displayLocale })} • {photo.createdBy?.name || photo.createdBy?.email || copy.teamFallback}
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
