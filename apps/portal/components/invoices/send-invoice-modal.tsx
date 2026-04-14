"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type SendInvoiceModalProps = {
  businessName: string;
  customerEmail?: string | null;
  customerName: string;
  invoiceNumber: string;
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

export default function SendInvoiceModal({
  businessName,
  customerEmail,
  customerName,
  invoiceNumber,
  previewHref,
  sendHref,
}: SendInvoiceModalProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const normalizedCustomerEmail = customerEmail?.trim() || "";
  const canSend = normalizedCustomerEmail.length > 0;
  const sendCompleted = success !== null;
  const subject = `Invoice #${invoiceNumber} from ${businessName}`;
  const recipientLabel = canSend
    ? `${customerName} (${normalizedCustomerEmail})`
    : `${customerName} (No email on file)`;

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
        },
        body: JSON.stringify({
          message: message.trim() || undefined,
        }),
      });

      const payload = (await response.json().catch(() => null)) as SendInvoiceResponse | null;

      if (!response.ok || !payload?.ok || !payload.success) {
        throw new Error(payload?.error || "Failed to send invoice.");
      }

      setSuccess(`✓ Invoice sent to ${normalizedCustomerEmail}`);
      router.refresh();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Failed to send invoice.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button type="button" className="btn primary" onClick={openModal}>
        Send Invoice
      </button>

      {open ? (
        <div className="quicklead-backdrop" role="dialog" aria-modal aria-labelledby="send-invoice-modal-title" onClick={closeModal}>
          <div className="quicklead-modal send-invoice-modal" onClick={(event) => event.stopPropagation()}>
            <header>
              <h3 id="send-invoice-modal-title">Send Invoice</h3>
              <p className="muted">Email the customer a PDF copy directly from the portal.</p>
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
                  placeholder="Thanks for the opportunity. Let us know if you have any questions."
                  value={message}
                  disabled={sending || sendCompleted}
                  onChange={(event) => setMessage(event.target.value)}
                />
              </label>
            </div>

            {!canSend ? (
              <p className="send-invoice-modal__notice error">
                Add a customer email before sending this invoice.
              </p>
            ) : null}
            {success ? <p className="send-invoice-modal__notice success">{success}</p> : null}
            {error ? <p className="send-invoice-modal__notice error">{error}</p> : null}

            <div className="quicklead-actions">
              <button type="button" className="btn secondary" onClick={closeModal} disabled={sending}>
                Close
              </button>
              <button type="button" className="btn secondary" onClick={handlePreviewPdf} disabled={sending}>
                Preview PDF
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => void handleSendInvoice()}
                disabled={!canSend || sending || sendCompleted}
              >
                {sendCompleted ? "Sent" : sending ? "Sending..." : "Send Invoice ->"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
