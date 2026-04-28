"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type SendInvoiceModalProps = {
  businessName: string;
  buttonClassName?: string;
  buttonLabel?: string;
  customerEmail?: string | null;
  customerName: string;
  defaultRefreshPayLink?: boolean;
  invoiceNumber: string;
  mode?: "invoice" | "reminder";
  onlinePaymentsAvailable?: boolean;
  previewHref: string;
  sendHref: string;
};

type SendInvoiceResponse = {
  error?: string;
  ok?: boolean;
  sentAt?: string;
  status?: string;
  success?: boolean;
};

type SendInvoicePayload = {
  message?: string;
  mode?: "invoice" | "reminder";
  refreshPayLink?: boolean;
};

export default function SendInvoiceModal({
  businessName,
  buttonClassName = "btn primary",
  buttonLabel,
  customerEmail,
  customerName,
  defaultRefreshPayLink = false,
  invoiceNumber,
  mode = "invoice",
  onlinePaymentsAvailable = false,
  previewHref,
  sendHref,
}: SendInvoiceModalProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(createSendAttemptKey);
  const [refreshPayLink, setRefreshPayLink] = useState(false);

  const normalizedCustomerEmail = customerEmail?.trim() || "";
  const canSend = normalizedCustomerEmail.length > 0;
  const sendCompleted = success !== null;
  const reminderMode = mode === "reminder";
  const subject = reminderMode
    ? `Payment reminder: Invoice #${invoiceNumber} from ${businessName}`
    : `Invoice #${invoiceNumber} from ${businessName}`;
  const recipientLabel = canSend
    ? `${customerName} (${normalizedCustomerEmail})`
    : `${customerName} (No email on file)`;
  const modalTitle = reminderMode ? "Send Reminder" : "Send Invoice";
  const modalDescription = reminderMode
    ? onlinePaymentsAvailable
      ? "Email a payment reminder from the workspace. This reminder can include a fresh hosted Stripe pay link."
      : "Email a payment reminder from the workspace. Payment collection is still tracked separately."
    : onlinePaymentsAvailable
      ? "Email the customer a PDF copy from the workspace. This email will also include a hosted Stripe pay link."
      : "Email the customer a PDF copy from the workspace. Payment collection is still tracked separately.";
  const messagePlaceholder = reminderMode
    ? "Just a quick reminder that this invoice is still open. Let us know if you need anything."
    : "Thanks for the opportunity. Let us know if you have any questions.";
  const freshPayLinkLabel = reminderMode
    ? "Create a fresh hosted pay link before sending this reminder."
    : "Create a fresh hosted pay link before sending this email.";
  const sendButtonLabel = reminderMode ? "Send Reminder ->" : "Send Invoice ->";

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !sending) {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, sending]);

  function closeModal() {
    if (sending) {
      return;
    }

    setOpen(false);
  }

  function openModal() {
    setError(null);
    setSuccess(null);
    setIdempotencyKey(createSendAttemptKey());
    setRefreshPayLink(defaultRefreshPayLink);
    setOpen(true);
  }

  function handlePreviewPdf() {
    window.open(previewHref, "_blank", "noopener,noreferrer");
  }

  async function handleSendInvoice() {
    if (!canSend || sending || sendCompleted) {
      return;
    }

    setSending(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(sendHref, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          message: message.trim() || undefined,
          mode,
          refreshPayLink,
        } satisfies SendInvoicePayload),
      });

      const payload = (await response
        .json()
        .catch(() => null)) as SendInvoiceResponse | null;

      if (!response.ok || !payload?.ok || !payload.success) {
        throw new Error(payload?.error || "Failed to send invoice.");
      }

      setSuccess(
        refreshPayLink
          ? `✓ ${reminderMode ? "Reminder" : "Invoice"} sent to ${normalizedCustomerEmail} with a fresh pay link`
          : `✓ ${reminderMode ? "Reminder" : "Invoice"} sent to ${normalizedCustomerEmail}`,
      );
      router.refresh();
    } catch (sendError) {
      setError(
        sendError instanceof Error
          ? sendError.message
          : `Failed to send ${reminderMode ? "reminder" : "invoice"}.`,
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button type="button" className={buttonClassName} onClick={openModal}>
        {buttonLabel || modalTitle}
      </button>

      {open ? (
        <div
          className="quicklead-backdrop"
          role="dialog"
          aria-modal
          aria-labelledby="send-invoice-modal-title"
          onClick={closeModal}
        >
          <div
            className="quicklead-modal send-invoice-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <h3 id="send-invoice-modal-title">{modalTitle}</h3>
              <p className="muted">{modalDescription}</p>
            </header>

            <div className="auth-form send-invoice-modal__fields">
              <label>
                To
                <input readOnly value={recipientLabel} />
              </label>

              <label>
                Subject
                <input readOnly value={subject} />
              </label>

              <label>
                Add a message (optional)
                <textarea
                  rows={6}
                  maxLength={4000}
                  placeholder={messagePlaceholder}
                  value={message}
                  disabled={sending || sendCompleted}
                  onChange={(event) => setMessage(event.target.value)}
                />
              </label>

              {onlinePaymentsAvailable ? (
                <label style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <input
                    type="checkbox"
                    checked={refreshPayLink}
                    disabled={sending || sendCompleted}
                    onChange={(event) => setRefreshPayLink(event.target.checked)}
                    style={{ marginTop: 4 }}
                  />
                  <span>
                    {freshPayLinkLabel}
                  </span>
                </label>
              ) : null}
            </div>

            {!canSend ? (
              <p className="send-invoice-modal__notice error">
                Add a customer email before sending this invoice.
              </p>
            ) : null}
            {success ? (
              <p className="send-invoice-modal__notice success">{success}</p>
            ) : null}
            {error ? (
              <p className="send-invoice-modal__notice error">{error}</p>
            ) : null}

            <div className="quicklead-actions">
              <button
                type="button"
                className="btn secondary"
                onClick={closeModal}
                disabled={sending}
              >
                Close
              </button>
              <button
                type="button"
                className="btn secondary"
                onClick={handlePreviewPdf}
                disabled={sending}
              >
                Preview PDF
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => void handleSendInvoice()}
                disabled={!canSend || sending || sendCompleted}
              >
                {sendCompleted
                  ? "Sent"
                  : sending
                    ? "Sending..."
                    : sendButtonLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function createSendAttemptKey(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `invoice-send-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
