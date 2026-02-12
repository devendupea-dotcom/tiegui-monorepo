import { normalizeEnvValue } from "@/lib/env";
import { buildGoogleEventBody } from "./google-event-body";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_BASE_URL = "https://www.googleapis.com/calendar/v3";

export const GOOGLE_CALENDAR_READONLY_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
export const GOOGLE_CALENDAR_WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events";

type JsonObject = Record<string, unknown>;

export type GoogleTokenPayload = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string[];
};

export type GoogleCalendarListItem = {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
  timeZone: string | null;
};

export type GoogleCalendarEventRecord = {
  id: string;
  status: string | null;
  summary: string | null;
  description: string | null;
  location: string | null;
  transparency: string | null;
  startDateTime: string | null;
  startDate: string | null;
  startTimeZone: string | null;
  endDateTime: string | null;
  endDate: string | null;
  endTimeZone: string | null;
  updated: string | null;
};

export class GoogleApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function getGoogleClientId(): string {
  const value = normalizeEnvValue(process.env.GOOGLE_CLIENT_ID);
  if (!value) {
    throw new Error("GOOGLE_CLIENT_ID is required.");
  }
  return value;
}

function getGoogleClientSecret(): string {
  const value = normalizeEnvValue(process.env.GOOGLE_CLIENT_SECRET);
  if (!value) {
    throw new Error("GOOGLE_CLIENT_SECRET is required.");
  }
  return value;
}

export function resolveGoogleRedirectUri(origin: string): string {
  return normalizeEnvValue(process.env.GOOGLE_REDIRECT_URI) || `${origin}/api/integrations/google/callback`;
}

function parseScopes(scope: unknown): string[] {
  if (typeof scope !== "string") return [];
  return scope
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseExpiresAt(expiresIn: unknown): Date | null {
  const seconds = typeof expiresIn === "number" ? expiresIn : Number.parseInt(String(expiresIn || ""), 10);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  return new Date(Date.now() + seconds * 1000);
}

function getString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function getArray(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === "object" && !Array.isArray(item)) as JsonObject[];
}

async function parseJsonSafe(response: Response): Promise<JsonObject> {
  const payload = (await response.json().catch(() => null)) as JsonObject | null;
  return payload || {};
}

async function requestGoogleToken(params: URLSearchParams): Promise<GoogleTokenPayload> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    const error = getString(payload.error_description) || getString(payload.error) || "Google token request failed.";
    throw new GoogleApiError(error, response.status);
  }

  const accessToken = getString(payload.access_token);
  if (!accessToken) {
    throw new Error("Google token response did not include access_token.");
  }

  return {
    accessToken,
    refreshToken: getString(payload.refresh_token),
    expiresAt: parseExpiresAt(payload.expires_in),
    scopes: parseScopes(payload.scope),
  };
}

export function getGoogleScopes(input: { wantsWrite?: boolean }): string[] {
  if (input.wantsWrite) {
    return [GOOGLE_CALENDAR_READONLY_SCOPE, GOOGLE_CALENDAR_WRITE_SCOPE];
  }
  return [GOOGLE_CALENDAR_READONLY_SCOPE];
}

export function buildGoogleAuthorizeUrl(input: {
  state: string;
  redirectUri: string;
  scopes: string[];
}) {
  const params = new URLSearchParams({
    client_id: getGoogleClientId(),
    redirect_uri: input.redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: input.state,
    scope: input.scopes.join(" "),
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeGoogleCodeForTokens(input: {
  code: string;
  redirectUri: string;
}): Promise<GoogleTokenPayload> {
  const params = new URLSearchParams({
    code: input.code,
    client_id: getGoogleClientId(),
    client_secret: getGoogleClientSecret(),
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
  });

  return requestGoogleToken(params);
}

export async function refreshGoogleTokens(refreshToken: string): Promise<GoogleTokenPayload> {
  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: getGoogleClientId(),
    client_secret: getGoogleClientSecret(),
    grant_type: "refresh_token",
  });

  return requestGoogleToken(params);
}

async function googleApiRequest(input: {
  accessToken: string;
  url: string;
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: JsonObject;
}): Promise<JsonObject> {
  const response = await fetch(input.url, {
    method: input.method || "GET",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      accept: "application/json",
      ...(input.body ? { "content-type": "application/json" } : {}),
    },
    ...(input.body ? { body: JSON.stringify(input.body) } : {}),
  });

  if (response.status === 204) {
    return {};
  }

  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    const payloadError =
      payload.error && typeof payload.error === "object" && !Array.isArray(payload.error)
        ? (payload.error as JsonObject)
        : null;
    const error = getString(payload.error_description) || getString(payloadError?.message) || getString(payload.error);
    throw new GoogleApiError(error || `Google API request failed (${response.status}).`, response.status);
  }

  return payload;
}

export async function listGoogleCalendars(input: {
  accessToken: string;
}): Promise<GoogleCalendarListItem[]> {
  const calendars: GoogleCalendarListItem[] = [];
  let pageToken: string | null = null;

  do {
    const url = new URL(`${GOOGLE_CALENDAR_BASE_URL}/users/me/calendarList`);
    url.searchParams.set("maxResults", "250");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const payload = await googleApiRequest({
      accessToken: input.accessToken,
      url: url.toString(),
    });

    const items = getArray(payload.items);
    for (const item of items) {
      const id = getString(item.id);
      if (!id) continue;
      calendars.push({
        id,
        summary: getString(item.summary) || id,
        primary: item.primary === true,
        accessRole: getString(item.accessRole) || "",
        timeZone: getString(item.timeZone),
      });
    }

    pageToken = getString(payload.nextPageToken);
  } while (pageToken);

  return calendars;
}

export async function createGoogleCalendar(input: {
  accessToken: string;
  summary: string;
  timeZone?: string;
}): Promise<{ id: string; summary: string }> {
  const payload = await googleApiRequest({
    accessToken: input.accessToken,
    url: `${GOOGLE_CALENDAR_BASE_URL}/calendars`,
    method: "POST",
    body: {
      summary: input.summary,
      ...(input.timeZone ? { timeZone: input.timeZone } : {}),
    },
  });

  const id = getString(payload.id);
  if (!id) {
    throw new Error("Google create calendar response did not include id.");
  }

  return {
    id,
    summary: getString(payload.summary) || input.summary,
  };
}

export async function listGoogleCalendarEventsInRange(input: {
  accessToken: string;
  calendarId: string;
  timeMinUtc: Date;
  timeMaxUtc: Date;
}): Promise<GoogleCalendarEventRecord[]> {
  const records: GoogleCalendarEventRecord[] = [];
  let pageToken: string | null = null;

  do {
    const url = new URL(`${GOOGLE_CALENDAR_BASE_URL}/calendars/${encodeURIComponent(input.calendarId)}/events`);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("showDeleted", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("timeMin", input.timeMinUtc.toISOString());
    url.searchParams.set("timeMax", input.timeMaxUtc.toISOString());
    url.searchParams.set("maxResults", "2500");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const payload = await googleApiRequest({
      accessToken: input.accessToken,
      url: url.toString(),
    });

    const items = getArray(payload.items);
    for (const item of items) {
      const id = getString(item.id);
      if (!id) continue;
      const start = (item.start && typeof item.start === "object" ? (item.start as JsonObject) : {}) as JsonObject;
      const end = (item.end && typeof item.end === "object" ? (item.end as JsonObject) : {}) as JsonObject;

      records.push({
        id,
        status: getString(item.status),
        summary: getString(item.summary),
        description: getString(item.description),
        location: getString(item.location),
        transparency: getString(item.transparency),
        startDateTime: getString(start.dateTime),
        startDate: getString(start.date),
        startTimeZone: getString(start.timeZone),
        endDateTime: getString(end.dateTime),
        endDate: getString(end.date),
        endTimeZone: getString(end.timeZone),
        updated: getString(item.updated),
      });
    }

    pageToken = getString(payload.nextPageToken);
  } while (pageToken);

  return records;
}

export async function createGoogleCalendarEvent(input: {
  accessToken: string;
  calendarId: string;
  summary: string;
  description?: string | null;
  location?: string | null;
  startAtUtc: Date;
  endAtUtc: Date;
  allDay: boolean;
  timeZone: string;
}): Promise<{ id: string }> {
  const payload = await googleApiRequest({
    accessToken: input.accessToken,
    url: `${GOOGLE_CALENDAR_BASE_URL}/calendars/${encodeURIComponent(input.calendarId)}/events`,
    method: "POST",
    body: buildGoogleEventBody(input),
  });
  const id = getString(payload.id);
  if (!id) {
    throw new Error("Google event create response did not include id.");
  }
  return { id };
}

export async function updateGoogleCalendarEvent(input: {
  accessToken: string;
  calendarId: string;
  eventId: string;
  summary: string;
  description?: string | null;
  location?: string | null;
  startAtUtc: Date;
  endAtUtc: Date;
  allDay: boolean;
  timeZone: string;
}): Promise<void> {
  await googleApiRequest({
    accessToken: input.accessToken,
    url: `${GOOGLE_CALENDAR_BASE_URL}/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
    method: "PUT",
    body: buildGoogleEventBody(input),
  });
}

export async function deleteGoogleCalendarEvent(input: {
  accessToken: string;
  calendarId: string;
  eventId: string;
}): Promise<void> {
  await googleApiRequest({
    accessToken: input.accessToken,
    url: `${GOOGLE_CALENDAR_BASE_URL}/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
    method: "DELETE",
  });
}
