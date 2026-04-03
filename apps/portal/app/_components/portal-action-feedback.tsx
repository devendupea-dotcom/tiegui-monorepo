"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

type FeedbackTone = "success" | "error";

type FeedbackState = {
  key: string;
  tone: FeedbackTone;
  message: string;
} | null;

function humanizeMessage(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const normalized = trimmed.replace(/[_-]+/g, " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function resolveFeedback(pathname: string, searchParams: URLSearchParams): FeedbackState {
  const error = searchParams.get("error");
  if (error) {
    const message = humanizeMessage(error);
    return {
      key: `${pathname}:error:${error}`,
      tone: "error",
      message: message.endsWith(".") ? message : `${message}.`,
    };
  }

  const successSignals: Array<{ param: string; message: string }> = [
    { param: "saved", message: "Changes saved." },
    { param: "validated", message: "Validation passed." },
    { param: "tested", message: "Test completed successfully." },
    { param: "created", message: "Created successfully." },
    { param: "updated", message: "Updated successfully." },
    { param: "deleted", message: "Removed successfully." },
    { param: "sent", message: "Sent successfully." },
    { param: "approved", message: "Approved successfully." },
    { param: "declined", message: "Declined successfully." },
    { param: "converted", message: "Converted successfully." },
  ];

  for (const signal of successSignals) {
    const value = searchParams.get(signal.param);
    if (!value) continue;
    return {
      key: `${pathname}:${signal.param}:${value}`,
      tone: "success",
      message: signal.message,
    };
  }

  const notice = searchParams.get("notice");
  if (notice) {
    return {
      key: `${pathname}:notice:${notice}`,
      tone: "success",
      message: notice,
    };
  }

  return null;
}

export default function PortalActionFeedback() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  const feedback = useMemo(
    () => resolveFeedback(pathname, new URLSearchParams(searchParams.toString())),
    [pathname, searchParams],
  );

  useEffect(() => {
    if (!feedback) {
      setVisible(false);
      return;
    }
    if (feedback.key !== dismissedKey) {
      setVisible(true);
    }
  }, [dismissedKey, feedback]);

  useEffect(() => {
    if (!feedback || !visible) return;
    const timeout = window.setTimeout(() => {
      setVisible(false);
      setDismissedKey(feedback.key);
    }, feedback.tone === "error" ? 8000 : 4200);
    return () => window.clearTimeout(timeout);
  }, [feedback, visible]);

  if (!feedback || !visible || feedback.key === dismissedKey) {
    return null;
  }

  return (
    <aside
      className={`portal-action-feedback ${feedback.tone}`}
      role={feedback.tone === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      <div className="portal-action-feedback-copy">
        <strong>{feedback.tone === "error" ? "Action blocked" : "Saved"}</strong>
        <p>{feedback.message}</p>
      </div>
      <button
        type="button"
        className="portal-action-feedback-close"
        aria-label="Dismiss message"
        onClick={() => {
          setVisible(false);
          setDismissedKey(feedback.key);
        }}
      >
        ×
      </button>
    </aside>
  );
}
