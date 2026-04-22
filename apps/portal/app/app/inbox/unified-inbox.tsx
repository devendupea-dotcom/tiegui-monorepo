"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "next-intl";
import {
  formatDateTimeForDisplay,
  localDateFromUtc,
} from "@/lib/calendar/dates";
import { formatLabel } from "@/lib/hq";
import { matchesInboxConversationSearch } from "@/lib/inbox-search";
import { mergeInboxTimelineEvents } from "@/lib/inbox-ui";
import InboxContextPanel, {
  type InboxLeadContext,
} from "./inbox-context-panel";

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
  potentialSpam: boolean;
  potentialSpamSignals: string[];
  failedOutboundCount: number;
};

type InboxLane = "all" | "attention" | "spam";

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

type UnifiedInboxProps = {
  orgId: string;
  internalUser: boolean;
  onboardingComplete: boolean;
  canManage: boolean;
  initialLeadId?: string | null;
  initialOpenContextEditor?: boolean;
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

type InboxCopy = {
  now: string;
  yesterday: string;
  today: string;
  errors: {
    loadConversations: string;
    loadThread: string;
    sendMessage: string;
  };
  title: string;
  subtitle: string;
  openJobFolder: string;
  openJob: string;
  activeThreads: string;
  activeThreadsBody: string;
  unread: string;
  unreadBody: string;
  needsAttention: string;
  needsAttentionBody: string;
  spamReview: string;
  spamReviewBody: string;
  loadingInbox: string;
  inboxUnavailable: string;
  retry: string;
  emptyTitle: string;
  emptyBulletOne: string;
  emptyBulletTwo: string;
  emptyBulletThree: string;
  addLead: string;
  finishOnboarding: string;
  conversations: string;
  searchPlaceholder: string;
  searchAria: string;
  laneAll: string;
  laneAttention: string;
  laneSpam: string;
  noSearchResultsTitle: string;
  noSearchResultsBody: string;
  noLaneResultsTitle: string;
  noLaneResultsBody: string;
  clearSearch: string;
  overdue: string;
  atRisk: string;
  potentialSpam: string;
  failedSms: string;
  noMessagesYet: string;
  back: string;
  thread: string;
  call: string;
  info: string;
  loadingThread: string;
  update: string;
  askAddress: string;
  askTimeframe: string;
  acknowledge: string;
  typeMessage: string;
  messageComposer: string;
  send: string;
  messageSent: string;
  messageFailed: string;
  readOnlyBody: string;
  context: string;
  jobContext: string;
  close: string;
};

function getInboxCopy(locale: string): InboxCopy {
  if (locale.startsWith("es")) {
    return {
      now: "ahora",
      yesterday: "Ayer",
      today: "Hoy",
      errors: {
        loadConversations: "No se pudieron cargar las conversaciones.",
        loadThread: "No se pudo cargar la conversacion.",
        sendMessage: "No se pudo enviar el mensaje.",
      },
      title: "Bandeja",
      subtitle:
        "Conversaciones, llamadas y seguimiento en una sola bandeja operativa.",
      openJobFolder: "Abrir lead",
      openJob: "Abrir lead",
      activeThreads: "Conversaciones activas",
      activeThreadsBody: "Clientes con actividad reciente",
      unread: "No leidos",
      unreadBody: "Conversaciones con algo nuevo",
      needsAttention: "Requieren atencion",
      needsAttentionBody: "En riesgo o con seguimiento vencido",
      spamReview: "Revisar spam",
      spamReviewBody: "Riesgo alto o SMS fallidos repetidos",
      loadingInbox: "Cargando bandeja...",
      inboxUnavailable: "La bandeja no esta disponible",
      retry: "Reintentar",
      emptyTitle: "Aun no hay actividad; asi puedes empezar:",
      emptyBulletOne: "Agrega tu primer lead",
      emptyBulletTwo: "Configura un seguimiento",
      emptyBulletThree: "Responde llamadas perdidas desde la bandeja",
      addLead: "Agregar lead",
      finishOnboarding: "Terminar onboarding",
      conversations: "Conversaciones",
      searchPlaceholder: "Buscar cliente o telefono",
      searchAria: "Buscar conversaciones",
      laneAll: "Todas",
      laneAttention: "Atencion",
      laneSpam: "Spam",
      noSearchResultsTitle: "No hay resultados para esta busqueda.",
      noSearchResultsBody: "Prueba otro nombre o numero de telefono.",
      noLaneResultsTitle: "No hay conversaciones en esta vista.",
      noLaneResultsBody: "Prueba otra vista o limpia la busqueda.",
      clearSearch: "Limpiar busqueda",
      overdue: "Vencido",
      atRisk: "En riesgo",
      potentialSpam: "Posible spam",
      failedSms: "SMS fallidos",
      noMessagesYet: "Aun no hay mensajes.",
      back: "Atras",
      thread: "Conversacion",
      call: "Llamar",
      info: "Info",
      loadingThread: "Cargando conversacion...",
      update: "Actualizacion",
      askAddress: "Pedir direccion",
      askTimeframe: "Pedir tiempo",
      acknowledge: "Confirmar",
      typeMessage: "Escribe un mensaje...",
      messageComposer: "Redactor de mensajes",
      send: "Enviar",
      messageSent: "Mensaje enviado.",
      messageFailed: "El mensaje fallo.",
      readOnlyBody:
        "Los usuarios de solo lectura no pueden editar contexto ni enviar respuestas desde la bandeja.",
      context: "Contexto",
      jobContext: "Contexto del trabajo",
      close: "Cerrar",
    };
  }

  return {
    now: "now",
    yesterday: "Yesterday",
    today: "Today",
    errors: {
      loadConversations: "Failed to load conversations.",
      loadThread: "Failed to load thread.",
      sendMessage: "Could not send message.",
    },
    title: "Inbox",
    subtitle: "Leads, calls, and follow-up in one communication workspace.",
    openJobFolder: "Open Lead",
    openJob: "Open Lead",
    activeThreads: "Active threads",
    activeThreadsBody: "Customers with recent activity",
    unread: "Unread",
    unreadBody: "Threads with something new",
    needsAttention: "Needs attention",
    needsAttentionBody: "At-risk or overdue follow-up",
    spamReview: "Spam review",
    spamReviewBody: "High-risk callers or repeated failed SMS",
    loadingInbox: "Loading inbox...",
    inboxUnavailable: "Inbox unavailable",
    retry: "Retry",
    emptyTitle: "No activity yet; here's how to get started:",
    emptyBulletOne: "Add your first lead",
    emptyBulletTwo: "Set a follow-up",
    emptyBulletThree: "Reply to missed calls from your inbox",
    addLead: "Add Lead",
    finishOnboarding: "Finish Onboarding",
    conversations: "Conversations",
    searchPlaceholder: "Search customer or phone",
    searchAria: "Search conversations",
    laneAll: "All",
    laneAttention: "Attention",
    laneSpam: "Spam",
    noSearchResultsTitle: "No conversations match this search.",
    noSearchResultsBody: "Try a different customer name or phone number.",
    noLaneResultsTitle: "No conversations match this view.",
    noLaneResultsBody: "Try another lane or clear the search.",
    clearSearch: "Clear search",
    overdue: "Overdue",
    atRisk: "At risk",
    potentialSpam: "Potential spam",
    failedSms: "Failed SMS",
    noMessagesYet: "No messages yet.",
    back: "Back",
    thread: "Thread",
    call: "Call",
    info: "Info",
    loadingThread: "Loading thread...",
    update: "Update",
    askAddress: "Ask address",
    askTimeframe: "Ask timeframe",
    acknowledge: "Acknowledge",
    typeMessage: "Type a message...",
    messageComposer: "Message composer",
    send: "Send",
    messageSent: "Message sent.",
    messageFailed: "Message failed.",
    readOnlyBody:
      "Read-only users cannot edit context or send replies from inbox.",
    context: "Context",
    jobContext: "Job context",
    close: "Close",
  };
}

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

function formatRelativeTimestamp(
  value: string,
  locale: string,
  copy: InboxCopy,
  now = new Date(),
): string {
  const date = new Date(value);
  const diffMs = now.getTime() - date.getTime();
  const minutes = Math.floor(diffMs / (60 * 1000));
  if (minutes < 1) return copy.now;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const dayDiff = Math.floor(hours / 24);
  if (dayDiff === 1) return copy.yesterday;
  return formatDateTimeForDisplay(
    date,
    { month: "short", day: "numeric" },
    { locale },
  );
}

function formatMessageTime(value: string, locale: string): string {
  return formatDateTimeForDisplay(
    value,
    {
      hour: "numeric",
      minute: "2-digit",
    },
    { locale },
  );
}

function formatDayLabel(
  date: Date,
  locale: string,
  copy: InboxCopy,
  now = new Date(),
): string {
  const todayKey = localDateFromUtc(now, "America/Los_Angeles");
  const dateKey = localDateFromUtc(date, "America/Los_Angeles");
  if (dateKey === todayKey) return copy.today;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yesterdayKey = localDateFromUtc(yesterday, "America/Los_Angeles");
  if (dateKey === yesterdayKey) return copy.yesterday;

  return formatDateTimeForDisplay(
    date,
    {
      weekday: "short",
      month: "short",
      day: "numeric",
    },
    { locale },
  );
}

function toDayKey(date: Date): string {
  return localDateFromUtc(date, "America/Los_Angeles");
}

function isOverdue(value: string | null | undefined): boolean {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now();
}

function matchesInboxLane(row: ConversationRow, lane: InboxLane): boolean {
  if (lane === "attention") {
    return row.atRisk || isOverdue(row.nextFollowUpAt);
  }
  if (lane === "spam") {
    return row.potentialSpam || row.failedOutboundCount > 0;
  }
  return true;
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
  const durationSeconds =
    typeof meta.durationSeconds === "number" ? meta.durationSeconds : null;

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

function isNearThreadBottom(element: HTMLDivElement | null): boolean {
  if (!element) return true;
  return element.scrollHeight - element.scrollTop - element.clientHeight < 120;
}

export default function UnifiedInbox({
  orgId,
  internalUser,
  onboardingComplete,
  canManage,
  initialLeadId = null,
  initialOpenContextEditor = false,
}: UnifiedInboxProps) {
  const locale = useLocale();
  const copy = getInboxCopy(locale);
  function withOrgQuery(path: string) {
    if (!internalUser) return path;
    const joiner = path.includes("?") ? "&" : "?";
    return `${path}${joiner}orgId=${encodeURIComponent(orgId)}`;
  }

  const isNarrow = useIsNarrow();
  const [view, setView] = useState<"list" | "thread">(
    initialLeadId ? "thread" : "list",
  );
  const [search, setSearch] = useState("");
  const [lane, setLane] = useState<InboxLane>("all");

  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(
    initialLeadId,
  );

  const [loadingThread, setLoadingThread] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [leadContext, setLeadContext] = useState<InboxLeadContext | null>(null);
  const [serverEvents, setServerEvents] = useState<TimelineEvent[]>([]);
  const [pendingEvents, setPendingEvents] = useState<TimelineEvent[]>([]);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<string | null>(null);
  const [showContextDrawer, setShowContextDrawer] = useState(false);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const threadScrollRef = useRef<HTMLDivElement | null>(null);
  const selectedLeadIdRef = useRef<string | null>(null);
  const shouldStickThreadToBottomRef = useRef(true);
  const seenConversationAtRef = useRef<Record<string, string>>({});
  const initialContextRequestRef = useRef(Boolean(initialOpenContextEditor));
  const closeContextDrawer = () => setShowContextDrawer(false);

  useEffect(() => {
    selectedLeadIdRef.current = selectedLeadId;
  }, [selectedLeadId]);

  useEffect(() => {
    setDraft("");
    setSendStatus(null);
  }, [selectedLeadId]);

  const events = useMemo(
    () => mergeInboxTimelineEvents(serverEvents, pendingEvents),
    [serverEvents, pendingEvents],
  );

  const searchedConversations = useMemo(() => {
    return conversations.filter((row) =>
      matchesInboxConversationSearch(row, search),
    );
  }, [conversations, search]);

  const filteredConversations = useMemo(() => {
    return searchedConversations.filter((row) => matchesInboxLane(row, lane));
  }, [lane, searchedConversations]);

  useEffect(() => {
    if (!search.trim() && lane === "all") return;

    const nextLead = filteredConversations[0] || null;
    const selectionStillVisible = selectedLeadId
      ? filteredConversations.some((row) => row.leadId === selectedLeadId)
      : false;

    if (selectionStillVisible) {
      return;
    }

    if (!nextLead) {
      setSelectedLeadId(null);
      if (isNarrow) {
        setView("list");
      }
      return;
    }

    shouldStickThreadToBottomRef.current = true;
    setShowContextDrawer(false);
    const currentSeenAt = seenConversationAtRef.current[nextLead.leadId];
    if (
      !currentSeenAt ||
      new Date(nextLead.lastEventAt).getTime() >
        new Date(currentSeenAt).getTime()
    ) {
      seenConversationAtRef.current[nextLead.leadId] = nextLead.lastEventAt;
    }
    setSelectedLeadId(nextLead.leadId);
    setConversations((current) =>
      current.map((row) =>
        row.leadId === nextLead.leadId
          ? {
              ...row,
              unreadCount: 0,
              atRisk: false,
            }
          : row,
      ),
    );
    if (isNarrow) {
      setView("thread");
    }
  }, [filteredConversations, isNarrow, lane, search, selectedLeadId]);

  const renderItems: RenderItem[] = useMemo(() => {
    if (!events.length) return [];
    const now = new Date();
    const output: RenderItem[] = [];
    let lastDayKey: string | null = null;
    for (const event of events) {
      const date = new Date(event.createdAt);
      const key = toDayKey(date);
      if (key !== lastDayKey) {
        output.push({
          kind: "day",
          id: `day-${key}`,
          label: formatDayLabel(date, locale, copy, now),
        });
        lastDayKey = key;
      }
      output.push({ kind: "event", id: event.id, event });
    }
    return output;
  }, [copy, events, locale]);

  const markConversationSeen = useCallback(
    (leadId: string, eventAt: string | null | undefined) => {
      if (!eventAt) return;
      const current = seenConversationAtRef.current[leadId];
      if (
        !current ||
        new Date(eventAt).getTime() > new Date(current).getTime()
      ) {
        seenConversationAtRef.current[leadId] = eventAt;
      }
    },
    [],
  );

  function applyConversationSeenState(
    rows: ConversationRow[],
  ): ConversationRow[] {
    return rows.map((row) => {
      const seenAt = seenConversationAtRef.current[row.leadId];
      if (!seenAt) return row;
      if (new Date(row.lastEventAt).getTime() > new Date(seenAt).getTime()) {
        return row;
      }
      return {
        ...row,
        unreadCount: 0,
      };
    });
  }

  async function fetchConversations() {
    const query = internalUser ? `?orgId=${encodeURIComponent(orgId)}` : "";
    const response = await fetch(`/api/inbox/conversations${query}`, {
      method: "GET",
      headers: { "content-type": "application/json" },
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as {
      ok?: boolean;
      conversations?: ConversationRow[];
      error?: string;
    } | null;
    if (!response.ok || !payload?.ok || !Array.isArray(payload.conversations)) {
      throw new Error(payload?.error || copy.errors.loadConversations);
    }
    return payload.conversations;
  }

  async function fetchThread(leadId: string) {
    const query = internalUser ? `?orgId=${encodeURIComponent(orgId)}` : "";
    const response = await fetch(
      `/api/inbox/conversations/${encodeURIComponent(leadId)}/events${query}`,
      {
        method: "GET",
        headers: { "content-type": "application/json" },
        cache: "no-store",
      },
    );
    const payload = (await response.json().catch(() => null)) as {
      ok?: boolean;
      lead?: InboxLeadContext;
      events?: TimelineEvent[];
      error?: string;
    } | null;
    if (
      !response.ok ||
      !payload?.ok ||
      !payload?.lead ||
      !Array.isArray(payload.events)
    ) {
      throw new Error(payload?.error || copy.errors.loadThread);
    }
    return { lead: payload.lead, events: payload.events };
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setListError(null);
        const rows = applyConversationSeenState(await fetchConversations());
        if (cancelled) return;
        setConversations(rows);
        setLoadingList(false);
        const currentSelectedLeadId = selectedLeadIdRef.current;
        if (!rows.length) {
          if (currentSelectedLeadId) {
            setSelectedLeadId(null);
          }
          if (isNarrow) {
            setView("list");
          }
          return;
        }

        const selectionStillExists = currentSelectedLeadId
          ? rows.some((row) => row.leadId === currentSelectedLeadId)
          : false;

        if (!selectionStillExists) {
          const first = rows[0] || null;
          setSelectedLeadId(first?.leadId || null);
          if (isNarrow) {
            setView("list");
          }
        }
      } catch (error) {
        if (cancelled) return;
        setListError(
          error instanceof Error
            ? error.message
            : copy.errors.loadConversations,
        );
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
      setServerEvents([]);
      setPendingEvents([]);
      setThreadError(null);
      setLoadingThread(false);
      return;
    }

    const leadId = selectedLeadId;
    let cancelled = false;
    let interval: number | null = null;
    let firstLoad = true;

    async function load(showSpinner: boolean) {
      try {
        setThreadError(null);
        if (showSpinner) {
          setLoadingThread(true);
        }
        const data = await fetchThread(leadId);
        if (cancelled) return;
        markConversationSeen(
          leadId,
          data.events[data.events.length - 1]?.createdAt || null,
        );
        setLeadContext(data.lead);
        setServerEvents(data.events);
        setConversations((current) =>
          current.map((row) =>
            row.leadId === leadId
              ? {
                  ...row,
                  contactName:
                    data.lead.contactName?.trim() ||
                    data.lead.businessName?.trim() ||
                    row.contactName,
                  phoneE164: data.lead.phoneE164,
                  status: data.lead.status,
                  priority: data.lead.priority,
                  nextFollowUpAt: data.lead.nextFollowUpAt,
                  potentialSpam: Boolean(data.lead.potentialSpam),
                  potentialSpamSignals: data.lead.potentialSpamSignals || [],
                  failedOutboundCount: data.lead.failedOutboundCount || 0,
                  unreadCount: 0,
                  atRisk: false,
                }
              : row,
          ),
        );
      } catch (error) {
        if (cancelled) return;
        setThreadError(
          error instanceof Error ? error.message : copy.errors.loadThread,
        );
      } finally {
        if (!cancelled) {
          if (showSpinner) {
            setLoadingThread(false);
          }
          firstLoad = false;
        }
      }
    }

    shouldStickThreadToBottomRef.current = true;
    void load(true);
    interval = window.setInterval(() => void load(firstLoad), 3200);

    return () => {
      cancelled = true;
      if (interval !== null) {
        window.clearInterval(interval);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLeadId, orgId, internalUser]);

  useEffect(() => {
    const element = threadScrollRef.current;
    if (!element) return;

    const handleScroll = () => {
      shouldStickThreadToBottomRef.current = isNearThreadBottom(element);
    };

    handleScroll();
    element.addEventListener("scroll", handleScroll);
    return () => element.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const element = threadScrollRef.current;
    if (!element) return;
    if (!shouldStickThreadToBottomRef.current && renderItems.length > 0) return;
    element.scrollTop = element.scrollHeight;
  }, [renderItems.length, selectedLeadId]);

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

  useEffect(() => {
    if (!isNarrow || !initialContextRequestRef.current) {
      return;
    }

    if (!selectedLeadId) {
      return;
    }

    if (initialLeadId && selectedLeadId !== initialLeadId) {
      initialContextRequestRef.current = false;
      return;
    }

    setShowContextDrawer(true);
    setView("thread");
    initialContextRequestRef.current = false;
  }, [initialLeadId, isNarrow, selectedLeadId]);

  async function handleSend() {
    if (!selectedLeadId || !canManage) return;
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

    setPendingEvents((current) => [...current, optimisticEvent]);
    shouldStickThreadToBottomRef.current = true;
    setDraft("");

    try {
      const response = await fetch("/api/inbox/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadId: selectedLeadId, body }),
      });

      const payload = (await response.json().catch(() => null)) as {
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
      } | null;

      if (!response.ok || !payload?.ok || !payload.message) {
        setPendingEvents((current) =>
          current.filter((event) => event.id !== optimisticId),
        );
        setSendStatus(payload?.error || copy.errors.sendMessage);
        return;
      }

      const confirmedEvent: TimelineEvent = {
        id: payload.message.id,
        type: "message",
        channel: "sms",
        direction:
          payload.message.direction === "INBOUND" ? "inbound" : "outbound",
        body: payload.message.body,
        status: payload.message.status
          ? (payload.message.status.toLowerCase() as TimelineEvent["status"])
          : undefined,
        createdAt: new Date(payload.message.createdAt).toISOString(),
      };

      setPendingEvents((current) =>
        current.filter((event) => event.id !== optimisticId),
      );
      setServerEvents((current) =>
        mergeInboxTimelineEvents(current, [confirmedEvent]),
      );
      markConversationSeen(selectedLeadId, confirmedEvent.createdAt);
      setConversations((current) =>
        current.map((row) =>
          row.leadId === selectedLeadId
            ? {
                ...row,
                lastEventAt: confirmedEvent.createdAt,
                lastSnippet: confirmedEvent.body || row.lastSnippet,
                lastChannel: "sms",
                channels: {
                  ...row.channels,
                  sms: true,
                },
                unreadCount: 0,
                atRisk: false,
              }
            : row,
        ),
      );
      setSendStatus(
        payload.notice ||
          (payload.message.status === "FAILED"
            ? copy.messageFailed
            : copy.messageSent),
      );
    } catch {
      setPendingEvents((current) =>
        current.filter((event) => event.id !== optimisticId),
      );
      setSendStatus(copy.errors.sendMessage);
    } finally {
      setSending(false);
    }
  }

  const handleSelectLead = useCallback(
    (nextLeadId: string) => {
      shouldStickThreadToBottomRef.current = true;
      setShowContextDrawer(false);
      const existingRow = conversations.find(
        (row) => row.leadId === nextLeadId,
      );
      markConversationSeen(nextLeadId, existingRow?.lastEventAt || null);
      setSelectedLeadId(nextLeadId);
      setConversations((current) =>
        current.map((row) =>
          row.leadId === nextLeadId
            ? {
                ...row,
                unreadCount: 0,
                atRisk: false,
              }
            : row,
        ),
      );
      if (isNarrow) {
        setView("thread");
      }
    },
    [conversations, isNarrow, markConversationSeen],
  );

  function handleLeadContextSaved(nextLead: InboxLeadContext) {
    setLeadContext(nextLead);
    setConversations((current) =>
      current.map((row) =>
        row.leadId === nextLead.id
          ? {
              ...row,
              contactName:
                nextLead.contactName?.trim() ||
                nextLead.businessName?.trim() ||
                nextLead.phoneE164,
              phoneE164: nextLead.phoneE164,
              status: nextLead.status,
              priority: nextLead.priority,
              nextFollowUpAt: nextLead.nextFollowUpAt,
              potentialSpam: Boolean(nextLead.potentialSpam),
              potentialSpamSignals: nextLead.potentialSpamSignals || [],
              failedOutboundCount: nextLead.failedOutboundCount || 0,
            }
          : row,
      ),
    );
  }

  const hasConversations = conversations.length > 0;
  const emptyState = !loadingList && hasConversations === false;
  const noSearchResults =
    !loadingList && hasConversations && filteredConversations.length === 0;
  const unreadThreadsCount = searchedConversations.filter(
    (row) => row.unreadCount > 0,
  ).length;
  const attentionThreadsCount = searchedConversations.filter((row) =>
    matchesInboxLane(row, "attention"),
  ).length;
  const spamThreadsCount = searchedConversations.filter((row) =>
    matchesInboxLane(row, "spam"),
  ).length;

  const leadTitle =
    leadContext?.contactName?.trim() ||
    leadContext?.businessName?.trim() ||
    leadContext?.customer?.name?.trim() ||
    leadContext?.phoneE164 ||
    "";

  const jobHref = selectedLeadId
    ? withOrgQuery(`/app/jobs/${selectedLeadId}?tab=messages`)
    : withOrgQuery("/app/jobs");
  const calendarHref = selectedLeadId
    ? withOrgQuery(
        `/app/calendar?quickAction=schedule&leadId=${encodeURIComponent(selectedLeadId)}`,
      )
    : withOrgQuery("/app/calendar?quickAction=schedule");

  return (
    <section className="card inbox-card">
      <div className="inbox-card-head">
        <div className="stack-cell">
          <h2>{copy.title}</h2>
          <p className="muted">{copy.subtitle}</p>
        </div>
        {!isNarrow ? (
          <Link className="btn secondary" href={jobHref}>
            {copy.openJobFolder}
          </Link>
        ) : null}
      </div>

      {!loadingList && !listError && !emptyState ? (
        <div className="inbox-summary-strip">
          <article className="inbox-summary-stat">
            <span>{copy.activeThreads}</span>
            <strong>{filteredConversations.length}</strong>
            <small>{copy.activeThreadsBody}</small>
          </article>
          <article className="inbox-summary-stat">
            <span>{copy.unread}</span>
            <strong>{unreadThreadsCount}</strong>
            <small>{copy.unreadBody}</small>
          </article>
          <article className="inbox-summary-stat">
            <span>{copy.needsAttention}</span>
            <strong>{attentionThreadsCount}</strong>
            <small>{copy.needsAttentionBody}</small>
          </article>
          <article className="inbox-summary-stat">
            <span>{copy.spamReview}</span>
            <strong>{spamThreadsCount}</strong>
            <small>{copy.spamReviewBody}</small>
          </article>
        </div>
      ) : null}

      {loadingList ? (
        <p className="muted" style={{ marginTop: 12 }}>
          {copy.loadingInbox}
        </p>
      ) : listError ? (
        <div className="portal-empty-state" style={{ marginTop: 12 }}>
          <strong>{copy.inboxUnavailable}</strong>
          <p className="muted">{listError}</p>
          <button
            className="btn secondary"
            type="button"
            onClick={() => window.location.reload()}
          >
            {copy.retry}
          </button>
        </div>
      ) : emptyState ? (
        <div className="portal-empty-state" style={{ marginTop: 12 }}>
          <strong>{copy.emptyTitle}</strong>
          <ul className="portal-empty-list">
            <li>{copy.emptyBulletOne}</li>
            <li>{copy.emptyBulletTwo}</li>
            <li>{copy.emptyBulletThree}</li>
          </ul>
          <div className="portal-empty-actions">
            <Link
              className="btn primary"
              href={withOrgQuery("/app?quickAdd=1")}
            >
              {copy.addLead}
            </Link>
            {!onboardingComplete ? (
              <Link
                className="btn secondary"
                href={withOrgQuery("/app/onboarding?step=1")}
              >
                {copy.finishOnboarding}
              </Link>
            ) : null}
          </div>
        </div>
      ) : (
        <div className={`unified-inbox-shell ${isNarrow ? "narrow" : ""}`}>
          {(!isNarrow || view === "list") && (
            <section className="unified-inbox-panel unified-inbox-list">
              <header className="unified-inbox-panel-header">
                <div className="stack-cell" style={{ gap: 8 }}>
                  <div className="unified-inbox-panel-title">
                    <strong>{copy.conversations}</strong>
                    <span className="muted">
                      {filteredConversations.length}
                    </span>
                  </div>
                  <div
                    className="portal-empty-actions"
                    style={{ justifyContent: "flex-start", gap: 8 }}
                  >
                    <button
                      className={`btn ${lane === "all" ? "primary" : "secondary"}`}
                      type="button"
                      onClick={() => setLane("all")}
                    >
                      {copy.laneAll}
                    </button>
                    <button
                      className={`btn ${lane === "attention" ? "primary" : "secondary"}`}
                      type="button"
                      onClick={() => setLane("attention")}
                    >
                      {copy.laneAttention}
                    </button>
                    <button
                      className={`btn ${lane === "spam" ? "primary" : "secondary"}`}
                      type="button"
                      onClick={() => setLane("spam")}
                    >
                      {copy.laneSpam}
                    </button>
                  </div>
                </div>
                <input
                  ref={searchInputRef}
                  type="search"
                  inputMode="search"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="search"
                  className="unified-inbox-search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={copy.searchPlaceholder}
                  aria-label={copy.searchAria}
                />
              </header>

              <div className="unified-inbox-panel-scroll">
                {noSearchResults ? (
                  <div className="portal-empty-state" style={{ marginTop: 0 }}>
                    <strong>
                      {search.trim()
                        ? copy.noSearchResultsTitle
                        : copy.noLaneResultsTitle}
                    </strong>
                    <p className="muted">
                      {search.trim()
                        ? copy.noSearchResultsBody
                        : copy.noLaneResultsBody}
                    </p>
                    <div className="portal-empty-actions">
                      <button
                        className="btn secondary"
                        type="button"
                        onClick={() => {
                          setSearch("");
                          setLane("all");
                          searchInputRef.current?.focus();
                        }}
                      >
                        {copy.clearSearch}
                      </button>
                    </div>
                  </div>
                ) : (
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
                            onClick={() => handleSelectLead(row.leadId)}
                          >
                            <div className="thread-top">
                              <div className="inbox-thread-title">
                                <strong>{row.contactName}</strong>
                                {row.unreadCount ? (
                                  <span className="inbox-unread-badge">
                                    {row.unreadCount}
                                  </span>
                                ) : null}
                              </div>
                              <span className="muted">
                                {formatRelativeTimestamp(
                                  row.lastEventAt,
                                  locale,
                                  copy,
                                )}
                              </span>
                            </div>

                            <div className="inbox-thread-badges">
                              <span
                                className={`badge status-${row.status.toLowerCase()}`}
                              >
                                {formatLabel(row.status)}
                              </span>
                              <span
                                className={`badge priority-${row.priority.toLowerCase()}`}
                              >
                                {formatLabel(row.priority)}
                              </span>
                              <span className={`badge ${sourceClass}`}>
                                {formatLabel(row.sourceType)}
                              </span>
                              {overdueFollowUp ? (
                                <span className="badge status-overdue">
                                  {copy.overdue}
                                </span>
                              ) : null}
                              {row.atRisk ? (
                                <span className="badge status-overdue">
                                  {copy.atRisk}
                                </span>
                              ) : null}
                              {row.potentialSpam ? (
                                <span className="badge status-overdue">
                                  {copy.potentialSpam}
                                </span>
                              ) : null}
                              {row.failedOutboundCount > 0 ? (
                                <span className="badge status-overdue">
                                  {copy.failedSms}: {row.failedOutboundCount}
                                </span>
                              ) : null}
                            </div>

                            <p
                              className={`inbox-thread-snippet ${row.unreadCount ? "" : "muted"}`}
                            >
                              {row.lastSnippet || copy.noMessagesYet}
                            </p>

                            <div className="inbox-thread-channels">
                              {row.channels.sms ? (
                                <span className="inbox-channel-chip">SMS</span>
                              ) : null}
                              {row.channels.call ? (
                                <span className="inbox-channel-chip">
                                  {copy.call}
                                </span>
                              ) : null}
                              {row.channels.meta ? (
                                <span className="inbox-channel-chip">Meta</span>
                              ) : null}
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </section>
          )}

          {(!isNarrow || view === "thread") && (
            <section className="unified-inbox-panel unified-inbox-thread">
              <header className="unified-inbox-panel-header thread-header">
                {isNarrow ? (
                  <button
                    className="btn secondary inbox-back"
                    type="button"
                    onClick={() => setView("list")}
                  >
                    {copy.back}
                  </button>
                ) : null}

                <div className="thread-header-copy">
                  <strong>{leadTitle || copy.thread}</strong>
                  <span className="muted">{leadContext?.phoneE164 || ""}</span>
                </div>

                <div className="thread-header-actions">
                  {leadContext?.phoneE164 ? (
                    <a
                      className="btn secondary"
                      href={`tel:${leadContext.phoneE164}`}
                      aria-label={copy.call}
                    >
                      {copy.call}
                    </a>
                  ) : null}
                  {isNarrow ? (
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => setShowContextDrawer(true)}
                      aria-label={copy.jobContext}
                    >
                      {copy.info}
                    </button>
                  ) : (
                    <Link className="btn secondary" href={jobHref}>
                      {copy.openJob}
                    </Link>
                  )}
                </div>
              </header>

              <div className="unified-thread-scroll" ref={threadScrollRef}>
                {loadingThread && renderItems.length === 0 ? (
                  <p className="muted">{copy.loadingThread}</p>
                ) : threadError && renderItems.length === 0 ? (
                  <p className="form-status">{threadError}</p>
                ) : renderItems.length === 0 ? (
                  <p className="muted">{copy.noMessagesYet}</p>
                ) : (
                  <>
                    {threadError ? (
                      <p className="form-status">{threadError}</p>
                    ) : null}
                    {renderItems.map((item) => {
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
                            <span className="inbox-call-pill">
                              {callRowLabel(event)}
                            </span>
                          </div>
                        );
                      }

                      if (event.type === "system") {
                        return (
                          <div key={item.id} className="inbox-call-row">
                            <span className="inbox-call-pill">
                              {event.body || copy.update}
                            </span>
                          </div>
                        );
                      }

                      const inbound = event.direction !== "outbound";
                      const timeLabel = formatMessageTime(
                        event.createdAt,
                        locale,
                      );
                      const statusLabel =
                        !inbound && event.status
                          ? ` • ${event.status.toUpperCase()}`
                          : "";

                      return (
                        <div
                          key={item.id}
                          className={`message-row ${inbound ? "inbound" : "outbound"}`}
                        >
                          <div
                            className={`message-bubble ${inbound ? "inbound" : "outbound"}`}
                          >
                            <p>{event.body}</p>
                            <p className="message-meta">
                              {timeLabel}
                              {statusLabel}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>

              <div className="unified-thread-compose">
                <div className="template-pills">
                  <button
                    type="button"
                    className="template-chip"
                    onClick={() =>
                      setDraft(
                        locale.startsWith("es")
                          ? "Cual es la direccion o la calle mas cercana?"
                          : "What’s the address (or closest cross-street)?",
                      )
                    }
                    disabled={sending || !canManage}
                  >
                    {copy.askAddress}
                  </button>
                  <button
                    type="button"
                    className="template-chip"
                    onClick={() =>
                      setDraft(
                        locale.startsWith("es")
                          ? "Cuando buscas hacer esto: lo antes posible, esta semana, la proxima o solo cotizando?"
                          : "When are you looking to get this done — ASAP, this week, next week, or just getting a quote?",
                      )
                    }
                    disabled={sending || !canManage}
                  >
                    {copy.askTimeframe}
                  </button>
                  <button
                    type="button"
                    className="template-chip"
                    onClick={() =>
                      setDraft(
                        locale.startsWith("es")
                          ? "Entendido; te contactamos en breve."
                          : "Got it — we’ll reach out shortly.",
                      )
                    }
                    disabled={sending || !canManage}
                  >
                    {copy.acknowledge}
                  </button>
                </div>

                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={copy.typeMessage}
                  rows={3}
                  maxLength={1600}
                  disabled={!selectedLeadId || sending || !canManage}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void handleSend();
                    }
                  }}
                  aria-label={copy.messageComposer}
                />

                <div className="message-compose-actions">
                  <span className="muted">{draft.length}/1600</span>
                  <button
                    className="btn primary"
                    type="button"
                    onClick={() => void handleSend()}
                    disabled={
                      !draft.trim() || sending || !selectedLeadId || !canManage
                    }
                  >
                    {copy.send}
                  </button>
                </div>

                {!canManage ? (
                  <p className="muted">{copy.readOnlyBody}</p>
                ) : null}
                {sendStatus ? (
                  <p className="form-status">{sendStatus}</p>
                ) : null}
              </div>
            </section>
          )}

          {!isNarrow && (
            <section className="unified-inbox-panel unified-inbox-context">
              <header className="unified-inbox-panel-header">
                <strong>{copy.context}</strong>
                {leadContext ? (
                  <span className="muted">
                    {formatLabel(leadContext.status)}
                  </span>
                ) : null}
              </header>

              <div className="unified-inbox-panel-scroll context-scroll">
                <InboxContextPanel
                  leadContext={leadContext}
                  canManage={canManage}
                  jobHref={jobHref}
                  calendarHref={calendarHref}
                  initialEditing={Boolean(
                    initialOpenContextEditor &&
                    initialLeadId &&
                    selectedLeadId === initialLeadId,
                  )}
                  onSaved={handleLeadContextSaved}
                />
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
            aria-label={copy.jobContext}
            onClick={closeContextDrawer}
          />
          <div className="inbox-context-drawer-card">
            <div className="inbox-context-drawer-head">
              <strong>{copy.jobContext}</strong>
              <button
                className="btn secondary"
                type="button"
                onClick={closeContextDrawer}
              >
                {copy.close}
              </button>
            </div>

            <div className="inbox-context-drawer-body">
              <InboxContextPanel
                leadContext={leadContext}
                canManage={canManage}
                jobHref={jobHref}
                calendarHref={calendarHref}
                initialEditing={Boolean(
                  initialOpenContextEditor &&
                  initialLeadId &&
                  selectedLeadId === initialLeadId,
                )}
                onSaved={handleLeadContextSaved}
              />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
