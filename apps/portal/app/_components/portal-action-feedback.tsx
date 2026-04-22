"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

type FeedbackTone = "success" | "error";

type FeedbackState = {
  key: string;
  tone: FeedbackTone;
  message: string;
} | null;

type SuccessMessages = {
  saved: string;
  validated: string;
  tested: string;
  created: string;
  updated: string;
  deleted: string;
  sent: string;
  approved: string;
  declined: string;
  converted: string;
};

function humanizeMessage(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const normalized = trimmed.replace(/[_-]+/g, " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function resolveFeedback(
  pathname: string,
  searchParams: URLSearchParams,
  successMessages: SuccessMessages,
): FeedbackState {
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
    { param: "saved", message: successMessages.saved },
    { param: "validated", message: successMessages.validated },
    { param: "tested", message: successMessages.tested },
    { param: "created", message: successMessages.created },
    { param: "updated", message: successMessages.updated },
    { param: "deleted", message: successMessages.deleted },
    { param: "sent", message: successMessages.sent },
    { param: "approved", message: successMessages.approved },
    { param: "declined", message: successMessages.declined },
    { param: "converted", message: successMessages.converted },
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
  const t = useTranslations("portalActionFeedback");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const successMessages = useMemo<SuccessMessages>(
    () => ({
      saved: t("success.saved"),
      validated: t("success.validated"),
      tested: t("success.tested"),
      created: t("success.created"),
      updated: t("success.updated"),
      deleted: t("success.deleted"),
      sent: t("success.sent"),
      approved: t("success.approved"),
      declined: t("success.declined"),
      converted: t("success.converted"),
    }),
    [t],
  );

  const feedback = useMemo(
    () => resolveFeedback(pathname, new URLSearchParams(searchParams.toString()), successMessages),
    [pathname, searchParams, successMessages],
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
        <strong>{feedback.tone === "error" ? t("titleError") : t("titleSuccess")}</strong>
        <p>{feedback.message}</p>
      </div>
      <button
        type="button"
        className="portal-action-feedback-close"
        aria-label={t("dismiss")}
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
