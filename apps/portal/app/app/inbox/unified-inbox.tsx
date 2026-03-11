"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatLabel } from "@/lib/hq";

type ConversationRow = {
  id: string;
  leadId: string;
  contactName: string;
  phoneE164: string;
  status: string;
  priority: string;
  sourceType: string;
  leadSource: string;
  nextFollowUpAt: string | null;
  lastEventAt: string;
  lastSnippet: string;
  lastChannel: "sms" | "call" | "system";
  channels: {
    sms: boolean;
    call: boolean;
    meta: boolean;
  };
  unreadCount: number;
  atRisk: boolean;
};

type TimelineEvent = {
  id: string;
  type: "message" | "call" | "system";
  channel: "sms" | "meta" | "call" | "system";
  direction?: "inbound" | "outbound";
  leadId?: string;
  body?: string;
  status?: "queued" | "sent" | "delivered" | "failed" | "read";
  createdAt: string;
  meta?: Record<string, unknown>;
};

type LeadContext = {
  id: string;
  orgId: string;
  contactName: string | null;
  businessName: string | null;
  phoneE164: string;
  city: string | null;
  status: string;
  priority: string;
  nextFollowUpAt: string | null;
  estimatedRevenueCents: number | null;
  customer:
    | {
        id: string;
        name: string;
        email: string | null;
        addressLine: string | null;
      }
    | null;
};

type UnifiedInboxProps = {
  orgId: string;
  internalUser: boolean;
  onboardingComplete: boolean;
};

type RenderItem =
  | {
      kind: "day";
      id: string;
      label: string;
    }
  | {
      kind: "event";
      id: string;
      event: TimelineEvent;
    };

function useIsNarrow(breakpointPx = 980) {
  const [isNarrow, setIsNarrow] = useState(false);

  useEffect(() => {
    const query = `(max-width: ${breakpointPx}px)`;
    const media = window.matchMedia(query);
    const update = () => setIsNarrow(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, [breakpointPx]);

  return isNarrow;
}

function formatRelativeTimestamp(value: string, now = new Date()): string {
  const date = new Date(value);
  const diffMs = now.getTime() - date.getTime();
  const minutes = Math.floor(diffMs / (60 * 1000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const dayDiff = Math.floor(hours / 24);
  if (dayDiff === 1) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function formatMessageTime(value: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatDayLabel(date: Date, now = new Date()): string {
  const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const dateKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  if (dateKey === todayKey) return "Today";

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yesterdayKey = `${yesterday.getFullYear()}-${yesterday.getMonth()}-${yesterday.getDate()}`;
  if (dateKey === yesterdayKey) return "Yesterday";

  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

function toDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function isOverdue(value: string | null | undefined): boolean {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now();
}

function sourceBadgeClass(sourceType: string): string {
  const normalized = sourceType.toLowerCase();
  if (normalized === "paid") return "status-paid";
  if (normalized === "organic") return "status-organic";
  return "status-unknown";
}

function callRowLabel(event: TimelineEvent): string {
  const meta = event.meta || {};
  const label = typeof meta.label === "string" ? meta.label : "Call";
  const status = typeof meta.status === "string" ? meta.status : "";
  const direction = event.direction ? formatLabel(event.direction) : "";
  const durationSeconds = typeof meta.durationSeconds === "number" ? meta.durationSeconds : null;

  const parts = [label];
  if (status) parts.push(status.toLowerCase());
  if (direction) parts.push(direction.toLowerCase());
  if (durationSeconds !== null) {
    const minutes = Math.floor(durationSeconds / 60);
    const seconds = durationSeconds % 60;
    parts.push(`${minutes}:${seconds.toString().padStart(2, "0")}`);
  }

  return parts.filter(Boolean).join(" • ");
}

export default function UnifiedInbox({ orgId, internalUser, onboardingComplete }: UnifiedInboxProps) {
  function withOrgQuery(path: string) {
    if (!internalUser) return path;
    const joiner = path.includes("?") ? "&" : "?";
    return `${path}${joiner}orgId=${encodeURIComponent(orgId)}`;
  }

  const isNarrow = useIsNarrow();
  const [view, setView] = useState<"list" | "thread">("list");
  const [search, setSearch] = useState("");

  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  const [loadingThread, setLoadingThread] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [leadContext, setLeadContext] = useState<LeadContext | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<string | null>(null);
  const [showContextDrawer, setShowContextDrawer] = useState(false);

  const threadScrollRef = useRef<HTMLDivElement | null>(null);
  const closeContextDrawer = () => setShowContextDrawer(false);

  const filteredConversations = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return conversations;
    return conversations.filter((row) => {
      return row.contactName.toLowerCase().includes(term) || row.phoneE164.toLowerCase().includes(term);
    });
  }, [conversations, search]);

  const renderItems: RenderItem[] = useMemo(() => {
    if (!events.length) return [];
    const now = new Date();
    const output: RenderItem[] = [];
    let lastDayKey: string | null = null;
    for (const event of events) {
      const date = new Date(event.createdAt);
      const key = toDayKey(date);
      if (key !== lastDayKey) {
        output.push({ kind: "day", id: `day-${key}`, label: formatDayLabel(date, now) });
        lastDayKey = key;
      }
      output.push({ kind: "event", id: event.id, event });
    }
    return output;
  }, [events]);

  async function fetchConversations() {
    const query = internalUser ? `?orgId=${encodeURIComponent(orgId)}` : "";
    const response = await fetch(`/api/inbox/conversations${query}`, {
      method: "GET",
      headers: { "content-type": "application/json" },
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; conversations?: ConversationRow[]; error?: string } | null;
    if (!response.ok || !payload?.ok || !Array.isArray(payload.conversations)) {
      throw new Error(payload?.error || "Failed to load conversations.");
    }
    return payload.conversations;
  }

  async function fetchThread(leadId: string) {
    const query = internalUser ? `?orgId=${encodeURIComponent(orgId)}` : "";
    const response = await fetch(`/api/inbox/conversations/${encodeURIComponent(leadId)}/events${query}`, {
      method: "GET",
      headers: { "content-type": "application/json" },
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; lead?: LeadContext; events?: TimelineEvent[]; error?: string }
      | null;
    if (!response.ok || !payload?.ok || !payload?.lead || !Array.isArray(payload.events)) {
      throw new Error(payload?.error || "Failed to load thread.");
    }
    return { lead: payload.lead, events: payload.events };
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setListError(null);
        const rows = await fetchConversations();
        if (cancelled) return;
        setConversations(rows);
        setLoadingList(false);
        const first = rows[0];
        if (!selectedLeadId && first) {
          setSelectedLeadId(first.leadId);
          if (isNarrow) {
            setView("list");
          }
        }
      } catch (error) {
        if (cancelled) return;
        setListError(error instanceof Error ? error.message : "Failed to load conversations.");
        setLoadingList(false);
      }
    }

    load();
    const interval = window.setInterval(load, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, internalUser]);

  useEffect(() => {
    if (!selectedLeadId) {
      setLeadContext(null);
      setEvents([]);
      return;
    }

    const leadId = selectedLeadId;
    let cancelled = false;
    let interval: number | null = null;

    async function load() {
      try {
        setThreadError(null);
        setLoadingThread(true);
        const data = await fetchThread(leadId);
        if (cancelled) return;
        setLeadContext(data.lead);
        setEvents(data.events);
      } catch (error) {
        if (cancelled) return;
        setThreadError(error instanceof Error ? error.message : "Failed to load thread.");
      } finally {
        if (!cancelled) {
          setLoadingThread(false);
        }
      }
    }

    load();
    interval = window.setInterval(load, 3200);

    return () => {
      cancelled = true;
      if (interval !== null) {
        window.clearInterval(interval);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLeadId, orgId, internalUser]);

  useEffect(() => {
    if (!threadScrollRef.current) return;
    threadScrollRef.current.scrollTop = threadScrollRef.current.scrollHeight;
  }, [events.length, renderItems.length]);

  useEffect(() => {
    if (!isNarrow || !showContextDrawer) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeContextDrawer();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isNarrow, showContextDrawer]);

  useEffect(() => {
    if (!isNarrow) {
      setView("thread");
    } else if (view !== "list" && !selectedLeadId) {
      setView("list");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNarrow]);

  async function handleSend() {
    if (!selectedLeadId) return;
    const body = draft.trim();
    if (!body || sending) return;

    setSending(true);
    setSendStatus(null);

    const optimisticId = `temp-${Date.now()}`;
    const now = new Date().toISOString();
    const optimisticEvent: TimelineEvent = {
      id: optimisticId,
      type: "message",
      channel: "sms",
      direction: "outbound",
      body,
      status: "queued",
      createdAt: now,
      meta: { optimistic: true },
    };

    setEvents((current) => [...current, optimisticEvent]);
    setDraft("");

    try {
      const response = await fetch("/api/inbox/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadId: selectedLeadId, body }),
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
            notice?: string;
            message?: {
              id: string;
              direction: "INBOUND" | "OUTBOUND";
              body: string;
              status: "QUEUED" | "SENT" | "DELIVERED" | "FAILED" | null;
              createdAt: string | Date;
            };
          }
        | null;

      if (!response.ok || !payload?.ok || !payload.message) {
        setEvents((current) => current.filter((event) => event.id !== optimisticId));
        setSendStatus(payload?.error || "Could not send message.");
        return;
      }

      const confirmedEvent: TimelineEvent = {
        id: payload.message.id,
        type: "message",
        channel: "sms",
        direction: payload.message.direction === "INBOUND" ? "inbound" : "outbound",
        body: payload.message.body,
        status: payload.message.status ? payload.message.status.toLowerCase() as TimelineEvent["status"] : undefined,
        createdAt: new Date(payload.message.createdAt).toISOString(),
      };

      setEvents((current) => current.map((event) => (event.id === optimisticId ? confirmedEvent : event)));
      setSendStatus(payload.notice || (payload.message.status === "FAILED" ? "Message failed." : "Message sent."));
    } catch {
      setEvents((current) => current.filter((event) => event.id !== optimisticId));
      setSendStatus("Could not send message.");
    } finally {
      setSending(false);
    }
  }

  const emptyState = !loadingList && filteredConversations.length === 0;

  const leadTitle =
    leadContext?.contactName?.trim() ||
    leadContext?.businessName?.trim() ||
    leadContext?.customer?.name?.trim() ||
    leadContext?.phoneE164 ||
    "";

  const jobHref = selectedLeadId
    ? withOrgQuery(`/app/jobs/${selectedLeadId}?tab=messages`)
    : withOrgQuery("/app/jobs");

  return (
    <section className="card inbox-card">
      <div className="inbox-card-head">
        <div className="stack-cell">
          <h2>Inbox</h2>
          <p className="muted">All threads and call history, per job.</p>
        </div>
        {!isNarrow ? (
          <Link className="btn secondary" href={jobHref}>
            Open Job Folder
          </Link>
        ) : null}
      </div>

      {loadingList ? (
        <p className="muted" style={{ marginTop: 12 }}>
          Loading inbox…
        </p>
      ) : listError ? (
        <div className="portal-empty-state" style={{ marginTop: 12 }}>
          <strong>Inbox unavailable</strong>
          <p className="muted">{listError}</p>
          <button className="btn secondary" type="button" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      ) : emptyState ? (
        <div className="portal-empty-state" style={{ marginTop: 12 }}>
          <strong>No activity yet — here&apos;s how to get started:</strong>
          <ul className="portal-empty-list">
            <li>Add your first lead</li>
            <li>Set a follow-up</li>
            <li>Reply to missed calls from your inbox</li>
          </ul>
          <div className="portal-empty-actions">
            <Link className="btn primary" href={withOrgQuery("/app?quickAdd=1")}>
              Add Lead
            </Link>
            {!onboardingComplete ? (
              <Link className="btn secondary" href={withOrgQuery("/app/onboarding?step=1")}>
                Finish Onboarding
              </Link>
            ) : null}
          </div>
        </div>
      ) : (
        <div className={`unified-inbox-shell ${isNarrow ? "narrow" : ""}`}>
          {(!isNarrow || view === "list") && (
            <section className="unified-inbox-panel unified-inbox-list">
              <header className="unified-inbox-panel-header">
                <div className="unified-inbox-panel-title">
                  <strong>Conversations</strong>
                  <span className="muted">{filteredConversations.length}</span>
                </div>
                <input
                  className="unified-inbox-search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search"
                  aria-label="Search conversations"
                />
              </header>

              <div className="unified-inbox-panel-scroll">
                <ul className="thread-list inbox-thread-list">
                  {filteredConversations.map((row) => {
                    const active = row.leadId === selectedLeadId;
                    const overdueFollowUp = isOverdue(row.nextFollowUpAt);
                    const sourceClass = sourceBadgeClass(row.sourceType);

                    return (
                      <li
                        key={row.leadId}
                        className={`thread-item inbox-thread-item ${active ? "active" : ""} ${row.unreadCount ? "unread" : ""}`}
                      >
                        <button
                          type="button"
                          className="thread-link inbox-thread-button"
                          onClick={() => {
                            setSelectedLeadId(row.leadId);
                            if (isNarrow) {
                              setView("thread");
                            }
                          }}
                        >
                          <div className="thread-top">
                            <div className="inbox-thread-title">
                              <strong>{row.contactName}</strong>
                              {row.unreadCount ? <span className="inbox-unread-badge">{row.unreadCount}</span> : null}
                            </div>
                            <span className="muted">{formatRelativeTimestamp(row.lastEventAt)}</span>
                          </div>

                          <div className="inbox-thread-badges">
                            <span className={`badge status-${row.status.toLowerCase()}`}>{formatLabel(row.status)}</span>
                            <span className={`badge priority-${row.priority.toLowerCase()}`}>{formatLabel(row.priority)}</span>
                            <span className={`badge ${sourceClass}`}>{formatLabel(row.sourceType)}</span>
                            {overdueFollowUp ? <span className="badge status-overdue">Overdue</span> : null}
                            {row.atRisk ? <span className="badge status-overdue">At risk</span> : null}
                          </div>

                          <p className={`inbox-thread-snippet ${row.unreadCount ? "" : "muted"}`}>
                            {row.lastSnippet || "No messages yet."}
                          </p>

                          <div className="inbox-thread-channels">
                            {row.channels.sms ? <span className="inbox-channel-chip">SMS</span> : null}
                            {row.channels.call ? <span className="inbox-channel-chip">Call</span> : null}
                            {row.channels.meta ? <span className="inbox-channel-chip">Meta</span> : null}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>
          )}

          {(!isNarrow || view === "thread") && (
            <section className="unified-inbox-panel unified-inbox-thread">
              <header className="unified-inbox-panel-header thread-header">
                {isNarrow ? (
                  <button className="btn secondary inbox-back" type="button" onClick={() => setView("list")}>
                    Back
                  </button>
                ) : null}

                <div className="thread-header-copy">
                  <strong>{leadTitle || "Thread"}</strong>
                  <span className="muted">{leadContext?.phoneE164 || ""}</span>
                </div>

                <div className="thread-header-actions">
                  {leadContext?.phoneE164 ? (
                    <a className="btn secondary" href={`tel:${leadContext.phoneE164}`} aria-label="Call customer">
                      Call
                    </a>
                  ) : null}
                  {isNarrow ? (
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => setShowContextDrawer(true)}
                      aria-label="Open job context"
                    >
                      Info
                    </button>
                  ) : (
                    <Link className="btn secondary" href={jobHref}>
                      Open Job
                    </Link>
                  )}
                </div>
              </header>

              <div className="unified-thread-scroll" ref={threadScrollRef}>
                {loadingThread ? (
                  <p className="muted">Loading thread…</p>
                ) : threadError ? (
                  <p className="muted">{threadError}</p>
                ) : renderItems.length === 0 ? (
                  <p className="muted">No messages yet.</p>
                ) : (
                  renderItems.map((item) => {
                    if (item.kind === "day") {
                      return (
                        <div key={item.id} className="inbox-day-separator">
                          <span>{item.label}</span>
                        </div>
                      );
                    }

                    const event = item.event;
                    if (event.type === "call") {
                      return (
                        <div key={item.id} className="inbox-call-row">
                          <span className="inbox-call-pill">{callRowLabel(event)}</span>
                        </div>
                      );
                    }

                    if (event.type === "system") {
                      return (
                        <div key={item.id} className="inbox-call-row">
                          <span className="inbox-call-pill">{event.body || "Update"}</span>
                        </div>
                      );
                    }

                    const inbound = event.direction !== "outbound";
                    const timeLabel = formatMessageTime(event.createdAt);
                    const statusLabel = !inbound && event.status ? ` • ${event.status.toUpperCase()}` : "";

                    return (
                      <div key={item.id} className={`message-row ${inbound ? "inbound" : "outbound"}`}>
                        <div className={`message-bubble ${inbound ? "inbound" : "outbound"}`}>
                          <p>{event.body}</p>
                          <p className="message-meta">
                            {timeLabel}
                            {statusLabel}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="unified-thread-compose">
                <div className="template-pills">
                  <button
                    type="button"
                    className="template-chip"
                    onClick={() => setDraft("What’s the address (or closest cross-street)?")}
                    disabled={sending}
                  >
                    Ask address
                  </button>
                  <button
                    type="button"
                    className="template-chip"
                    onClick={() =>
                      setDraft("When are you looking to get this done — ASAP, this week, next week, or just getting a quote?")
                    }
                    disabled={sending}
                  >
                    Ask timeframe
                  </button>
                  <button
                    type="button"
                    className="template-chip"
                    onClick={() => setDraft("Got it — we’ll reach out shortly.")}
                    disabled={sending}
                  >
                    Acknowledge
                  </button>
                </div>

                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Type a message…"
                  rows={3}
                  maxLength={1600}
                  disabled={!selectedLeadId || sending}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void handleSend();
                    }
                  }}
                  aria-label="Message composer"
                />

                <div className="message-compose-actions">
                  <span className="muted">{draft.length}/1600</span>
                  <button
                    className="btn primary"
                    type="button"
                    onClick={() => void handleSend()}
                    disabled={!draft.trim() || sending || !selectedLeadId}
                  >
                    Send
                  </button>
                </div>

                {sendStatus ? <p className="form-status">{sendStatus}</p> : null}
              </div>
            </section>
          )}

          {!isNarrow && (
            <section className="unified-inbox-panel unified-inbox-context">
              <header className="unified-inbox-panel-header">
                <strong>Context</strong>
                {leadContext ? <span className="muted">{formatLabel(leadContext.status)}</span> : null}
              </header>

              <div className="unified-inbox-panel-scroll context-scroll">
                {leadContext ? (
                  <div className="stack-cell">
                    <div className="stack-cell">
                      <strong>{leadTitle}</strong>
                      <span className="muted">{leadContext.city || " "}</span>
                      <span className="muted">{leadContext.phoneE164}</span>
                    </div>

                    <div className="quick-meta">
                      <span className={`badge status-${leadContext.status.toLowerCase()}`}>{formatLabel(leadContext.status)}</span>
                      <span className={`badge priority-${leadContext.priority.toLowerCase()}`}>{formatLabel(leadContext.priority)}</span>
                      {leadContext.nextFollowUpAt && isOverdue(leadContext.nextFollowUpAt) ? (
                        <span className="badge status-overdue">Overdue</span>
                      ) : null}
                    </div>

                    {leadContext.nextFollowUpAt ? (
                      <div className="stack-cell">
                        <span className="muted">Follow-up</span>
                        <span>{new Date(leadContext.nextFollowUpAt).toLocaleString()}</span>
                      </div>
                    ) : null}

                    {leadContext.estimatedRevenueCents !== null ? (
                      <div className="stack-cell">
                        <span className="muted">Value</span>
                        <span>${(leadContext.estimatedRevenueCents / 100).toFixed(0)}</span>
                      </div>
                    ) : null}

                    {leadContext.customer ? (
                      <div className="stack-cell">
                        <span className="muted">Customer</span>
                        <span>{leadContext.customer.name}</span>
                        {leadContext.customer.email ? <span className="muted">{leadContext.customer.email}</span> : null}
                        {leadContext.customer.addressLine ? <span className="muted">{leadContext.customer.addressLine}</span> : null}
                      </div>
                    ) : null}

                    <div className="portal-empty-actions" style={{ justifyContent: "flex-start" }}>
                      <Link className="btn secondary" href={jobHref}>
                        Open job
                      </Link>
                      <Link className="btn secondary" href={withOrgQuery("/app/calendar")}>
                        Calendar
                      </Link>
                    </div>
                  </div>
                ) : (
                  <p className="muted">Select a conversation to see details.</p>
                )}
              </div>
            </section>
          )}
        </div>
      )}

      {isNarrow && showContextDrawer ? (
        <div className="inbox-context-drawer">
          <button
            type="button"
            className="inbox-context-drawer-backdrop"
            aria-label="Close job context"
            onClick={closeContextDrawer}
          />
          <div className="inbox-context-drawer-card">
            <div className="inbox-context-drawer-head">
              <strong>Job context</strong>
              <button className="btn secondary" type="button" onClick={closeContextDrawer}>
                Close
              </button>
            </div>

            <div className="inbox-context-drawer-body">
              {leadContext ? (
                <>
                  <p>
                    <strong>{leadTitle}</strong>
                  </p>
                  <p className="muted">{leadContext.phoneE164}</p>
                  {leadContext.nextFollowUpAt ? (
                    <p className="muted">Follow-up: {new Date(leadContext.nextFollowUpAt).toLocaleString()}</p>
                  ) : null}
                  <div className="portal-empty-actions" style={{ justifyContent: "flex-start", marginTop: 12 }}>
                    <Link className="btn primary" href={jobHref}>
                      Open job
                    </Link>
                    <Link className="btn secondary" href={withOrgQuery("/app/calendar")}>
                      Calendar
                    </Link>
                  </div>
                </>
              ) : (
                <p className="muted">No conversation selected.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
