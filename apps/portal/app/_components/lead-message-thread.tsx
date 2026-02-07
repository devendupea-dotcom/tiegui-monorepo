"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type ThreadMessage = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  fromNumberE164: string;
  toNumberE164: string;
  body: string;
  provider: "TWILIO";
  providerMessageSid: string | null;
  status: "QUEUED" | "SENT" | "DELIVERED" | "FAILED" | null;
  createdAt: string;
};

type LeadMessageThreadProps = {
  leadId: string;
  initialMessages: ThreadMessage[];
  canSend?: boolean;
};

function formatMessageTimestamp(value: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export default function LeadMessageThread({
  leadId,
  initialMessages,
  canSend = true,
}: LeadMessageThreadProps) {
  const [messages, setMessages] = useState<ThreadMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length]);

  const orderedMessages = useMemo(
    () => [...messages].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [messages],
  );

  async function handleSend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const body = draft.trim();
    if (!body || submitting) {
      return;
    }

    setSubmitting(true);
    setStatus(null);

    const tempId = `temp-${Date.now()}`;
    const optimisticMessage: ThreadMessage = {
      id: tempId,
      direction: "OUTBOUND",
      fromNumberE164: "",
      toNumberE164: "",
      body,
      provider: "TWILIO",
      providerMessageSid: null,
      status: "QUEUED",
      createdAt: new Date().toISOString(),
    };

    setMessages((current) => [...current, optimisticMessage]);
    setDraft("");

    try {
      const response = await fetch(`/api/leads/${leadId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        message?: Omit<ThreadMessage, "createdAt"> & { createdAt: string | Date };
      };

      if (!response.ok || !payload.ok || !payload.message) {
        setMessages((current) => current.filter((message) => message.id !== tempId));
        setStatus(payload.error || "Could not send message.");
        setSubmitting(false);
        return;
      }

      const confirmedMessage: ThreadMessage = {
        ...payload.message,
        createdAt: new Date(payload.message.createdAt).toISOString(),
      };

      setMessages((current) =>
        current.map((message) => (message.id === tempId ? confirmedMessage : message)),
      );
      setStatus("Message sent.");
    } catch {
      setMessages((current) => current.filter((message) => message.id !== tempId));
      setStatus("Could not send message.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="message-thread">
      <div className="message-thread-scroll" ref={scrollRef}>
        {orderedMessages.length === 0 ? (
          <p className="muted">No messages yet.</p>
        ) : (
          orderedMessages.map((message) => (
            <div
              key={message.id}
              className={`message-row ${message.direction === "OUTBOUND" ? "outbound" : "inbound"}`}
            >
              <div className={`message-bubble ${message.direction === "OUTBOUND" ? "outbound" : "inbound"}`}>
                <p>{message.body}</p>
                <p className="message-meta">
                  {formatMessageTimestamp(message.createdAt)}
                  {message.direction === "OUTBOUND" && message.status ? ` • ${message.status}` : ""}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      {canSend ? (
        <form className="message-compose" onSubmit={handleSend}>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Type a message"
            rows={3}
            maxLength={1600}
            disabled={submitting}
          />
          <div className="message-compose-actions">
            <span className="muted">{draft.length}/1600</span>
            <button className="btn primary" type="submit" disabled={submitting || !draft.trim()}>
              Send
            </button>
          </div>
        </form>
      ) : null}

      {status ? <p className="form-status">{status}</p> : null}
    </div>
  );
}
