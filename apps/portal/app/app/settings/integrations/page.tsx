import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { IntegrationProvider } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getOrgCalendarSettings, getWorkerCalendarTimeZone } from "@/lib/calendar/availability";
import { requireSessionUser } from "@/lib/session";
import {
  disconnectIntegrationAccount,
  setIntegrationSyncEnabled,
} from "@/lib/integrations/account-store";
import { getGoogleAccountBlockRules, normalizeReadCalendarIds, updateGoogleAccountSettings } from "@/lib/integrations/google-account-store";
import {
  createTieGuiGoogleCalendar,
  disconnectGoogleForOrgUser,
  fetchGoogleCalendarsForOrgUser,
  hasWritePermissionFromScopes,
  syncGoogleBusyBlocksForOrgUser,
} from "@/lib/integrations/google-sync";
import { runProviderImport } from "@/lib/integrations/import";
import { formatDateTime } from "@/lib/hq";
import { getParam, requireAppOrgAccess, resolveAppScope, withOrgQuery } from "../../_lib/portal-scope";

export const dynamic = "force-dynamic";

type ImportProviderOption = IntegrationProvider | "ALL";

function parseProvider(value: string): ImportProviderOption {
  if (value === "JOBBER" || value === "QBO" || value === "ALL") {
    return value;
  }
  throw new Error("Invalid provider value.");
}

function parseDateInput(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid date.");
  }
  return date;
}

function parseStringValues(formData: FormData, key: string): string[] {
  return formData
    .getAll(key)
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function summarizeStats(statsJson: unknown): string {
  if (!statsJson || typeof statsJson !== "object" || Array.isArray(statsJson)) {
    return "-";
  }

  const stats = statsJson as Record<string, unknown>;
  const parts = [
    `customers:${Number(stats.customers || 0)}`,
    `jobs:${Number(stats.jobs || 0)}`,
    `invoices:${Number(stats.invoices || 0)}`,
    `payments:${Number(stats.payments || 0)}`,
  ];
  return parts.join(" • ");
}

async function runImportAction(formData: FormData) {
  "use server";

  const orgId = String(formData.get("orgId") || "").trim();
  if (!orgId) {
    redirect("/app/settings/integrations?error=missing-org");
  }

  const { internalUser } = await requireAppOrgAccess("/app/settings/integrations", orgId);

  try {
    const provider = parseProvider(String(formData.get("provider") || ""));
    const dateFrom = parseDateInput(String(formData.get("dateFrom") || ""));
    const dateTo = parseDateInput(String(formData.get("dateTo") || ""));
    if (dateFrom && dateTo && dateFrom > dateTo) {
      throw new Error("Date range is invalid.");
    }

    const providers: IntegrationProvider[] = provider === "ALL" ? ["JOBBER", "QBO"] : [provider];
    for (const item of providers) {
      await runProviderImport({
        orgId,
        provider: item,
        dateFrom,
        dateTo,
      });
    }

    revalidatePath("/app/settings/integrations");
    redirect(withOrgQuery("/app/settings/integrations?saved=import", orgId, internalUser));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import failed.";
    redirect(
      withOrgQuery(
        `/app/settings/integrations?error=${encodeURIComponent(message.slice(0, 120))}`,
        orgId,
        internalUser,
      ),
    );
  }
}

async function disconnectAction(formData: FormData) {
  "use server";

  const orgId = String(formData.get("orgId") || "").trim();
  const providerValue = String(formData.get("provider") || "");
  if (!orgId) {
    redirect("/app/settings/integrations?error=invalid-request");
  }

  const { internalUser } = await requireAppOrgAccess("/app/settings/integrations", orgId);

  try {
    const provider = parseProvider(providerValue);
    if (provider === "ALL") {
      throw new Error("Invalid provider");
    }

    await disconnectIntegrationAccount({
      orgId,
      provider,
    });

    revalidatePath("/app/settings/integrations");
    redirect(withOrgQuery(`/app/settings/integrations?saved=disconnected-${provider.toLowerCase()}`, orgId, internalUser));
  } catch {
    redirect(withOrgQuery("/app/settings/integrations?error=invalid-provider", orgId, internalUser));
  }

}

async function updateSyncAction(formData: FormData) {
  "use server";

  const orgId = String(formData.get("orgId") || "").trim();
  const providerValue = String(formData.get("provider") || "");
  if (!orgId) {
    redirect("/app/settings/integrations?error=invalid-request");
  }
  const syncEnabled = String(formData.get("syncEnabled") || "") === "on";
  const { internalUser } = await requireAppOrgAccess("/app/settings/integrations", orgId);

  try {
    const provider = parseProvider(providerValue);
    if (provider === "ALL") {
      throw new Error("Invalid provider");
    }

    await setIntegrationSyncEnabled({
      orgId,
      provider,
      syncEnabled,
    });
  } catch {
    redirect(withOrgQuery("/app/settings/integrations?error=integration-sync-failed", orgId, internalUser));
  }

  revalidatePath("/app/settings/integrations");
  redirect(withOrgQuery("/app/settings/integrations?saved=sync-updated", orgId, internalUser));
}

async function updateGoogleSettingsAction(formData: FormData) {
  "use server";

  const orgId = String(formData.get("orgId") || "").trim();
  if (!orgId) {
    redirect("/app/settings/integrations?error=missing-org");
  }

  const { internalUser } = await requireAppOrgAccess("/app/settings/integrations", orgId);
  const sessionUser = await requireSessionUser("/app/settings/integrations");
  if (!sessionUser.id) {
    redirect(withOrgQuery("/app/settings/integrations?error=unauthorized", orgId, internalUser));
  }

  const isEnabled = String(formData.get("googleEnabled") || "") === "on";
  const writeCalendarIdRaw = String(formData.get("writeCalendarId") || "").trim();
  const writeCalendarId = writeCalendarIdRaw || null;
  const readCalendarIds = parseStringValues(formData, "readCalendarIds");
  const busyOnlySet = new Set(parseStringValues(formData, "busyOnlyCalendarIds"));
  const blockAllDaySet = new Set(parseStringValues(formData, "allDayCalendarIds"));

  const blockRules: Record<string, { blockIfBusyOnly: boolean; blockAllDay: boolean }> = {};
  for (const calendarId of readCalendarIds) {
    blockRules[calendarId] = {
      blockIfBusyOnly: busyOnlySet.has(calendarId),
      blockAllDay: blockAllDaySet.has(calendarId),
    };
  }

  try {
    await updateGoogleAccountSettings({
      orgId,
      userId: sessionUser.id,
      isEnabled,
      writeCalendarId,
      readCalendarIds,
      blockAvailabilityRules: blockRules,
    });
    revalidatePath("/app/settings/integrations");
    redirect(withOrgQuery("/app/settings/integrations?saved=google-settings", orgId, internalUser));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save Google settings.";
    redirect(withOrgQuery(`/app/settings/integrations?error=${encodeURIComponent(message)}`, orgId, internalUser));
  }
}

async function disconnectGoogleAction(formData: FormData) {
  "use server";

  const orgId = String(formData.get("orgId") || "").trim();
  if (!orgId) {
    redirect("/app/settings/integrations?error=missing-org");
  }

  const { internalUser } = await requireAppOrgAccess("/app/settings/integrations", orgId);
  const sessionUser = await requireSessionUser("/app/settings/integrations");
  if (!sessionUser.id) {
    redirect(withOrgQuery("/app/settings/integrations?error=unauthorized", orgId, internalUser));
  }

  await disconnectGoogleForOrgUser({
    orgId,
    userId: sessionUser.id,
  });
  revalidatePath("/app/settings/integrations");
  redirect(withOrgQuery("/app/settings/integrations?saved=google-disconnected", orgId, internalUser));
}

async function syncGoogleNowAction(formData: FormData) {
  "use server";

  const orgId = String(formData.get("orgId") || "").trim();
  if (!orgId) {
    redirect("/app/settings/integrations?error=missing-org");
  }

  const { internalUser } = await requireAppOrgAccess("/app/settings/integrations", orgId);
  const sessionUser = await requireSessionUser("/app/settings/integrations");
  if (!sessionUser.id) {
    redirect(withOrgQuery("/app/settings/integrations?error=unauthorized", orgId, internalUser));
  }

  try {
    await syncGoogleBusyBlocksForOrgUser({
      orgId,
      userId: sessionUser.id,
    });
    revalidatePath("/app/settings/integrations");
    revalidatePath("/app/calendar");
    redirect(withOrgQuery("/app/settings/integrations?saved=google-sync-now", orgId, internalUser));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google sync failed.";
    redirect(withOrgQuery(`/app/settings/integrations?error=${encodeURIComponent(message)}`, orgId, internalUser));
  }
}

async function createGoogleCalendarAction(formData: FormData) {
  "use server";

  const orgId = String(formData.get("orgId") || "").trim();
  if (!orgId) {
    redirect("/app/settings/integrations?error=missing-org");
  }

  const { internalUser } = await requireAppOrgAccess("/app/settings/integrations", orgId);
  const sessionUser = await requireSessionUser("/app/settings/integrations");
  if (!sessionUser.id) {
    redirect(withOrgQuery("/app/settings/integrations?error=unauthorized", orgId, internalUser));
  }

  const calendarName = String(formData.get("calendarName") || "").trim() || "TieGui Jobs";

  try {
    const settings = await getOrgCalendarSettings(orgId);
    const userTimeZone = await getWorkerCalendarTimeZone({
      workerUserId: sessionUser.id,
      fallbackTimeZone: settings.calendarTimezone,
    });
    await createTieGuiGoogleCalendar({
      orgId,
      userId: sessionUser.id,
      summary: calendarName,
      timeZone: userTimeZone,
    });
    revalidatePath("/app/settings/integrations");
    redirect(withOrgQuery("/app/settings/integrations?saved=google-calendar-created", orgId, internalUser));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create Google calendar.";
    redirect(withOrgQuery(`/app/settings/integrations?error=${encodeURIComponent(message)}`, orgId, internalUser));
  }
}

export default async function IntegrationsSettingsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const requestedOrgId = getParam(searchParams?.orgId);
  const scope = await resolveAppScope({ nextPath: "/app/settings/integrations", requestedOrgId });
  const saved = getParam(searchParams?.saved);
  const error = getParam(searchParams?.error);
  const sessionUser = await requireSessionUser("/app/settings/integrations");

  const googleResult = sessionUser.id
    ? await fetchGoogleCalendarsForOrgUser({
        orgId: scope.orgId,
        userId: sessionUser.id,
      }).catch((fetchError) => ({
        connected: false,
        account: null,
        calendars: [],
        hasWriteScope: false,
        error: fetchError instanceof Error ? fetchError.message : "Failed to load Google calendars.",
      }))
    : {
        connected: false,
        account: null,
        calendars: [],
        hasWriteScope: false,
        error: "Session user is missing id.",
      };

  const [organization, accounts, runs] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: scope.orgId },
      select: { id: true, name: true },
    }),
    prisma.integrationAccount.findMany({
      where: { orgId: scope.orgId },
      orderBy: { provider: "asc" },
    }),
    prisma.importRun.findMany({
      where: { orgId: scope.orgId },
      orderBy: { startedAt: "desc" },
      take: 12,
    }),
  ]);

  if (!organization) {
    redirect(scope.internalUser ? "/hq/businesses" : "/app");
  }

  const jobber = accounts.find((account) => account.provider === "JOBBER");
  const qbo = accounts.find((account) => account.provider === "QBO");
  const googleAccount = googleResult.connected ? googleResult.account : null;
  const googleCalendars = googleResult.calendars || [];
  const googleReadCalendarIds = googleAccount ? normalizeReadCalendarIds(googleAccount.readCalendarIdsJson) : [];
  const googleBlockRules = googleAccount ? getGoogleAccountBlockRules(googleAccount) : {};
  const googleHasWriteScope = googleAccount ? hasWritePermissionFromScopes(googleAccount.scopes) : false;
  const googleLoadError = "error" in googleResult ? String(googleResult.error || "") : "";

  return (
    <>
      <section className="card">
        <h2>Integrations</h2>
        <p className="muted">
          Connect Jobber and QuickBooks Online, run imports, and export all org-owned data for{" "}
          <strong>{organization.name}</strong>.
        </p>
        <div className="quick-links" style={{ marginTop: 12 }}>
          <Link className="btn secondary" href={withOrgQuery("/app/settings", scope.orgId, scope.internalUser)}>
            Back to Settings
          </Link>
          <a className="btn secondary" href={withOrgQuery("/api/export", scope.orgId, scope.internalUser)}>
            Export My Data
          </a>
        </div>
        {saved ? <p className="form-status">Saved: {saved}</p> : null}
        {error ? <p className="form-status">Error: {error}</p> : null}
      </section>

      <section className="grid">
        <article className="card">
          <h2>Jobber</h2>
          <p className="muted">
            GraphQL OAuth integration for clients, jobs, and invoices.
          </p>
          <p style={{ marginTop: 10 }}>
            Status: <strong>{jobber?.status || "NOT_CONNECTED"}</strong>
          </p>
          <p className="muted">Connected at: {jobber ? formatDateTime(jobber.connectedAt) : "-"}</p>
          <p className="muted">Last sync: {jobber?.lastSyncedAt ? formatDateTime(jobber.lastSyncedAt) : "-"}</p>
          <p className="muted">Scopes: {jobber?.scopes.join(", ") || "-"}</p>
          <div className="quick-links" style={{ marginTop: 10 }}>
            <a className="btn primary" href={withOrgQuery("/api/integrations/jobber/connect", scope.orgId, scope.internalUser)}>
              {jobber ? "Reconnect Jobber" : "Connect Jobber"}
            </a>
            {jobber ? (
              <form action={disconnectAction}>
                <input type="hidden" name="orgId" value={scope.orgId} />
                <input type="hidden" name="provider" value="JOBBER" />
                <button className="btn secondary" type="submit">
                  Disconnect
                </button>
              </form>
            ) : null}
          </div>
          {jobber ? (
            <form action={updateSyncAction} className="auth-form" style={{ marginTop: 12 }}>
              <input type="hidden" name="orgId" value={scope.orgId} />
              <input type="hidden" name="provider" value="JOBBER" />
              <label className="inline-toggle">
                <input type="checkbox" name="syncEnabled" defaultChecked={jobber.syncEnabled} />
                Enable ongoing sync (phase 2)
              </label>
              <button className="btn secondary" type="submit">
                Save Sync Setting
              </button>
            </form>
          ) : null}
        </article>

        <article className="card">
          <h2>QuickBooks Online</h2>
          <p className="muted">
            OAuth accounting import for customers, invoices, and payments.
          </p>
          <p style={{ marginTop: 10 }}>
            Status: <strong>{qbo?.status || "NOT_CONNECTED"}</strong>
          </p>
          <p className="muted">Connected at: {qbo ? formatDateTime(qbo.connectedAt) : "-"}</p>
          <p className="muted">Last sync: {qbo?.lastSyncedAt ? formatDateTime(qbo.lastSyncedAt) : "-"}</p>
          <p className="muted">Realm ID: {qbo?.realmId || "-"}</p>
          <div className="quick-links" style={{ marginTop: 10 }}>
            <a className="btn primary" href={withOrgQuery("/api/integrations/qbo/connect", scope.orgId, scope.internalUser)}>
              {qbo ? "Reconnect QBO" : "Connect QuickBooks"}
            </a>
            {qbo ? (
              <form action={disconnectAction}>
                <input type="hidden" name="orgId" value={scope.orgId} />
                <input type="hidden" name="provider" value="QBO" />
                <button className="btn secondary" type="submit">
                  Disconnect
                </button>
              </form>
            ) : null}
          </div>
          {qbo ? (
            <form action={updateSyncAction} className="auth-form" style={{ marginTop: 12 }}>
              <input type="hidden" name="orgId" value={scope.orgId} />
              <input type="hidden" name="provider" value="QBO" />
              <label className="inline-toggle">
                <input type="checkbox" name="syncEnabled" defaultChecked={qbo.syncEnabled} />
                Enable ongoing sync (phase 2)
              </label>
              <button className="btn secondary" type="submit">
                Save Sync Setting
              </button>
            </form>
          ) : null}
        </article>

        <article className="card">
          <h2>Google Calendar (Per User)</h2>
          <p className="muted">
            Connect your own Google account to sync your assigned TieGui jobs and import your busy blocks.
          </p>
          <p style={{ marginTop: 10 }}>
            Status: <strong>{googleAccount ? googleAccount.syncStatus : "NOT_CONNECTED"}</strong>
          </p>
          <p className="muted">Connected email: {googleAccount?.googleEmail || "-"}</p>
          <p className="muted">Connected at: {googleAccount ? formatDateTime(googleAccount.connectedAt) : "-"}</p>
          <p className="muted">Last sync: {googleAccount?.lastSyncAt ? formatDateTime(googleAccount.lastSyncAt) : "-"}</p>
          <p className="muted">Scopes: {googleAccount?.scopes.join(", ") || "-"}</p>
          <p className="muted">Sync error: {googleAccount?.syncError || googleLoadError || "-"}</p>

          <div className="quick-links" style={{ marginTop: 10 }}>
            <a
              className="btn primary"
              href={withOrgQuery("/api/integrations/google/connect?mode=read", scope.orgId, scope.internalUser)}
            >
              {googleAccount ? "Reconnect (Read)" : "Connect Google (Read)"}
            </a>
            <a
              className="btn secondary"
              href={withOrgQuery("/api/integrations/google/connect?mode=write", scope.orgId, scope.internalUser)}
            >
              {googleHasWriteScope ? "Reconnect (Read + Write)" : "Connect with Write Access"}
            </a>
            {googleAccount ? (
              <form action={disconnectGoogleAction}>
                <input type="hidden" name="orgId" value={scope.orgId} />
                <button className="btn secondary" type="submit">
                  Disconnect
                </button>
              </form>
            ) : null}
            {googleAccount ? (
              <form action={syncGoogleNowAction}>
                <input type="hidden" name="orgId" value={scope.orgId} />
                <button className="btn secondary" type="submit">
                  Sync Now
                </button>
              </form>
            ) : null}
          </div>

          {googleAccount ? (
            <>
              <form action={updateGoogleSettingsAction} className="auth-form" style={{ marginTop: 12 }}>
                <input type="hidden" name="orgId" value={scope.orgId} />
                <label className="inline-toggle">
                  <input type="checkbox" name="googleEnabled" defaultChecked={googleAccount.isEnabled} />
                  Enable sync for my user
                </label>

                <label>
                  Write target calendar
                  <select name="writeCalendarId" defaultValue={googleAccount.writeCalendarId || ""}>
                    <option value="">No write calendar</option>
                    {googleCalendars.map((calendar) => (
                      <option key={calendar.id} value={calendar.id}>
                        {calendar.summary}
                        {calendar.primary ? " (Primary)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {!googleHasWriteScope ? (
                  <p className="muted">Write scope is not granted. Reconnect with write access to push TieGui jobs to Google.</p>
                ) : null}

                <fieldset className="auth-form" style={{ gap: 8 }}>
                  <legend>Read calendars used to block availability</legend>
                  {googleCalendars.length === 0 ? (
                    <p className="muted">No calendars found for this Google account.</p>
                  ) : (
                    googleCalendars.map((calendar) => {
                      const selected = googleReadCalendarIds.includes(calendar.id);
                      const rule = googleBlockRules[calendar.id] || {
                        blockIfBusyOnly: true,
                        blockAllDay: true,
                      };
                      return (
                        <div key={calendar.id} style={{ border: "1px solid rgba(89,127,178,0.2)", borderRadius: 10, padding: 10 }}>
                          <label className="inline-toggle">
                            <input type="checkbox" name="readCalendarIds" value={calendar.id} defaultChecked={selected} />
                            Use <strong>{calendar.summary}</strong> for availability blocking
                          </label>
                          <label className="inline-toggle">
                            <input
                              type="checkbox"
                              name="busyOnlyCalendarIds"
                              value={calendar.id}
                              defaultChecked={rule.blockIfBusyOnly !== false}
                            />
                            Block availability only when Google event is Busy
                          </label>
                          <label className="inline-toggle">
                            <input
                              type="checkbox"
                              name="allDayCalendarIds"
                              value={calendar.id}
                              defaultChecked={rule.blockAllDay !== false}
                            />
                            Count all-day events as busy
                          </label>
                        </div>
                      );
                    })
                  )}
                </fieldset>

                <button className="btn secondary" type="submit">
                  Save Google Settings
                </button>
              </form>

              <form action={createGoogleCalendarAction} className="auth-form" style={{ marginTop: 12 }}>
                <input type="hidden" name="orgId" value={scope.orgId} />
                <label>
                  Create new Google calendar
                  <input name="calendarName" defaultValue="TieGui Jobs" />
                </label>
                <button className="btn secondary" type="submit">
                  Create Calendar and Use as Write Target
                </button>
              </form>
            </>
          ) : null}
        </article>
      </section>

      <section className="card">
        <h2>Run Import</h2>
        <p className="muted">
          Run an initial bulk import (or rerun) with an optional date range.
        </p>

        <form action={runImportAction} className="auth-form" style={{ marginTop: 12 }}>
          <input type="hidden" name="orgId" value={scope.orgId} />

          <label>
            Provider
            <select name="provider" defaultValue="ALL">
              <option value="ALL">All connected providers</option>
              <option value="JOBBER">Jobber</option>
              <option value="QBO">QuickBooks Online</option>
            </select>
          </label>

          <label>
            From date (optional)
            <input type="date" name="dateFrom" />
          </label>

          <label>
            To date (optional)
            <input type="date" name="dateTo" />
          </label>

          <button className="btn primary" type="submit">
            Run Import
          </button>
        </form>
      </section>

      <section className="card">
        <h2>Import Runs</h2>
        <p className="muted">Latest import history for this organization.</p>
        {runs.length === 0 ? (
          <p className="muted" style={{ marginTop: 12 }}>
            No import runs yet.
          </p>
        ) : (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Status</th>
                  <th>Started</th>
                  <th>Finished</th>
                  <th>Stats</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>{run.provider}</td>
                    <td>
                      <span className={`badge status-${run.status.toLowerCase()}`}>{run.status}</span>
                    </td>
                    <td>{formatDateTime(run.startedAt)}</td>
                    <td>{run.finishedAt ? formatDateTime(run.finishedAt) : "-"}</td>
                    <td>{summarizeStats(run.statsJson)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Manual Fallback</h2>
        <p className="muted">
          If OAuth is unavailable, use provider UI exports:
        </p>
        <ul className="list" style={{ marginTop: 8 }}>
          <li>Jobber supports client list exports to CSV/vCard from its UI.</li>
          <li>QuickBooks Online supports exporting lists and reports to Excel.</li>
        </ul>
      </section>
    </>
  );
}
