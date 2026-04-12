import {
  AppApiError,
  assertOrgReadAccess as assertSharedOrgReadAccess,
  assertOrgWriteAccess as assertSharedOrgWriteAccess,
  type AppApiActor,
  requireAppApiActor,
  resolveActorOrgId,
} from "@/lib/app-api-permissions";
import {
  canEditAnyCalendarEventInOrg,
  getCalendarWorkerEditErrorMessage,
} from "./calendar-access-rules";

export class CalendarApiError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type CalendarActor = AppApiActor;

function getString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function rethrowCalendarAccessError(error: unknown): never {
  if (error instanceof CalendarApiError) {
    throw error;
  }
  if (error instanceof AppApiError) {
    throw new CalendarApiError(error.message, error.status);
  }
  throw error;
}

export async function requireCalendarActor(): Promise<CalendarActor> {
  try {
    return await requireAppApiActor();
  } catch (error) {
    rethrowCalendarAccessError(error);
  }
}

export function resolveOrgIdFromRequest(input: {
  req: Request;
  body?: Record<string, unknown> | null;
}): string | null {
  const queryValue = getString(new URL(input.req.url).searchParams.get("orgId"));
  if (queryValue) {
    return queryValue;
  }
  return input.body ? getString(input.body.orgId) : null;
}

export async function resolveCalendarOrgId(input: {
  actor: CalendarActor;
  requestedOrgId?: string | null;
  req?: Request;
  body?: Record<string, unknown> | null;
}) {
  const requestedOrgId =
    getString(input.requestedOrgId) ||
    (input.req ? resolveOrgIdFromRequest({ req: input.req, body: input.body }) : input.body ? getString(input.body.orgId) : null);

  try {
    return await resolveActorOrgId({
      actor: input.actor,
      requestedOrgId,
    });
  } catch (error) {
    rethrowCalendarAccessError(error);
  }
}

export function assertOrgReadAccess(actor: CalendarActor, orgId: string) {
  try {
    assertSharedOrgReadAccess(actor, orgId);
  } catch (error) {
    rethrowCalendarAccessError(error);
  }
}

export function assertOrgWriteAccess(actor: CalendarActor, orgId: string) {
  try {
    assertSharedOrgWriteAccess(actor, orgId);
  } catch (error) {
    rethrowCalendarAccessError(error);
  }
}

export function canEditAnyEventInOrg(actor: CalendarActor): boolean {
  return canEditAnyCalendarEventInOrg(actor);
}

export function assertWorkerEditAllowed(input: {
  actor: CalendarActor;
  workerUserIds: string[];
}) {
  const errorMessage = getCalendarWorkerEditErrorMessage(input);
  if (errorMessage) {
    throw new CalendarApiError(errorMessage, 403);
  }
}
