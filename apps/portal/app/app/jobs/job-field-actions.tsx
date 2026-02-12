"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  enqueueOfflineMutation,
  getOfflineOutboxCount,
  subscribeOfflineOutbox,
} from "../_lib/offline-outbox";

type JobFieldActionsProps = {
  jobId: string;
  voiceNotesEnabled: boolean;
  offlineModeEnabled: boolean;
};

export default function JobFieldActions({ jobId, voiceNotesEnabled, offlineModeEnabled }: JobFieldActionsProps) {
  const router = useRouter();
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<BlobPart[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordStartedAtRef = useRef<number>(0);
  const [noteBody, setNoteBody] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [retryNote, setRetryNote] = useState<string | null>(null);
  const [retryPhoto, setRetryPhoto] = useState<File | null>(null);
  const [retryAudio, setRetryAudio] = useState<{ blob: Blob; durationSeconds: number } | null>(null);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refreshPendingCount() {
      const next = await getOfflineOutboxCount(jobId);
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
  }, [jobId]);

  async function saveNote(body: string) {
    setSavingNote(true);
    setFeedback(null);
    try {
      const response = await fetch(`/api/jobs/${jobId}/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
          }
        | null;

      if (!response.ok || !payload?.ok) {
        setRetryNote(body);
        setFeedback(payload?.error || "Couldn't save - retry.");
        return;
      }

      setRetryNote(null);
      setNoteBody("");
      setFeedback("Note saved.");
      router.refresh();
    } catch {
      if (offlineModeEnabled) {
        try {
          await enqueueOfflineMutation({
            action: "appendJobNote",
            jobId,
            endpoint: `/api/jobs/${jobId}/notes`,
            method: "POST",
            body: { body },
          });
          setRetryNote(null);
          setNoteBody("");
          setFeedback("Saved offline. Syncing when online.");
          return;
        } catch {
          setRetryNote(body);
          setFeedback("Couldn't save - retry.");
          return;
        }
      }

      setRetryNote(body);
      setFeedback("Couldn't save - retry.");
    } finally {
      setSavingNote(false);
    }
  }

  async function uploadPhoto(file: File) {
    setUploadingPhoto(true);
    setFeedback(null);
    try {
      const formData = new FormData();
      formData.set("photo", file);

      const response = await fetch(`/api/jobs/${jobId}/photos`, {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
          }
        | null;

      if (!response.ok || !payload?.ok) {
        setRetryPhoto(file);
        setFeedback(payload?.error || "Couldn't save - retry.");
        return;
      }

      setRetryPhoto(null);
      setFeedback("Photo uploaded.");
      router.refresh();
    } catch {
      setRetryPhoto(file);
      setFeedback("Couldn't save - retry.");
    } finally {
      setUploadingPhoto(false);
      if (photoInputRef.current) {
        photoInputRef.current.value = "";
      }
    }
  }

  async function transcribeAndSave(blob: Blob, durationSeconds: number) {
    setTranscribing(true);
    setFeedback(null);

    try {
      const file = new File([blob], "voice-note.webm", { type: blob.type || "audio/webm" });
      const formData = new FormData();
      formData.set("jobId", jobId);
      formData.set("audio", file);
      formData.set("durationSeconds", String(Math.max(1, Math.round(durationSeconds))));

      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            text?: string;
            error?: string;
          }
        | null;

      if (!response.ok || !payload?.ok || !payload.text) {
        setRetryAudio({ blob, durationSeconds });
        setFeedback(payload?.error || "Transcription failed. Tap Retry.");
        return;
      }

      await saveNote(payload.text.trim());
      setRetryAudio(null);
      setFeedback("Voice note transcribed and saved.");
    } catch {
      setRetryAudio({ blob, durationSeconds });
      setFeedback("Transcription failed. Tap Retry.");
    } finally {
      setTranscribing(false);
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  }

  async function startRecording() {
    if (!voiceNotesEnabled || recording || transcribing) return;
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setFeedback("Voice recording is not supported on this device.");
      return;
    }

    setFeedback(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      mediaChunksRef.current = [];
      recordStartedAtRef.current = Date.now();

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          mediaChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const startedAt = recordStartedAtRef.current || Date.now();
        const durationSeconds = Math.max(1, (Date.now() - startedAt) / 1000);
        const blob = new Blob(mediaChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        mediaChunksRef.current = [];
        mediaRecorderRef.current = null;
        setRecording(false);
        for (const track of stream.getTracks()) {
          track.stop();
        }
        mediaStreamRef.current = null;
        if (blob.size > 0) {
          void transcribeAndSave(blob, durationSeconds);
        } else {
          setFeedback("No audio captured. Try again.");
        }
      };

      recorder.start();
      setRecording(true);
    } catch {
      setFeedback("Could not start microphone recording.");
      setRecording(false);
    }
  }

  return (
    <section className="job-field-actions">
      <h3>Field Actions</h3>
      <div className="job-field-actions-grid">
        <label className="job-note-input">
          <span>Quick note</span>
          <textarea
            value={noteBody}
            onChange={(event) => setNoteBody(event.target.value)}
            rows={3}
            maxLength={4000}
            placeholder="Add a quick field update (what happened + next step). Example: Homeowner approved estimate, crew arriving Fri 9:00 AM."
          />
        </label>
        <div className="job-field-action-row">
          <button
            type="button"
            className="btn primary"
            onClick={() => void saveNote(noteBody.trim())}
            disabled={savingNote || !noteBody.trim()}
          >
            {savingNote ? "Saving..." : "Save Note"}
          </button>

          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="job-photo-input"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (!file) return;
              void uploadPhoto(file);
            }}
            disabled={uploadingPhoto}
          />
          <button
            type="button"
            className="btn secondary"
            onClick={() => photoInputRef.current?.click()}
            disabled={uploadingPhoto}
          >
            {uploadingPhoto ? "Uploading..." : "Add Photo"}
          </button>
          {voiceNotesEnabled ? (
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                if (recording) {
                  stopRecording();
                } else {
                  void startRecording();
                }
              }}
              disabled={transcribing}
            >
              {recording ? "Stop Mic" : transcribing ? "Transcribing..." : "Mic"}
            </button>
          ) : null}
        </div>
        {(retryNote || retryPhoto || retryAudio) && !savingNote && !uploadingPhoto && !transcribing ? (
          <button
            type="button"
            className="btn secondary"
            onClick={() => {
              if (retryNote) {
                void saveNote(retryNote);
                return;
              }
              if (retryPhoto) {
                void uploadPhoto(retryPhoto);
                return;
              }
              if (retryAudio) {
                void transcribeAndSave(retryAudio.blob, retryAudio.durationSeconds);
              }
            }}
          >
            Retry
          </button>
        ) : null}
        {offlineModeEnabled && pendingSyncCount > 0 ? (
          <p className="form-status">Pending sync: {pendingSyncCount}</p>
        ) : null}
        {feedback ? <p className="form-status">{feedback}</p> : null}
      </div>
    </section>
  );
}
