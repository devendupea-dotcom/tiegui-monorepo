"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  addDays,
  addMinutes,
  addMonths,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfWeek,
  subDays,
  subMonths,
} from "date-fns";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import type { CalendarAccessRole, Role } from "@prisma/client";
import {
  clampSlotMinutes,
  clampWeekStartsOn,
  getMonthGridDays,
  getVisibleRange,
  minutesToHHmm,
  toUtcFromLocalDateTime,
  zonedDateTimeLabel,
  zonedTimeString,
} from "@/lib/calendar/dates";

type Worker = {
  id: string;
  name: string;
  email: string;
  calendarAccessRole: CalendarAccessRole;
  role: Role;
};

type CalendarSettings = {
  allowOverlaps: boolean;
  defaultSlotMinutes: number;
  defaultUntimedStartHour: number;
  calendarTimezone: string;
  weekStartsOn: 0 | 1;
};

type CalendarEvent = {
  id: string;
  orgId: string;
  leadId: string | null;
  type: string;
  provider: "LOCAL" | "GOOGLE";
  googleEventId: string | null;
  googleCalendarId: string | null;
  syncStatus: "PENDING" | "OK" | "ERROR";
  lastSyncedAt: string | null;
  status: string;
  busy: boolean;
  customerName: string | null;
  addressLine: string | null;
  allDay: boolean;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  assignedToUserId: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  durationMinutes: number;
  workerIds: string[];
  workers: Array<{ id: string; name: string }>;
  localPending?: boolean;
};

type CalendarView = "day" | "week" | "month";

type EventFormState = {
  mode: "create" | "edit";
  eventId: string | null;
  title: string;
  customerName: string;
  addressLine: string;
  description: string;
  type: string;
  status: string;
  busy: boolean;
  allDay: boolean;
  startLocal: string;
  endLocal: string;
  workerIds: string[];
};

type DragCreateState = {
  columnKey: string;
  dayKey: string;
  workerUserId?: string;
  startMinute: number;
  currentMinute: number;
};

type ResizeState = {
  eventId: string;
  dayKey: string;
  startY: number;
  initialDuration: number;
};

type ConflictState = {
  eventId: string;
  suggestedSlots: string[];
  durationMinutes: number;
};

type SlotActionState = {
  dateKey: string;
  startMinute: number;
  durationMinutes: number;
  workerUserId?: string;
};

type HoverSlotState = {
  columnKey: string;
  dayKey: string;
  workerUserId?: string;
  minute: number;
} | null;

type NextOpenDuration = 30 | 60 | 90;
type NextOpenFallbackStrategy = "OWNER" | "ROUND_ROBIN";

type FailedMutationState =
  | {
      kind: "move";
      eventId: string;
      targetDateKey: string;
      targetMinute: number | null;
    }
  | {
      kind: "resize";
      eventId: string;
      endAt: string;
    }
  | null;

const EVENT_TYPES = ["JOB", "ESTIMATE", "CALL", "BLOCK", "ADMIN", "TRAVEL"];
const EVENT_STATUSES = ["SCHEDULED", "CONFIRMED", "EN_ROUTE", "ON_SITE", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"];

const GRID_START_MINUTE = 6 * 60;
const GRID_END_MINUTE = 22 * 60;
const SLOT_ROW_HEIGHT = 26;
const NEXT_OPEN_DURATIONS: NextOpenDuration[] = [30, 60, 90];
const NEXT_OPEN_LOOKAHEAD_OPTIONS = [3, 7, 14] as const;

function clampNextOpenDuration(value: number): NextOpenDuration {
  if (value <= 30) return 30;
  if (value >= 90) return 90;
  return value >= 60 ? 60 : 30;
}

function toDateOnlyKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function fromUtcIsoToLocalInput(value: string, timeZone: string): string {
  return formatInTimeZone(new Date(value), timeZone, "yyyy-MM-dd'T'HH:mm");
}

function toUtcIsoFromLocalInput(value: string, timeZone: string): string {
  const [datePart, timePart] = value.split("T");
  if (!datePart || !timePart) {
    return new Date().toISOString();
  }
  return toUtcFromLocalDateTime({
    date: datePart,
    time: timePart,
    timeZone,
  }).toISOString();
}

function localMinutes(isoUtc: string, timeZone: string): number {
  const local = toZonedTime(new Date(isoUtc), timeZone);
  return local.getHours() * 60 + local.getMinutes();
}

function firstName(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return trimmed.split(" ")[0] || trimmed;
}

function canEditEvent(input: {
  internalUser: boolean;
  currentUserId: string;
  currentUserRole: CalendarAccessRole;
  event: CalendarEvent;
}): boolean {
  if (input.event.provider === "GOOGLE") return false;
  if (input.internalUser) return true;
  if (input.currentUserRole === "OWNER" || input.currentUserRole === "ADMIN") return true;
  if (input.currentUserRole === "READ_ONLY") return false;
  return input.event.workerIds.includes(input.currentUserId);
}

function getWeekDays(referenceDate: Date, weekStartsOn: 0 | 1): Date[] {
  const weekStart = startOfWeek(referenceDate, { weekStartsOn });
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

function toInitialForm(input: {
  mode: "create" | "edit";
  event: CalendarEvent | null;
  dateKey: string;
  minute: number;
  durationMinutes: number;
  workerIds: string[];
  timeZone: string;
}): EventFormState {
  if (input.event) {
    return {
      mode: input.mode,
      eventId: input.event.id,
      title: input.event.title,
      customerName: input.event.customerName || "",
      addressLine: input.event.addressLine || "",
      description: input.event.description || "",
      type: input.event.type,
      status: input.event.status,
      busy: input.event.busy,
      allDay: input.event.allDay,
      startLocal: fromUtcIsoToLocalInput(input.event.startAt, input.timeZone),
      endLocal: fromUtcIsoToLocalInput(
        input.event.endAt || addMinutes(new Date(input.event.startAt), input.event.durationMinutes).toISOString(),
        input.timeZone,
      ),
      workerIds: input.event.workerIds.length > 0 ? input.event.workerIds : input.workerIds,
    };
  }

  const startLocal = `${input.dateKey}T${minutesToHHmm(input.minute)}`;
  const endLocal = `${input.dateKey}T${minutesToHHmm(input.minute + input.durationMinutes)}`;
  return {
    mode: input.mode,
    eventId: null,
    title: "",
    customerName: "",
    addressLine: "",
    description: "",
    type: "JOB",
    status: "SCHEDULED",
    busy: true,
    allDay: false,
    startLocal,
    endLocal,
    workerIds: input.workerIds,
  };
}

export default function PremiumJobCalendar({
  orgId,
  orgName,
  internalUser,
  currentUserId,
  currentUserCalendarRole,
  defaultSettings,
  workers,
}: {
  orgId: string;
  orgName: string;
  internalUser: boolean;
  currentUserId: string;
  currentUserCalendarRole: CalendarAccessRole;
  defaultSettings: CalendarSettings;
  workers: Worker[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [view, setView] = useState<CalendarView>("week");
  const [slotMinutes, setSlotMinutes] = useState<15 | 30 | 60 | 90>(clampSlotMinutes(defaultSettings.defaultSlotMinutes));
  const [focusDate, setFocusDate] = useState<Date>(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<string[]>(
    workers.length > 0 ? workers.map((worker) => worker.id) : [],
  );
  const [dragCreate, setDragCreate] = useState<DragCreateState | null>(null);
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);
  const [eventForm, setEventForm] = useState<EventFormState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dayPanelDate, setDayPanelDate] = useState<Date | null>(null);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [slotAction, setSlotAction] = useState<SlotActionState | null>(null);
  const [monthPickerValue, setMonthPickerValue] = useState(format(new Date(), "yyyy-MM"));
  const [isMobile, setIsMobile] = useState(false);
  const [mobileExpandedDayKey, setMobileExpandedDayKey] = useState<string>(toDateOnlyKey(new Date()));
  const [failedMutation, setFailedMutation] = useState<FailedMutationState>(null);
  const [resolvingNextOpenDayKey, setResolvingNextOpenDayKey] = useState<string | null>(null);
  const [splitByWorker, setSplitByWorker] = useState(false);
  const [hoverSlot, setHoverSlot] = useState<HoverSlotState>(null);
  const [now, setNow] = useState<Date>(() => new Date());
  const [nextOpenDurationMinutes, setNextOpenDurationMinutes] = useState<NextOpenDuration>(
    clampNextOpenDuration(defaultSettings.defaultSlotMinutes),
  );
  const [nextOpenFallbackStrategy, setNextOpenFallbackStrategy] = useState<NextOpenFallbackStrategy>("OWNER");
  const [nextOpenLookaheadDays, setNextOpenLookaheadDays] = useState<number>(7);
  const quickActionHandledRef = useRef<string | null>(null);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 980px)");
    const apply = () => setIsMobile(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  const canWrite =
    internalUser || currentUserCalendarRole === "OWNER" || currentUserCalendarRole === "ADMIN" || currentUserCalendarRole === "WORKER";

  const weekStartsOn = clampWeekStartsOn(defaultSettings.weekStartsOn);
  const visibleRange = useMemo(
    () => getVisibleRange({ view, date: focusDate, weekStartsOn }),
    [focusDate, view, weekStartsOn],
  );

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        orgId,
        view,
        date: toDateOnlyKey(focusDate),
      });

      if (selectedWorkerIds.length > 0) {
        params.set("workerIds", selectedWorkerIds.join(","));
      }

      const response = await fetch(`/api/calendar/events?${params.toString()}`);
      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
            events?: CalendarEvent[];
          }
        | null;

      if (!response.ok || !payload?.ok) {
        setError(payload?.error || "Failed to load calendar events.");
        return;
      }

      setEvents(payload.events || []);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load calendar events.");
    } finally {
      setLoading(false);
    }
  }, [focusDate, orgId, selectedWorkerIds, view]);

  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    if (resizeState === null) return;
    const activeResize = resizeState;

    function onPointerMove(event: PointerEvent) {
      const deltaY = event.clientY - activeResize.startY;
      const slotDelta = Math.round(deltaY / SLOT_ROW_HEIGHT);
      const nextDuration = Math.max(slotMinutes, activeResize.initialDuration + slotDelta * slotMinutes);
      setEvents((current) =>
        current.map((item) =>
          item.id === activeResize.eventId
            ? {
                ...item,
                durationMinutes: nextDuration,
                endAt: addMinutes(new Date(item.startAt), nextDuration).toISOString(),
              }
            : item,
        ),
      );
    }

    async function onPointerUp() {
      const target = events.find((eventItem) => eventItem.id === activeResize.eventId);
      setResizeState(null);
      if (!target) return;
      const canEdit = canEditEvent({
        internalUser,
        currentUserId,
        currentUserRole: currentUserCalendarRole,
        event: target,
      });
      if (!canEdit || !canWrite) {
        return;
      }

      const nextEndAt = addMinutes(new Date(target.startAt), target.durationMinutes).toISOString();
      setEvents((current) =>
        current.map((item) =>
          item.id === target.id
            ? {
                ...item,
                endAt: nextEndAt,
                localPending: true,
              }
            : item,
        ),
      );
      const response = await fetch(`/api/calendar/events/${target.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId,
          endAt: nextEndAt,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; suggestedSlots?: string[]; event?: CalendarEvent }
        | null;
      if (response.status === 409 && payload?.suggestedSlots && payload.suggestedSlots.length > 0) {
        setConflict({
          eventId: target.id,
          suggestedSlots: payload.suggestedSlots,
          durationMinutes: target.durationMinutes,
        });
        setEvents((current) =>
          current.map((item) => (item.id === target.id ? { ...item, localPending: false } : item)),
        );
        return;
      }

      if (!response.ok || !payload?.ok || !payload.event) {
        setError(payload?.error || "Couldn't save - retry.");
        setFailedMutation({
          kind: "resize",
          eventId: target.id,
          endAt: nextEndAt,
        });
        return;
      }

      mergeEventFromServer(payload.event);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [
    canWrite,
    currentUserCalendarRole,
    currentUserId,
    events,
    fetchEvents,
    internalUser,
    orgId,
    resizeState,
    slotMinutes,
  ]);

  const daysForGrid = useMemo(() => {
    if (view === "day") return [focusDate];
    if (view === "week") return getWeekDays(focusDate, weekStartsOn);
    return getMonthGridDays({ date: focusDate, weekStartsOn });
  }, [focusDate, view, weekStartsOn]);

  const visibleEvents = useMemo(() => {
    if (selectedWorkerIds.length === 0) return events;
    return events.filter((eventItem) => eventItem.workerIds.some((id) => selectedWorkerIds.includes(id)));
  }, [events, selectedWorkerIds]);

  const eventsByDayKey = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const eventItem of visibleEvents) {
      const dayKey = localDateFromUtc(eventItem.startAt, defaultSettings.calendarTimezone);
      const list = map.get(dayKey);
      if (list) {
        list.push(eventItem);
      } else {
        map.set(dayKey, [eventItem]);
      }
    }

    for (const [key, list] of map.entries()) {
      map.set(
        key,
        [...list].sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()),
      );
    }

    return map;
  }, [defaultSettings.calendarTimezone, visibleEvents]);

  const dayOrWeekDays = useMemo(() => (view === "week" ? getWeekDays(focusDate, weekStartsOn) : [focusDate]), [focusDate, view, weekStartsOn]);
  const mobileWeekDays = useMemo(() => getWeekDays(focusDate, weekStartsOn), [focusDate, weekStartsOn]);

  const selectedWorkers = useMemo(() => {
    if (selectedWorkerIds.length === 0) return workers;
    const selectedSet = new Set(selectedWorkerIds);
    return workers.filter((worker) => selectedSet.has(worker.id));
  }, [selectedWorkerIds, workers]);

  const shouldSplitByWorker = splitByWorker && view !== "month" && selectedWorkers.length > 1;

  const gridColumns = useMemo(() => {
    if (view === "month") return [];
    if (!shouldSplitByWorker) {
      return dayOrWeekDays.map((day) => {
        const dayKey = toDateOnlyKey(day);
        return {
          key: dayKey,
          day,
          dayKey,
          dayLabel: format(day, "EEE d"),
          workerId: null as string | null,
          workerName: null as string | null,
        };
      });
    }

    return dayOrWeekDays.flatMap((day) => {
      const dayKey = toDateOnlyKey(day);
      return selectedWorkers.map((worker) => ({
        key: `${dayKey}-${worker.id}`,
        day,
        dayKey,
        dayLabel: format(day, "EEE d"),
        workerId: worker.id,
        workerName: firstName(worker.name),
      }));
    });
  }, [dayOrWeekDays, selectedWorkers, shouldSplitByWorker, view]);

  const slotMarkers = useMemo(() => {
    const markers: number[] = [];
    for (let minute = GRID_START_MINUTE; minute <= GRID_END_MINUTE; minute += slotMinutes) {
      markers.push(minute);
    }
    return markers;
  }, [slotMinutes]);

  const slotRows = useMemo(() => {
    const rows: Array<{ minute: number; top: number }> = [];
    for (let minute = GRID_START_MINUTE; minute < GRID_END_MINUTE; minute += slotMinutes) {
      rows.push({
        minute,
        top: ((minute - GRID_START_MINUTE) / slotMinutes) * SLOT_ROW_HEIGHT,
      });
    }
    return rows;
  }, [slotMinutes]);

  const totalGridHeight = ((GRID_END_MINUTE - GRID_START_MINUTE) / slotMinutes) * SLOT_ROW_HEIGHT;

  const nowIndicator = useMemo(() => {
    const todayKey = formatInTimeZone(now, defaultSettings.calendarTimezone, "yyyy-MM-dd");
    const minuteOfDay = localMinutes(now.toISOString(), defaultSettings.calendarTimezone);
    if (minuteOfDay < GRID_START_MINUTE || minuteOfDay > GRID_END_MINUTE) {
      return {
        show: false,
        dayKey: todayKey,
        top: 0,
        label: "",
      };
    }
    return {
      show: true,
      dayKey: todayKey,
      top: ((minuteOfDay - GRID_START_MINUTE) / slotMinutes) * SLOT_ROW_HEIGHT,
      label: `Now ${zonedTimeString(now, defaultSettings.calendarTimezone)}`,
    };
  }, [defaultSettings.calendarTimezone, now, slotMinutes]);

  const getDefaultWorkerIds = useCallback(() => {
    return currentUserCalendarRole === "WORKER" && !internalUser
      ? [currentUserId]
      : selectedWorkerIds.length > 0
        ? selectedWorkerIds.slice(0, 2)
        : workers.slice(0, 1).map((worker) => worker.id);
  }, [currentUserCalendarRole, currentUserId, internalUser, selectedWorkerIds, workers]);

  useEffect(() => {
    const quickAction = searchParams.get("quickAction")?.trim().toLowerCase() || "";
    if (!quickAction || !canWrite) {
      quickActionHandledRef.current = null;
      return;
    }

    const quickDate = searchParams.get("quickDate")?.trim() || "";
    const actionKey = `${quickAction}|${quickDate}|${slotMinutes}`;
    if (quickActionHandledRef.current === actionKey) {
      return;
    }
    quickActionHandledRef.current = actionKey;

    const localNow = toZonedTime(new Date(), defaultSettings.calendarTimezone);
    const dateKey = quickDate || format(localNow, "yyyy-MM-dd");
    const roundedMinute = Math.ceil((localNow.getHours() * 60 + localNow.getMinutes()) / slotMinutes) * slotMinutes;
    const minute = Math.max(
      GRID_START_MINUTE,
      Math.min(GRID_END_MINUTE - slotMinutes, roundedMinute || defaultSettings.defaultUntimedStartHour * 60),
    );

    const initial = toInitialForm({
      mode: "create",
      event: null,
      dateKey,
      minute,
      durationMinutes: slotMinutes,
      workerIds: getDefaultWorkerIds(),
      timeZone: defaultSettings.calendarTimezone,
    });

    if (quickAction === "block") {
      setEventForm({
        ...initial,
        type: "BLOCK",
        busy: true,
        title: "Blocked Time",
        customerName: "",
      });
    } else if (quickAction === "schedule") {
      setEventForm({
        ...initial,
        type: "JOB",
        status: "SCHEDULED",
        busy: true,
      });
    } else {
      return;
    }

    const nextDate = parseISO(`${dateKey}T00:00:00`);
    if (!Number.isNaN(nextDate.getTime())) {
      setFocusDate(nextDate);
      setDayPanelDate(nextDate);
      setView("day");
    }

    const params = new URLSearchParams(searchParams.toString());
    params.delete("quickAction");
    params.delete("quickDate");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [
    canWrite,
    defaultSettings.calendarTimezone,
    defaultSettings.defaultUntimedStartHour,
    getDefaultWorkerIds,
    pathname,
    router,
    searchParams,
    slotMinutes,
  ]);

  useEffect(() => {
    const requestedView = searchParams.get("view")?.trim().toLowerCase();
    if (requestedView === "day" || requestedView === "week" || requestedView === "month") {
      setView((current) => (current === requestedView ? current : (requestedView as CalendarView)));
    }

    const requestedDate = searchParams.get("date")?.trim();
    if (!requestedDate) return;
    const parsed = parseISO(`${requestedDate}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return;

    const parsedKey = toDateOnlyKey(parsed);
    if (parsedKey !== toDateOnlyKey(focusDate)) {
      setFocusDate(parsed);
      setMonthPickerValue(format(parsed, "yyyy-MM"));
    }
  }, [focusDate, searchParams]);

  useEffect(() => {
    if (view !== "week") return;
    const todayKey = toDateOnlyKey(new Date());
    const inCurrentWeek = mobileWeekDays.some((day) => toDateOnlyKey(day) === todayKey);
    setMobileExpandedDayKey(inCurrentWeek ? todayKey : toDateOnlyKey(mobileWeekDays[0] || new Date()));
  }, [mobileWeekDays, view]);

  useEffect(() => {
    if (view === "month" || selectedWorkerIds.length < 2) {
      setSplitByWorker(false);
    }
  }, [selectedWorkerIds, view]);

  function toggleWorker(workerId: string) {
    setSelectedWorkerIds((current) => {
      if (current.includes(workerId)) {
        if (current.length === 1) return current;
        return current.filter((id) => id !== workerId);
      }
      return [...current, workerId];
    });
  }

  function openNewEvent(input: { dateKey: string; minute: number; durationMinutes: number }) {
    if (!canWrite) return;
    const defaultWorkerIds = getDefaultWorkerIds();

    setEventForm(
      toInitialForm({
        mode: "create",
        event: null,
        dateKey: input.dateKey,
        minute: input.minute,
        durationMinutes: input.durationMinutes,
        workerIds: defaultWorkerIds,
        timeZone: defaultSettings.calendarTimezone,
      }),
    );
  }

  function openEditEvent(eventItem: CalendarEvent) {
    const canEdit = canEditEvent({
      internalUser,
      currentUserId,
      currentUserRole: currentUserCalendarRole,
      event: eventItem,
    });
    if (!canEdit || !canWrite) return;

    setEventForm(
      toInitialForm({
        mode: "edit",
        event: eventItem,
        dateKey: format(new Date(eventItem.startAt), "yyyy-MM-dd"),
        minute: GRID_START_MINUTE,
        durationMinutes: eventItem.durationMinutes,
        workerIds: eventItem.workerIds,
        timeZone: defaultSettings.calendarTimezone,
      }),
    );
  }

  function mergeEventFromServer(updatedEvent: CalendarEvent) {
    setEvents((current) =>
      current.map((item) =>
        item.id === updatedEvent.id
          ? {
              ...updatedEvent,
              localPending: false,
            }
          : item,
      ),
    );
    setFailedMutation(null);
  }

  async function submitEventForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!eventForm) return;
    setSubmitting(true);
    setError(null);

    const startAtUtc = toUtcIsoFromLocalInput(eventForm.startLocal, defaultSettings.calendarTimezone);
    const endAtUtc = toUtcIsoFromLocalInput(eventForm.endLocal, defaultSettings.calendarTimezone);
    const payload = {
      orgId,
      title: eventForm.title.trim(),
      customerName: eventForm.customerName.trim() || null,
      addressLine: eventForm.addressLine.trim() || null,
      description: eventForm.description.trim() || null,
      type: eventForm.type,
      status: eventForm.status,
      busy: eventForm.busy,
      allDay: eventForm.allDay,
      startAt: startAtUtc,
      endAt: endAtUtc,
      workerIds: eventForm.workerIds,
    };

    const url = eventForm.mode === "create" ? "/api/calendar/events" : `/api/calendar/events/${eventForm.eventId}`;
    const method = eventForm.mode === "create" ? "POST" : "PATCH";

    try {
      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
            suggestedSlots?: string[];
            event?: CalendarEvent;
          }
        | null;

      if (response.status === 409 && result?.suggestedSlots && result.suggestedSlots.length > 0 && eventForm.eventId) {
        setConflict({
          eventId: eventForm.eventId,
          suggestedSlots: result.suggestedSlots,
          durationMinutes: Math.max(
            slotMinutes,
            Math.round((new Date(payload.endAt).getTime() - new Date(payload.startAt).getTime()) / 60000),
          ),
        });
      }

      if (!response.ok || !result?.ok || !result.event) {
        setError(result?.error || "Couldn't save - retry.");
        return;
      }

      setEventForm(null);
      if (eventForm.mode === "create") {
        setEvents((current) => {
          const nextEvent = { ...result.event!, localPending: false };
          const exists = current.some((item) => item.id === nextEvent.id);
          if (exists) {
            return current.map((item) => (item.id === nextEvent.id ? nextEvent : item));
          }
          return [...current, nextEvent];
        });
      } else {
        mergeEventFromServer(result.event);
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not save event.");
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteEvent(eventId: string) {
    if (!canWrite) return;
    const response = await fetch(`/api/calendar/events/${eventId}`, { method: "DELETE" });
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!response.ok || !payload?.ok) {
      setError(payload?.error || "Failed to delete event.");
      return;
    }
    setEvents((current) => current.filter((item) => item.id !== eventId));
  }

  async function moveEvent(input: {
    eventId: string;
    targetDateKey: string;
    targetMinute: number | null;
  }) {
    const eventItem = events.find((item) => item.id === input.eventId);
    if (!eventItem) return;
    const canEdit = canEditEvent({
      internalUser,
      currentUserId,
      currentUserRole: currentUserCalendarRole,
      event: eventItem,
    });
    if (!canEdit || !canWrite) return;

    const existingTime = zonedTimeString(new Date(eventItem.startAt), defaultSettings.calendarTimezone);
    const minute = input.targetMinute ?? (eventItem.allDay ? defaultSettings.defaultUntimedStartHour * 60 : localMinutes(eventItem.startAt, defaultSettings.calendarTimezone));
    const nextTime = input.targetMinute === null ? existingTime : minutesToHHmm(minute);
    const nextStartUtc = toUtcFromLocalDateTime({
      date: input.targetDateKey,
      time: nextTime,
      timeZone: defaultSettings.calendarTimezone,
    });
    const nextEndUtc = addMinutes(nextStartUtc, eventItem.durationMinutes);

    setEvents((current) =>
      current.map((item) =>
        item.id === eventItem.id
          ? {
              ...item,
              startAt: nextStartUtc.toISOString(),
              endAt: nextEndUtc.toISOString(),
              localPending: true,
            }
          : item,
      ),
    );

    const response = await fetch(`/api/calendar/events/${eventItem.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orgId,
        startAt: nextStartUtc.toISOString(),
        endAt: nextEndUtc.toISOString(),
      }),
    });
    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; error?: string; suggestedSlots?: string[]; event?: CalendarEvent }
      | null;

    if (response.status === 409 && payload?.suggestedSlots && payload.suggestedSlots.length > 0) {
      setConflict({
        eventId: eventItem.id,
        suggestedSlots: payload.suggestedSlots,
        durationMinutes: eventItem.durationMinutes,
      });
      setEvents((current) =>
        current.map((item) =>
          item.id === eventItem.id
            ? {
                ...item,
                startAt: eventItem.startAt,
                endAt: eventItem.endAt,
                localPending: false,
              }
            : item,
        ),
      );
      return;
    }

    if (!response.ok || !payload?.ok || !payload.event) {
      setError(payload?.error || "Couldn't save - retry.");
      setFailedMutation({
        kind: "move",
        eventId: eventItem.id,
        targetDateKey: input.targetDateKey,
        targetMinute: input.targetMinute,
      });
      return;
    }

    mergeEventFromServer(payload.event);
  }

  async function applyConflictResolution(eventId: string, slotUtc: string, durationMinutes: number) {
    const startAt = new Date(slotUtc);
    const endAt = addMinutes(startAt, durationMinutes);
    const response = await fetch(`/api/calendar/events/${eventId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orgId,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
      }),
    });
    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; error?: string; event?: CalendarEvent }
      | null;
    if (!response.ok || !payload?.ok || !payload.event) {
      setError(payload?.error || "Could not resolve conflict.");
      return;
    }
    setConflict(null);
    mergeEventFromServer(payload.event);
  }

  async function retryFailedMutation() {
    if (!failedMutation) return;
    if (failedMutation.kind === "move") {
      await moveEvent({
        eventId: failedMutation.eventId,
        targetDateKey: failedMutation.targetDateKey,
        targetMinute: failedMutation.targetMinute,
      });
      return;
    }

    const response = await fetch(`/api/calendar/events/${failedMutation.eventId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orgId,
        endAt: failedMutation.endAt,
      }),
    });
    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; error?: string; event?: CalendarEvent }
      | null;
    if (!response.ok || !payload?.ok || !payload.event) {
      setError(payload?.error || "Couldn't save - retry.");
      return;
    }
    mergeEventFromServer(payload.event);
  }

  function navigate(offset: number) {
    if (view === "day") {
      setFocusDate((current) => (offset > 0 ? addDays(current, 1) : subDays(current, 1)));
      return;
    }
    if (view === "week") {
      setFocusDate((current) => addDays(current, offset * 7));
      return;
    }
    setFocusDate((current) => (offset > 0 ? addMonths(current, 1) : subMonths(current, 1)));
    setMonthPickerValue(format(offset > 0 ? addMonths(focusDate, 1) : subMonths(focusDate, 1), "yyyy-MM"));
  }

  function onMonthPickerChange(value: string) {
    setMonthPickerValue(value);
    const parsed = parseISO(`${value}-01T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) {
      setFocusDate(parsed);
    }
  }

  function openQuickLeadFromSlot(input: SlotActionState) {
    const startAt = toUtcFromLocalDateTime({
      date: input.dateKey,
      time: minutesToHHmm(input.startMinute),
      timeZone: defaultSettings.calendarTimezone,
    });

    const params = new URLSearchParams(searchParams.toString());
    params.set("quickAdd", "1");
    params.set("quickStart", startAt.toISOString());
    params.set("quickDuration", String(input.durationMinutes));
    if (orgId) {
      params.set("orgId", orgId);
    }
    if (input.workerUserId) {
      params.set("quickWorkerId", input.workerUserId);
    } else {
      params.delete("quickWorkerId");
    }

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    setSlotAction(null);
  }

  function deepLinkToDayView(dayKey: string) {
    const parsed = parseISO(`${dayKey}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) {
      setFocusDate(parsed);
      setMonthPickerValue(format(parsed, "yyyy-MM"));
      setView("day");
      setDayPanelDate(parsed);
    }

    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "day");
    params.set("date", dayKey);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  async function scheduleNextOpenFromDay(dayKey: string) {
    if (!canWrite || resolvingNextOpenDayKey) {
      return;
    }

    const preferredWorkerId = getDefaultWorkerIds()[0] || selectedWorkerIds[0] || workers[0]?.id;
    if (!preferredWorkerId) {
      openQuickLeadFromSlot({
        dateKey: dayKey,
        startMinute: defaultSettings.defaultUntimedStartHour * 60,
        durationMinutes: nextOpenDurationMinutes,
      });
      return;
    }

    setResolvingNextOpenDayKey(dayKey);
    setError(null);
    try {
      const response = await fetch("/api/availability/next-open", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId,
          date: dayKey,
          durationMinutes: nextOpenDurationMinutes,
          lookaheadDays: nextOpenLookaheadDays,
          preferredWorkerId,
          fallbackStrategy: nextOpenFallbackStrategy,
          candidateWorkerIds: workers.map((worker) => worker.id),
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
            slot?: string;
            workerId?: string;
          }
        | null;

      if (!response.ok || !payload?.ok || !payload.slot) {
        setError(payload?.error || "Couldn't find open time.");
        return;
      }

      const selectedSlot = new Date(payload.slot);
      if (Number.isNaN(selectedSlot.getTime())) {
        setError("Couldn't find open time.");
        return;
      }

      const local = toZonedTime(selectedSlot, defaultSettings.calendarTimezone);
      const slotDateKey = formatInTimeZone(selectedSlot, defaultSettings.calendarTimezone, "yyyy-MM-dd");

      openQuickLeadFromSlot({
        dateKey: slotDateKey,
        startMinute: local.getHours() * 60 + local.getMinutes(),
        durationMinutes: nextOpenDurationMinutes,
        workerUserId: payload.workerId || preferredWorkerId,
      });
    } catch {
      setError("Couldn't find open time.");
    } finally {
      setResolvingNextOpenDayKey(null);
    }
  }

  const dayPanelEvents = useMemo(() => {
    if (!dayPanelDate) return [];
    const dayKey = toDateOnlyKey(dayPanelDate);
    return eventsByDayKey.get(dayKey) || [];
  }, [dayPanelDate, eventsByDayKey]);

  return (
    <section className="jobcal-shell card">
      <header className="jobcal-toolbar">
        <div className="jobcal-toolbar-primary">
          <p className="jobcal-kicker">Job Calendar</p>
          <h2>{orgName}</h2>
          <p className="muted">Time zone: {defaultSettings.calendarTimezone}</p>
        </div>

        <div className="jobcal-toolbar-controls">
          <div className="jobcal-segment">
            {(["day", "week", "month"] as const).map((item) => (
              <button
                key={item}
                type="button"
                className={`jobcal-segment-btn ${view === item ? "active" : ""}`}
                onClick={() => setView(item)}
              >
                {item.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="jobcal-nav">
            <button type="button" className="btn secondary" onClick={() => navigate(-1)}>
              Prev
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                setFocusDate(new Date());
                setMonthPickerValue(format(new Date(), "yyyy-MM"));
              }}
            >
              Today
            </button>
            <button type="button" className="btn secondary" onClick={() => navigate(1)}>
              Next
            </button>
          </div>

          <div className="jobcal-segment">
            {[15, 30, 60, 90].map((interval) => (
              <button
                key={interval}
                type="button"
                className={`jobcal-segment-btn ${slotMinutes === interval ? "active" : ""}`}
                onClick={() => setSlotMinutes(clampSlotMinutes(interval))}
              >
                {interval}m
              </button>
            ))}
          </div>

          <input
            type="month"
            value={monthPickerValue}
            className="jobcal-month-picker"
            onChange={(event) => onMonthPickerChange(event.target.value)}
          />

          <details className="jobcal-worker-filter">
            <summary>Workers ({selectedWorkerIds.length})</summary>
            <div className="jobcal-worker-list">
              {workers.map((worker) => (
                <label key={worker.id}>
                  <input
                    type="checkbox"
                    checked={selectedWorkerIds.includes(worker.id)}
                    onChange={() => toggleWorker(worker.id)}
                  />
                  <span>{worker.name}</span>
                </label>
              ))}
            </div>
          </details>

          {view !== "month" && selectedWorkerIds.length > 1 ? (
            <label className="jobcal-split-toggle">
              <input type="checkbox" checked={splitByWorker} onChange={(event) => setSplitByWorker(event.target.checked)} />
              <span>Split by worker</span>
            </label>
          ) : null}
        </div>
      </header>

      <div className="jobcal-header-row">
        <strong>
          {view === "month"
            ? format(focusDate, "MMMM yyyy")
            : `${format(visibleRange.rangeStart, "MMM d")} - ${format(addDays(visibleRange.rangeEnd, -1), "MMM d, yyyy")}`}
        </strong>
        <span className="muted">
          {loading ? "Loading events..." : `${visibleEvents.length} events`}
        </span>
      </div>

      {error ? (
        <div className="jobcal-error-row">
          <p className="form-status">{error}</p>
          {failedMutation ? (
            <button type="button" className="btn secondary" onClick={() => void retryFailedMutation()}>
              Retry save
            </button>
          ) : null}
        </div>
      ) : null}

      {view === "month" ? (
        <div className="jobcal-month">
          <div className="jobcal-month-weekdays">
            {getWeekDays(focusDate, weekStartsOn).map((day) => (
              <span key={day.toISOString()}>{format(day, "EEE")}</span>
            ))}
          </div>
          <div className="jobcal-month-grid">
            {daysForGrid.map((day) => {
              const dayKey = toDateOnlyKey(day);
              const eventsForDay = eventsByDayKey.get(dayKey) || [];
              const visibleChips = eventsForDay.slice(0, 3);
              const overflow = Math.max(0, eventsForDay.length - visibleChips.length);
              return (
                <button
                  key={dayKey}
                  type="button"
                  className={`jobcal-month-day ${isSameMonth(day, focusDate) ? "" : "outside"}`}
                  onClick={() => setDayPanelDate(day)}
                  onDragOver={(event) => {
                    event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const eventId = event.dataTransfer.getData("text/calendar-event-id");
                    if (!eventId) return;
                    void moveEvent({
                      eventId,
                      targetDateKey: dayKey,
                      targetMinute: null,
                    });
                  }}
                >
                  <span className={`jobcal-month-date ${isSameDay(day, new Date()) ? "today" : ""}`}>{format(day, "d")}</span>
                  <div className="jobcal-month-chips">
                    {visibleChips.map((eventItem) => (
                      <span
                        key={eventItem.id}
                        draggable={
                          canEditEvent({
                            internalUser,
                            currentUserId,
                            currentUserRole: currentUserCalendarRole,
                            event: eventItem,
                          }) && canWrite
                        }
                        onDragStart={(dragEvent) => {
                          if (
                            !canEditEvent({
                              internalUser,
                              currentUserId,
                              currentUserRole: currentUserCalendarRole,
                              event: eventItem,
                            }) ||
                            !canWrite
                          ) {
                            dragEvent.preventDefault();
                            return;
                          }
                          dragEvent.dataTransfer.setData("text/calendar-event-id", eventItem.id);
                        }}
                        className={`jobcal-chip type-${eventItem.type.toLowerCase()}`}
                      >
                        <strong>{zonedTimeString(new Date(eventItem.startAt), defaultSettings.calendarTimezone)}</strong>
                        <span>{firstName(eventItem.customerName || eventItem.title)}</span>
                      </span>
                    ))}
                    {overflow > 0 ? <span className="jobcal-more">+{overflow} more</span> : null}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : view === "week" && isMobile ? (
        <div className="jobcal-mobile-week">
          <div className="jobcal-mobile-strip">
            {mobileWeekDays.map((day) => {
              const dayKey = toDateOnlyKey(day);
              const count = (eventsByDayKey.get(dayKey) || []).length;
              const loadClass = count >= 7 ? "heavy" : count >= 4 ? "med" : count >= 1 ? "light" : "none";
              return (
                <button
                  key={dayKey}
                  type="button"
                  className={`jobcal-mobile-day-pill ${mobileExpandedDayKey === dayKey ? "active" : ""}`}
                  onClick={() => setMobileExpandedDayKey(dayKey)}
                >
                  <span>{format(day, "EEE")}</span>
                  <strong>{format(day, "d")}</strong>
                  <em>{count}</em>
                  <i className={`jobcal-load ${loadClass}`} />
                </button>
              );
            })}
          </div>

          <div className="jobcal-mobile-week-list">
            {mobileWeekDays.map((day) => {
              const dayKey = toDateOnlyKey(day);
              const eventsForDay = eventsByDayKey.get(dayKey) || [];
              const expanded = mobileExpandedDayKey === dayKey;
              return (
                <section key={dayKey} className={`jobcal-mobile-day ${expanded ? "expanded" : ""}`}>
                  <button type="button" className="jobcal-mobile-day-header" onClick={() => setMobileExpandedDayKey(dayKey)}>
                    <span>
                      <strong>{format(day, "EEEE")}</strong>
                      <span className="muted">{format(day, "MMM d")}</span>
                    </span>
                    <span className="jobcal-mobile-day-meta">
                      <span className="muted">{eventsForDay.length} jobs</span>
                      <span aria-hidden>{expanded ? "▾" : "▸"}</span>
                    </span>
                  </button>

                  {expanded ? (
                    <>
                      {eventsForDay.length > 0 ? (
                        <ul className="jobcal-mobile-events">
                          {eventsForDay.map((eventItem) => {
                            const canEdit = canEditEvent({
                              internalUser,
                              currentUserId,
                              currentUserRole: currentUserCalendarRole,
                              event: eventItem,
                            });
                            return (
                              <li key={eventItem.id} className="jobcal-mobile-event">
                                <div className="stack-cell">
                                  <strong className="jobcal-event-title">{eventItem.customerName || eventItem.title}</strong>
                                  <span className="jobcal-event-time">
                                    {zonedTimeString(new Date(eventItem.startAt), defaultSettings.calendarTimezone)} -{" "}
                                    {zonedTimeString(
                                      new Date(
                                        eventItem.endAt ||
                                          addMinutes(new Date(eventItem.startAt), eventItem.durationMinutes).toISOString(),
                                      ),
                                      defaultSettings.calendarTimezone,
                                    )}
                                  </span>
                                  {eventItem.addressLine ? <span className="jobcal-event-address">{eventItem.addressLine}</span> : null}
                                  <span className={`jobcal-status-chip status-${eventItem.status.toLowerCase()}`}>
                                    {eventItem.status.replaceAll("_", " ")}
                                    {eventItem.localPending ? " • Pending" : ""}
                                  </span>
                                </div>
                                <div className="jobcal-mobile-event-actions">
                                  {canEdit && canWrite ? (
                                    <button type="button" className="btn secondary" onClick={() => openEditEvent(eventItem)}>
                                      Edit
                                    </button>
                                  ) : (
                                    <span className="muted">Read-only</span>
                                  )}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="muted jobcal-mobile-empty">No jobs scheduled.</p>
                      )}
                      {canWrite ? (
                        <div className="jobcal-mobile-day-cta">
                          <div className="jobcal-mobile-next-open-row">
                            <button
                              type="button"
                              className="btn primary"
                              onClick={() => void scheduleNextOpenFromDay(dayKey)}
                              disabled={Boolean(resolvingNextOpenDayKey)}
                            >
                              {resolvingNextOpenDayKey === dayKey ? "Finding open time..." : "Schedule next open time"}
                            </button>
                            <label className="jobcal-mobile-next-open-duration">
                              <span>Duration</span>
                              <select
                                value={nextOpenDurationMinutes}
                                onChange={(event) =>
                                  setNextOpenDurationMinutes(
                                    clampNextOpenDuration(Number.parseInt(event.target.value, 10)),
                                  )
                                }
                                disabled={Boolean(resolvingNextOpenDayKey)}
                              >
                                {NEXT_OPEN_DURATIONS.map((duration) => (
                                  <option key={duration} value={duration}>
                                    {duration}m
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                          <div className="jobcal-mobile-next-open-options">
                            <label>
                              <span>Fallback</span>
                              <select
                                value={nextOpenFallbackStrategy}
                                onChange={(event) =>
                                  setNextOpenFallbackStrategy(
                                    event.target.value === "ROUND_ROBIN" ? "ROUND_ROBIN" : "OWNER",
                                  )
                                }
                                disabled={Boolean(resolvingNextOpenDayKey)}
                              >
                                <option value="OWNER">Owner</option>
                                <option value="ROUND_ROBIN">Round-robin</option>
                              </select>
                            </label>
                            <label>
                              <span>Window</span>
                              <select
                                value={nextOpenLookaheadDays}
                                onChange={(event) => {
                                  const parsed = Number.parseInt(event.target.value, 10);
                                  setNextOpenLookaheadDays(
                                    NEXT_OPEN_LOOKAHEAD_OPTIONS.includes(parsed as (typeof NEXT_OPEN_LOOKAHEAD_OPTIONS)[number])
                                      ? parsed
                                      : 7,
                                  );
                                }}
                                disabled={Boolean(resolvingNextOpenDayKey)}
                              >
                                {NEXT_OPEN_LOOKAHEAD_OPTIONS.map((days) => (
                                  <option key={days} value={days}>
                                    {days} days
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                          <button
                            type="button"
                            className="btn secondary"
                            onClick={() => deepLinkToDayView(dayKey)}
                            disabled={Boolean(resolvingNextOpenDayKey)}
                          >
                            Pick exact time
                          </button>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="jobcal-grid-shell">
          <div className="jobcal-time-column" style={{ height: totalGridHeight + 1 }}>
            {slotMarkers.map((minute) => (
              <span key={minute} style={{ top: ((minute - GRID_START_MINUTE) / slotMinutes) * SLOT_ROW_HEIGHT }}>
                {minutesToHHmm(minute)}
              </span>
            ))}
            {nowIndicator.show ? (
              <span className="jobcal-now-label" style={{ top: nowIndicator.top }}>
                {nowIndicator.label}
              </span>
            ) : null}
          </div>

          <div className={`jobcal-day-columns-scroll ${shouldSplitByWorker ? "split" : ""}`}>
            <div
              className={`jobcal-day-columns ${view === "day" ? "single" : ""} ${shouldSplitByWorker ? "split" : ""}`}
              style={{
                gridTemplateColumns: `repeat(${gridColumns.length}, minmax(${shouldSplitByWorker ? 220 : 0}px, 1fr))`,
              }}
            >
              {gridColumns.map((column) => {
                const day = column.day;
                const dayKey = column.dayKey;
                const eventsForDay = visibleEvents.filter((eventItem) => {
                  const matchesWorker = !column.workerId || eventItem.workerIds.includes(column.workerId);
                  if (!matchesWorker) return false;
                  const start = toZonedTime(new Date(eventItem.startAt), defaultSettings.calendarTimezone);
                  const end = toZonedTime(
                    new Date(
                      eventItem.endAt || addMinutes(new Date(eventItem.startAt), eventItem.durationMinutes).toISOString(),
                    ),
                    defaultSettings.calendarTimezone,
                  );
                  const dayStart = parseISO(`${dayKey}T00:00:00`);
                  const dayEnd = addDays(dayStart, 1);
                  return start < dayEnd && end > dayStart;
                });
                const isToday = isSameDay(day, new Date());
                const hoverTop =
                  hoverSlot && hoverSlot.columnKey === column.key
                    ? ((hoverSlot.minute - GRID_START_MINUTE) / slotMinutes) * SLOT_ROW_HEIGHT
                    : null;

                return (
                  <div key={column.key} className="jobcal-day-column-wrap">
                    <div className="jobcal-day-label">
                      <strong>{column.dayLabel}</strong>
                      <span className="jobcal-day-meta">
                        {column.workerName ? <span className="jobcal-worker-pill">{column.workerName}</span> : null}
                        {isToday ? <span className="jobcal-today-pill">Today</span> : null}
                      </span>
                    </div>

                    <div
                      className={`jobcal-day-column ${canWrite ? "can-write" : "readonly"}`}
                      style={{ height: totalGridHeight }}
                      onPointerDown={(pointerEvent) => {
                        if (!canWrite) return;
                        const target = pointerEvent.target as HTMLElement;
                        if (target.closest(".jobcal-event-block, .jobcal-slot-add-btn")) return;
                        const rect = (pointerEvent.currentTarget as HTMLDivElement).getBoundingClientRect();
                        const y = Math.max(0, pointerEvent.clientY - rect.top);
                        const snappedSlot = Math.floor(y / SLOT_ROW_HEIGHT);
                        const minute = Math.max(
                          GRID_START_MINUTE,
                          Math.min(GRID_END_MINUTE - slotMinutes, GRID_START_MINUTE + snappedSlot * slotMinutes),
                        );
                        setHoverSlot({
                          columnKey: column.key,
                          dayKey,
                          workerUserId: column.workerId || undefined,
                          minute,
                        });
                        setDragCreate({
                          columnKey: column.key,
                          dayKey,
                          workerUserId: column.workerId || undefined,
                          startMinute: minute,
                          currentMinute: minute + slotMinutes,
                        });
                        (pointerEvent.currentTarget as HTMLDivElement).setPointerCapture(pointerEvent.pointerId);
                      }}
                      onPointerMove={(pointerEvent) => {
                        const rect = (pointerEvent.currentTarget as HTMLDivElement).getBoundingClientRect();
                        const y = Math.max(0, pointerEvent.clientY - rect.top);
                        const snappedSlot = Math.floor(y / SLOT_ROW_HEIGHT);
                        const minute = Math.max(
                          GRID_START_MINUTE,
                          Math.min(GRID_END_MINUTE - slotMinutes, GRID_START_MINUTE + snappedSlot * slotMinutes),
                        );
                        if (canWrite) {
                          setHoverSlot({
                            columnKey: column.key,
                            dayKey,
                            workerUserId: column.workerId || undefined,
                            minute,
                          });
                        }
                        if (!dragCreate || dragCreate.columnKey !== column.key) return;
                        setDragCreate((current) =>
                          current
                            ? {
                                ...current,
                                currentMinute: Math.max(
                                  GRID_START_MINUTE + slotMinutes,
                                  Math.min(GRID_END_MINUTE, minute + slotMinutes),
                                ),
                              }
                            : null,
                        );
                      }}
                      onPointerLeave={() =>
                        setHoverSlot((current) => (current && current.columnKey === column.key ? null : current))
                      }
                      onPointerUp={() => {
                        if (!dragCreate || dragCreate.columnKey !== column.key) return;
                        const startMinute = Math.max(
                          GRID_START_MINUTE,
                          Math.min(dragCreate.startMinute, dragCreate.currentMinute),
                        );
                        const endMinute = Math.max(
                          startMinute + slotMinutes,
                          Math.max(dragCreate.startMinute, dragCreate.currentMinute),
                        );
                        setDragCreate(null);
                        setSlotAction({
                          dateKey: dayKey,
                          startMinute,
                          durationMinutes: endMinute - startMinute,
                          workerUserId: dragCreate.workerUserId,
                        });
                      }}
                      onDragOver={(dragEvent) => {
                        dragEvent.preventDefault();
                      }}
                      onDrop={(dragEvent) => {
                        dragEvent.preventDefault();
                        const eventId = dragEvent.dataTransfer.getData("text/calendar-event-id");
                        if (!eventId) return;
                        const rect = (dragEvent.currentTarget as HTMLDivElement).getBoundingClientRect();
                        const y = Math.max(0, dragEvent.clientY - rect.top);
                        const slotIndex = Math.floor(y / SLOT_ROW_HEIGHT);
                        const minute = GRID_START_MINUTE + slotIndex * slotMinutes;
                        void moveEvent({
                          eventId,
                          targetDateKey: dayKey,
                          targetMinute: minute,
                        });
                      }}
                    >
                      {slotRows.map((row) => (
                        <div
                          key={`${column.key}-row-${row.minute}`}
                          className={`jobcal-slot-row ${Math.floor(row.minute / 60) % 2 === 0 ? "even" : "odd"}`}
                          style={{ top: row.top, height: SLOT_ROW_HEIGHT }}
                        />
                      ))}

                      {slotMarkers.map((minute) => (
                        <div
                          key={`${column.key}-${minute}`}
                          className={`jobcal-slot-line ${minute % 60 === 0 ? "hour" : minute % 30 === 0 ? "half" : "minor"}`}
                          style={{ top: ((minute - GRID_START_MINUTE) / slotMinutes) * SLOT_ROW_HEIGHT }}
                        />
                      ))}

                      {nowIndicator.show && nowIndicator.dayKey === dayKey ? (
                        <div className="jobcal-now-line" style={{ top: nowIndicator.top }} />
                      ) : null}

                      {canWrite && hoverTop !== null && !dragCreate ? (
                        <div className="jobcal-slot-hover" style={{ top: hoverTop }}>
                          <button
                            type="button"
                            className="jobcal-slot-add-btn"
                            onPointerDown={(pointerEvent) => {
                              pointerEvent.preventDefault();
                              pointerEvent.stopPropagation();
                            }}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              if (!hoverSlot) return;
                              setSlotAction({
                                dateKey: dayKey,
                                startMinute: hoverSlot.minute,
                                durationMinutes: slotMinutes,
                                workerUserId: hoverSlot.workerUserId,
                              });
                            }}
                          >
                            + Add job
                          </button>
                        </div>
                      ) : null}

                      {dragCreate && dragCreate.columnKey === column.key ? (
                        <div
                          className="jobcal-drag-create"
                          style={{
                            top:
                              ((Math.min(dragCreate.startMinute, dragCreate.currentMinute) - GRID_START_MINUTE) / slotMinutes) *
                              SLOT_ROW_HEIGHT,
                            height:
                              (Math.max(
                                slotMinutes,
                                Math.abs(dragCreate.currentMinute - dragCreate.startMinute),
                              ) /
                                slotMinutes) *
                              SLOT_ROW_HEIGHT,
                          }}
                        />
                      ) : null}

                      {eventsForDay.map((eventItem) => {
                        const startMinute = localMinutes(eventItem.startAt, defaultSettings.calendarTimezone);
                        const endMinute = localMinutes(
                          eventItem.endAt || addMinutes(new Date(eventItem.startAt), eventItem.durationMinutes).toISOString(),
                          defaultSettings.calendarTimezone,
                        );
                        const clampedStart = Math.max(GRID_START_MINUTE, Math.min(GRID_END_MINUTE - slotMinutes, startMinute));
                        const clampedEnd = Math.max(clampedStart + slotMinutes, Math.min(GRID_END_MINUTE, endMinute));
                        const top = ((clampedStart - GRID_START_MINUTE) / slotMinutes) * SLOT_ROW_HEIGHT;
                        const height = Math.max(
                          SLOT_ROW_HEIGHT,
                          ((clampedEnd - clampedStart) / slotMinutes) * SLOT_ROW_HEIGHT,
                        );
                        const canEdit = canEditEvent({
                          internalUser,
                          currentUserId,
                          currentUserRole: currentUserCalendarRole,
                          event: eventItem,
                        });

                        return (
                          <article
                            key={eventItem.id}
                            draggable={canEdit && canWrite}
                            onDragStart={(dragEvent) => {
                              dragEvent.dataTransfer.setData("text/calendar-event-id", eventItem.id);
                            }}
                            className={`jobcal-event-block type-${eventItem.type.toLowerCase()} ${canEdit ? "editable" : "readonly"} ${eventItem.localPending ? "pending" : ""}`}
                            style={{ top, height }}
                            onDoubleClick={() => openEditEvent(eventItem)}
                          >
                            <button
                              type="button"
                              className="jobcal-event-body"
                              onClick={() => openEditEvent(eventItem)}
                              disabled={!canEdit || !canWrite}
                            >
                              <p className="jobcal-event-title">{eventItem.customerName || eventItem.title}</p>
                              <p className="jobcal-event-time">
                                {zonedTimeString(new Date(eventItem.startAt), defaultSettings.calendarTimezone)} -{" "}
                                {zonedTimeString(
                                  new Date(
                                    eventItem.endAt ||
                                      addMinutes(new Date(eventItem.startAt), eventItem.durationMinutes).toISOString(),
                                  ),
                                  defaultSettings.calendarTimezone,
                                )}
                              </p>
                              {eventItem.addressLine ? <p className="jobcal-event-address">{eventItem.addressLine}</p> : null}
                              <span className={`jobcal-status-chip status-${eventItem.status.toLowerCase()}`}>
                                {eventItem.status.replaceAll("_", " ")}
                                {eventItem.localPending ? " • Pending" : ""}
                              </span>
                            </button>
                            {canEdit && canWrite ? (
                              <span
                                role="button"
                                tabIndex={0}
                                className="jobcal-resize-handle"
                                onPointerDown={(pointerEvent) => {
                                  pointerEvent.preventDefault();
                                  pointerEvent.stopPropagation();
                                  setResizeState({
                                    eventId: eventItem.id,
                                    dayKey,
                                    startY: pointerEvent.clientY,
                                    initialDuration: eventItem.durationMinutes,
                                  });
                                }}
                              />
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {dayPanelDate ? (
        <aside className="jobcal-day-panel">
          <header>
            <strong>{format(dayPanelDate, "EEEE, MMM d")}</strong>
            <button type="button" className="btn secondary" onClick={() => setDayPanelDate(null)}>
              Close
            </button>
          </header>

          <div className="jobcal-day-panel-list">
            {dayPanelEvents.length === 0 ? <p className="muted">No events for this day.</p> : null}
            {dayPanelEvents.map((eventItem) => (
              <article key={eventItem.id} className="jobcal-day-panel-item">
                <div>
                  <p className="jobcal-event-title">{eventItem.customerName || eventItem.title}</p>
                  <p className="jobcal-event-time">
                    {zonedDateTimeLabel(new Date(eventItem.startAt), defaultSettings.calendarTimezone)}
                  </p>
                  {eventItem.addressLine ? <p className="jobcal-event-address">{eventItem.addressLine}</p> : null}
                </div>
                <div className="jobcal-day-panel-actions">
                  {canEditEvent({
                    internalUser,
                    currentUserId,
                    currentUserRole: currentUserCalendarRole,
                    event: eventItem,
                  }) && canWrite ? (
                    <button type="button" className="btn secondary" onClick={() => openEditEvent(eventItem)}>
                      Edit
                    </button>
                  ) : (
                    <span className="muted">Read-only</span>
                  )}
                  {canEditEvent({
                    internalUser,
                    currentUserId,
                    currentUserRole: currentUserCalendarRole,
                    event: eventItem,
                  }) && canWrite ? (
                    <button type="button" className="btn secondary" onClick={() => void deleteEvent(eventItem.id)}>
                      Delete
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>

          {canWrite ? (
            <div className="jobcal-day-panel-cta">
              <button
                type="button"
                className="btn primary"
                onClick={() =>
                  openNewEvent({
                    dateKey: toDateOnlyKey(dayPanelDate),
                    minute: defaultSettings.defaultUntimedStartHour * 60,
                    durationMinutes: slotMinutes,
                  })
                }
              >
                Add Event
              </button>
              <button
                type="button"
                className="btn secondary"
                onClick={() =>
                  openQuickLeadFromSlot({
                    dateKey: toDateOnlyKey(dayPanelDate),
                    startMinute: defaultSettings.defaultUntimedStartHour * 60,
                    durationMinutes: 30,
                  })
                }
              >
                Add Lead
              </button>
            </div>
          ) : null}
        </aside>
      ) : null}

      {slotAction ? (
        <div className="jobcal-modal-backdrop" role="dialog" aria-modal>
          <div className="jobcal-modal">
            <header>
              <strong>Add from Empty Slot</strong>
            </header>
            <p className="muted">
              {slotAction.dateKey} at {minutesToHHmm(slotAction.startMinute)} for {slotAction.durationMinutes} minutes.
            </p>
            <div className="jobcal-modal-actions">
              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  openNewEvent({
                    dateKey: slotAction.dateKey,
                    minute: slotAction.startMinute,
                    durationMinutes: slotAction.durationMinutes,
                  });
                  setSlotAction(null);
                }}
              >
                Create Event
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => openQuickLeadFromSlot(slotAction)}
              >
                Add Lead + Schedule
              </button>
              <button type="button" className="btn secondary" onClick={() => setSlotAction(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {eventForm ? (
        <div className="jobcal-modal-backdrop" role="dialog" aria-modal>
          <div className="jobcal-modal">
            <header>
              <strong>{eventForm.mode === "create" ? "Create Event" : "Edit Event"}</strong>
            </header>
            <form className="auth-form" onSubmit={submitEventForm}>
              <label>
                Customer / Title
                <input
                  required
                  value={eventForm.title}
                  onChange={(event) => setEventForm((current) => (current ? { ...current, title: event.target.value } : current))}
                />
              </label>

              <label>
                Customer Name
                <input
                  value={eventForm.customerName}
                  onChange={(event) =>
                    setEventForm((current) => (current ? { ...current, customerName: event.target.value } : current))
                  }
                />
              </label>

              <label>
                Address
                <input
                  value={eventForm.addressLine}
                  onChange={(event) =>
                    setEventForm((current) => (current ? { ...current, addressLine: event.target.value } : current))
                  }
                />
              </label>

              <label>
                Type
                <select
                  value={eventForm.type}
                  onChange={(event) => setEventForm((current) => (current ? { ...current, type: event.target.value } : current))}
                >
                  {EVENT_TYPES.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Status
                <select
                  value={eventForm.status}
                  onChange={(event) =>
                    setEventForm((current) => (current ? { ...current, status: event.target.value } : current))
                  }
                >
                  {EVENT_STATUSES.map((item) => (
                    <option key={item} value={item}>
                      {item.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Start
                <input
                  type="datetime-local"
                  value={eventForm.startLocal}
                  onChange={(event) =>
                    setEventForm((current) => (current ? { ...current, startLocal: event.target.value } : current))
                  }
                />
              </label>

              <label>
                End
                <input
                  type="datetime-local"
                  value={eventForm.endLocal}
                  onChange={(event) =>
                    setEventForm((current) => (current ? { ...current, endLocal: event.target.value } : current))
                  }
                />
              </label>

              <fieldset className="jobcal-workers-fieldset">
                <legend>Assigned Workers</legend>
                <div className="jobcal-worker-list inline">
                  {workers.map((worker) => {
                    const checked = eventForm.workerIds.includes(worker.id);
                    return (
                      <label key={worker.id}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setEventForm((current) => {
                              if (!current) return current;
                              if (checked && current.workerIds.length === 1) {
                                return current;
                              }
                              return {
                                ...current,
                                workerIds: checked
                                  ? current.workerIds.filter((id) => id !== worker.id)
                                  : [...current.workerIds, worker.id],
                              };
                            })
                          }
                        />
                        <span>{worker.name}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <label>
                Notes
                <textarea
                  rows={3}
                  value={eventForm.description}
                  onChange={(event) =>
                    setEventForm((current) => (current ? { ...current, description: event.target.value } : current))
                  }
                />
              </label>

              <label className="inline-toggle">
                <input
                  type="checkbox"
                  checked={eventForm.busy}
                  onChange={(event) =>
                    setEventForm((current) => (current ? { ...current, busy: event.target.checked } : current))
                  }
                />
                Busy event (blocks availability)
              </label>

              <div className="jobcal-modal-actions">
                <button type="button" className="btn secondary" onClick={() => setEventForm(null)} disabled={submitting}>
                  Cancel
                </button>
                {eventForm.mode === "edit" && eventForm.eventId ? (
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => {
                      void deleteEvent(eventForm.eventId || "");
                      setEventForm(null);
                    }}
                    disabled={submitting}
                  >
                    Delete
                  </button>
                ) : null}
                <button type="submit" className="btn primary" disabled={submitting}>
                  {submitting ? "Saving..." : "Save Event"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {conflict ? (
        <div className="jobcal-modal-backdrop" role="dialog" aria-modal>
          <div className="jobcal-modal">
            <header>
              <strong>Resolve Conflict</strong>
            </header>
            <p className="muted">
              The selected time conflicts with another assignment. Pick a suggested slot:
            </p>
            <div className="jobcal-slot-options">
              {conflict.suggestedSlots.slice(0, 6).map((slot) => (
                <button
                  key={slot}
                  type="button"
                  className="btn secondary"
                  onClick={() => void applyConflictResolution(conflict.eventId, slot, conflict.durationMinutes)}
                >
                  {zonedDateTimeLabel(new Date(slot), defaultSettings.calendarTimezone)}
                </button>
              ))}
            </div>
            <div className="jobcal-modal-actions">
              <button type="button" className="btn secondary" onClick={() => setConflict(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function localDateFromUtc(isoUtc: string, timeZone: string): string {
  return formatInTimeZone(new Date(isoUtc), timeZone, "yyyy-MM-dd");
}
