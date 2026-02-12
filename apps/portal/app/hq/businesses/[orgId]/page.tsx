import Link from "next/link";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatDateTime, formatLabel, isOverdueFollowUp } from "@/lib/hq";
import { normalizeE164 } from "@/lib/phone";
import { intakeAutomationDefaults } from "@/lib/intake-automation";
import { requireInternalUser } from "@/lib/session";
import { getGoogleSyncAlertState } from "@/lib/integrations/google-sync";
import { getPhotoStorageReadiness } from "@/lib/storage";
import LeadMessageThread from "@/app/_components/lead-message-thread";
import RoundRobinTestCard from "./round-robin-test-card";

export const dynamic = "force-dynamic";

const tabs = [
  { key: "overview", label: "Overview" },
  { key: "leads", label: "Leads" },
  { key: "calls", label: "Calls" },
  { key: "messages", label: "Messages" },
  { key: "calendar", label: "Calendar" },
] as const;

type TabKey = (typeof tabs)[number]["key"];

function getTab(value: string | string[] | undefined): TabKey {
  const current = typeof value === "string" ? value : "overview";
  return tabs.some((tab) => tab.key === current) ? (current as TabKey) : "overview";
}

function getParam(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

function toMessageSnippet(value: string, maxLength = 90): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

async function updateOrgSmsSettingsAction(formData: FormData) {
  "use server";

  const orgId = String(formData.get("orgId") || "").trim();
  if (!orgId) {
    redirect("/hq/businesses");
  }

  await requireInternalUser(`/hq/businesses/${orgId}`);

  const senderRaw = String(formData.get("smsFromNumberE164") || "").trim();
  const autoReplyOn = String(formData.get("missedCallAutoReplyOn") || "") === "on";
  const autoReplyBody = String(formData.get("missedCallAutoReplyBody") || "").trim();
  const intakeAutomationEnabled = String(formData.get("intakeAutomationEnabled") || "") === "on";
  const intakeAskLocationBody = String(formData.get("intakeAskLocationBody") || "").trim();
  const intakeAskWorkTypeBody = String(formData.get("intakeAskWorkTypeBody") || "").trim();
  const intakeAskCallbackBody = String(formData.get("intakeAskCallbackBody") || "").trim();
  const intakeCompletionBody = String(formData.get("intakeCompletionBody") || "").trim();

  const normalizedSender = senderRaw ? normalizeE164(senderRaw) : null;

  if (senderRaw && !normalizedSender) {
    redirect(`/hq/businesses/${orgId}?tab=messages&error=invalid-sender`);
  }

  const messageFields = [
    autoReplyBody,
    intakeAskLocationBody,
    intakeAskWorkTypeBody,
    intakeAskCallbackBody,
    intakeCompletionBody,
  ];
  if (messageFields.some((value) => value.length > 1600)) {
    redirect(`/hq/businesses/${orgId}?tab=messages&error=invalid-template-body`);
  }

  await prisma.organization.update({
    where: { id: orgId },
    data: {
      smsFromNumberE164: normalizedSender,
      missedCallAutoReplyOn: autoReplyOn,
      missedCallAutoReplyBody: autoReplyBody || null,
      intakeAutomationEnabled,
      intakeAskLocationBody: intakeAskLocationBody || null,
      intakeAskWorkTypeBody: intakeAskWorkTypeBody || null,
      intakeAskCallbackBody: intakeAskCallbackBody || null,
      intakeCompletionBody: intakeCompletionBody || null,
    },
  });

  revalidatePath(`/hq/businesses/${orgId}`);
  revalidatePath(`/app`);

  redirect(`/hq/businesses/${orgId}?tab=messages&saved=sms`);
}

async function createSmsTemplateAction(formData: FormData) {
  "use server";

  const orgId = String(formData.get("orgId") || "").trim();
  if (!orgId) {
    redirect("/hq/businesses");
  }

  await requireInternalUser(`/hq/businesses/${orgId}`);

  const name = String(formData.get("templateName") || "").trim();
  const body = String(formData.get("templateBody") || "").trim();

  if (!name || name.length > 60) {
    redirect(`/hq/businesses/${orgId}?tab=messages&error=invalid-template-name`);
  }

  if (!body || body.length > 1600) {
    redirect(`/hq/businesses/${orgId}?tab=messages&error=invalid-template-body`);
  }

  await prisma.smsTemplate.create({
    data: {
      orgId,
      name,
      body,
    },
  });

  revalidatePath(`/hq/businesses/${orgId}`);
  redirect(`/hq/businesses/${orgId}?tab=messages&saved=template`);
}

async function archiveSmsTemplateAction(formData: FormData) {
  "use server";

  const orgId = String(formData.get("orgId") || "").trim();
  const templateId = String(formData.get("templateId") || "").trim();
  if (!orgId || !templateId) {
    redirect("/hq/businesses");
  }

  await requireInternalUser(`/hq/businesses/${orgId}`);

  const template = await prisma.smsTemplate.findUnique({
    where: { id: templateId },
    select: { id: true, orgId: true },
  });

  if (!template || template.orgId !== orgId) {
    redirect(`/hq/businesses/${orgId}?tab=messages&error=template-not-found`);
  }

  await prisma.smsTemplate.update({
    where: { id: templateId },
    data: { isActive: false },
  });

  revalidatePath(`/hq/businesses/${orgId}`);
  redirect(`/hq/businesses/${orgId}?tab=messages&saved=template-removed`);
}

export default async function HqBusinessFolderPage({
  params,
  searchParams,
}: {
  params: { orgId: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const tab = getTab(searchParams?.tab);
  const saved = getParam(searchParams?.saved);
  const error = getParam(searchParams?.error);
  const selectedLeadId = getParam(searchParams?.leadId);

  const organization = await prisma.organization.findUnique({
    where: { id: params.orgId },
    select: { id: true, name: true, createdAt: true },
  });

  if (!organization) {
    notFound();
  }

  const tabBaseHref = `/hq/businesses/${organization.id}`;

  return (
    <>
      <section className="card">
        <Link href="/hq/businesses" className="table-link">
          ← All Businesses
        </Link>
        <h2 style={{ marginTop: 8 }}>{organization.name}</h2>
        <p className="muted">Job workspace • created {formatDateTime(organization.createdAt)}</p>
        <div className="quick-links" style={{ marginTop: 10 }}>
          <Link className="btn secondary" href={`/app?orgId=${organization.id}`}>
            Open Client Portal View
          </Link>
        </div>

        <div className="tab-row" style={{ marginTop: 14 }}>
          {tabs.map((item) => (
            <Link
              key={item.key}
              href={`${tabBaseHref}?tab=${item.key}`}
              className={`tab-chip ${tab === item.key ? "active" : ""}`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </section>

      {tab === "overview" ? <OverviewTab orgId={organization.id} /> : null}
      {tab === "leads" ? <LeadsTab orgId={organization.id} /> : null}
      {tab === "calls" ? <CallsTab orgId={organization.id} /> : null}
      {tab === "messages" ? (
        <MessagesTab orgId={organization.id} saved={saved} error={error} selectedLeadId={selectedLeadId} />
      ) : null}
      {tab === "calendar" ? <CalendarTab orgId={organization.id} /> : null}
    </>
  );
}

async function OverviewTab({ orgId }: { orgId: string }) {
  const now = new Date();
  const start30 = new Date(now);
  start30.setDate(start30.getDate() - 30);

  const [leadsCount, bookedCount, dueCount, callsCount, messagesCount, eventsCount, organization, settings, cronState] = await Promise.all([
    prisma.lead.count({ where: { orgId } }),
    prisma.lead.count({ where: { orgId, status: "BOOKED", updatedAt: { gte: start30 } } }),
    prisma.lead.count({ where: { orgId, nextFollowUpAt: { lte: now } } }),
    prisma.call.count({ where: { orgId } }),
    prisma.message.count({ where: { orgId } }),
    prisma.event.count({ where: { orgId } }),
    prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        onboardingStep: true,
        onboardingCompletedAt: true,
        onboardingSkippedAt: true,
        smsFromNumberE164: true,
      },
    }),
    prisma.orgDashboardConfig.findUnique({
      where: { orgId },
      select: {
        calendarTimezone: true,
        defaultSlotMinutes: true,
        allowOverlaps: true,
        roundRobinLastWorkerId: true,
      },
    }),
    getGoogleSyncAlertState({
      cronStaleMinutes: 15,
      queueDepthThreshold: 80,
      errorRateThreshold: 0.25,
      errorRateWindowMinutes: 60,
      dedupeWindowMinutes: 10,
    }),
  ]);

  const photoStorage = getPhotoStorageReadiness();
  const onboardingComplete = Boolean(organization?.onboardingCompletedAt);
  const onboardingStatusLabel = onboardingComplete
    ? `Completed ${formatDateTime(organization!.onboardingCompletedAt!)}`
    : organization?.onboardingSkippedAt
      ? `Skipped ${formatDateTime(organization.onboardingSkippedAt)}`
      : "In progress";
  const cronFresh = !cronState.flags.staleCron;
  const hasGoogleRuns = Boolean(cronState.lastCronRunAt);
  const cronSecretConfigured = Boolean(process.env.CRON_SECRET && process.env.CRON_SECRET.trim());
  const messagingConfigured = Boolean(organization?.smsFromNumberE164);
  const checklistItems: Array<{ label: string; status: "ready" | "manual" | "blocked"; detail: string }> = [
    {
      label: "Deterministic Round-Robin",
      status: settings?.roundRobinLastWorkerId ? "ready" : "manual",
      detail: settings?.roundRobinLastWorkerId
        ? "Round-robin pointer is initialized. Run the RR test below (6 turns) before pilot."
        : "Initialize by enabling round-robin in onboarding step 3, then run RR test.",
    },
    {
      label: "Timezone / DST smoke",
      status: settings?.calendarTimezone ? "manual" : "blocked",
      detail: settings?.calendarTimezone
        ? `Org timezone: ${settings.calendarTimezone}. Manual smoke: verify a 9:00 AM job across Today/Day/Week/Month and Google if connected.`
        : "Set organization timezone before pilot scheduling.",
    },
    {
      label: "Photo storage production check",
      status: photoStorage.productionReady ? "ready" : "blocked",
      detail: photoStorage.productionReady
        ? `Provider ${photoStorage.provider.toUpperCase()} configured for signed URL mode.`
        : photoStorage.blockingReason || photoStorage.details,
    },
    {
      label: "Messaging compliance",
      status: messagingConfigured ? "ready" : "manual",
      detail: messagingConfigured
        ? "STOP/START enforcement is active and outbound sends are blocked for DNC contacts. Quiet hours are manual in MVP."
        : "Configure SMS sender and run onboarding test SMS. STOP/START logic is active in webhook routes.",
    },
    {
      label: "Cron scheduler verification",
      status: cronFresh && hasGoogleRuns && cronSecretConfigured ? "ready" : "manual",
      detail:
        hasGoogleRuns && cronState.lastCronMinutesAgo !== null
          ? `Last cron run ${cronState.lastCronMinutesAgo}m ago. CRON_SECRET ${cronSecretConfigured ? "is set" : "is missing"}; cron routes expect Authorization: Bearer CRON_SECRET.`
          : "No cron runs recorded yet. Deploy cron and verify GoogleSyncRun rows.",
    },
    {
      label: "Rollback + portability",
      status: "manual",
      detail:
        "Rollback one-liner: restore DB snapshot + redeploy previous commit. Validate Export My Data (CSV + JSON ZIP) before pilot.",
    },
  ];

  return (
    <>
      <section className="grid">
        <article className="card kpi-card">
          <h2>Total Leads</h2>
          <p className="kpi-value">{leadsCount}</p>
        </article>
        <article className="card kpi-card">
          <h2>Booked (30d)</h2>
          <p className="kpi-value">{bookedCount}</p>
        </article>
        <article className="card kpi-card">
          <h2>Follow-ups Due</h2>
          <p className="kpi-value">{dueCount}</p>
        </article>
        <article className="card kpi-card">
          <h2>Calls</h2>
          <p className="kpi-value">{callsCount}</p>
        </article>
        <article className="card kpi-card">
          <h2>Messages</h2>
          <p className="kpi-value">{messagesCount}</p>
        </article>
        <article className="card kpi-card">
          <h2>Events</h2>
          <p className="kpi-value">{eventsCount}</p>
        </article>
      </section>

      <section className="grid two-col">
        <article className="card">
          <h2>Onboarding Status</h2>
          <div className="stack-cell" style={{ marginTop: 10 }}>
            <span className={`badge ${onboardingComplete ? "status-success" : "status-running"}`}>
              {onboardingComplete ? "Completed" : "Pending"}
            </span>
            <p className="muted">Step: {organization?.onboardingStep ?? 0} / 4</p>
            <p className="muted">{onboardingStatusLabel}</p>
            <div className="quick-links">
              <Link className="btn secondary" href={`/app/onboarding?orgId=${encodeURIComponent(orgId)}`}>
                Open onboarding wizard
              </Link>
              <Link className="btn secondary" href={`/app/settings/integrations?orgId=${encodeURIComponent(orgId)}`}>
                Open integrations
              </Link>
            </div>
          </div>
        </article>
        <RoundRobinTestCard orgId={orgId} />
      </section>

      <section className="card">
        <h2>Go-Live Hardening Checklist</h2>
        <p className="muted">A+ rollout checks for scheduling, compliance, storage, cron, and rollback readiness.</p>
        <ul className="template-list">
          {checklistItems.map((item) => (
            <li key={item.label} className="template-item">
              <div className="thread-top">
                <strong>{item.label}</strong>
                <span className={`badge status-${item.status === "ready" ? "success" : item.status === "manual" ? "running" : "error"}`}>
                  {item.status === "ready" ? "Ready" : item.status === "manual" ? "Manual" : "Blocked"}
                </span>
              </div>
              <p className="muted">{item.detail}</p>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

async function LeadsTab({ orgId }: { orgId: string }) {
  const leads = await prisma.lead.findMany({
    where: { orgId },
    include: {
      assignedTo: { select: { name: true, email: true } },
    },
    orderBy: [{ nextFollowUpAt: "asc" }, { createdAt: "desc" }],
    take: 300,
  });

  return (
    <section className="card">
      <h2>Leads</h2>
      {leads.length === 0 ? (
        <p className="muted" style={{ marginTop: 10 }}>
          No leads yet.
        </p>
      ) : (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Contact</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Assigned</th>
                <th>Follow-up</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id}>
                  <td>
                    <Link className="table-link" href={`/hq/leads/${lead.id}`}>
                      {lead.contactName || lead.businessName || "Unnamed Lead"}
                    </Link>
                  </td>
                  <td>{lead.phoneE164}</td>
                  <td>
                    <span className={`badge status-${lead.status.toLowerCase()}`}>
                      {formatLabel(lead.status)}
                    </span>
                  </td>
                  <td>
                    <span className={`badge priority-${lead.priority.toLowerCase()}`}>
                      {formatLabel(lead.priority)}
                    </span>
                  </td>
                  <td>{lead.assignedTo?.name || lead.assignedTo?.email || "Unassigned"}</td>
                  <td>
                    {lead.nextFollowUpAt ? (
                      <div className="stack-cell">
                        <span>{formatDateTime(lead.nextFollowUpAt)}</span>
                        {isOverdueFollowUp(lead.nextFollowUpAt) ? (
                          <span className="overdue-chip">Overdue</span>
                        ) : null}
                      </div>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

async function CallsTab({ orgId }: { orgId: string }) {
  const calls = await prisma.call.findMany({
    where: { orgId },
    include: {
      lead: { select: { id: true, contactName: true, businessName: true, phoneE164: true } },
    },
    orderBy: { startedAt: "desc" },
    take: 300,
  });

  return (
    <section className="card">
      <h2>Calls</h2>
      {calls.length === 0 ? (
        <p className="muted" style={{ marginTop: 10 }}>
          No calls yet.
        </p>
      ) : (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Started</th>
                <th>Direction</th>
                <th>Status</th>
                <th>From</th>
                <th>To</th>
                <th>Lead</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((call) => (
                <tr key={call.id}>
                  <td>{formatDateTime(call.startedAt)}</td>
                  <td>{formatLabel(call.direction)}</td>
                  <td>{formatLabel(call.status)}</td>
                  <td>{call.fromNumberE164}</td>
                  <td>{call.toNumberE164}</td>
                  <td>
                    {call.lead ? (
                      <Link className="table-link" href={`/hq/leads/${call.lead.id}`}>
                        {call.lead.contactName || call.lead.businessName || call.lead.phoneE164}
                      </Link>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

async function MessagesTab({
  orgId,
  saved,
  error,
  selectedLeadId,
}: {
  orgId: string;
  saved: string;
  error: string;
  selectedLeadId: string;
}) {
  const [organization, templates, messages, leadThreads] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        smsFromNumberE164: true,
        missedCallAutoReplyOn: true,
        missedCallAutoReplyBody: true,
        intakeAutomationEnabled: true,
        intakeAskLocationBody: true,
        intakeAskWorkTypeBody: true,
        intakeAskCallbackBody: true,
        intakeCompletionBody: true,
      },
    }),
    prisma.smsTemplate.findMany({
      where: { orgId, isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, body: true },
    }),
    prisma.message.findMany({
      where: { orgId },
      include: {
        lead: { select: { id: true, contactName: true, businessName: true, phoneE164: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
    prisma.lead.findMany({
      where: { orgId },
      select: {
        id: true,
        contactName: true,
        businessName: true,
        phoneE164: true,
        _count: { select: { messages: true } },
        messages: {
          select: {
            body: true,
            direction: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 300,
    }),
  ]);

  if (!organization) {
    return null;
  }

  const activeLeadId =
    selectedLeadId && leadThreads.some((lead) => lead.id === selectedLeadId)
      ? selectedLeadId
      : (leadThreads[0]?.id ?? "");

  const activeLead = activeLeadId
    ? await prisma.lead.findFirst({
        where: { id: activeLeadId, orgId },
        select: {
          id: true,
          contactName: true,
          businessName: true,
          phoneE164: true,
          org: {
            select: {
              smsFromNumberE164: true,
            },
          },
          messages: {
            select: {
              id: true,
              direction: true,
              fromNumberE164: true,
              toNumberE164: true,
              body: true,
              provider: true,
              providerMessageSid: true,
              status: true,
              createdAt: true,
            },
            orderBy: { createdAt: "asc" },
          },
        },
      })
    : null;

  return (
    <>
      <section className="grid two-col">
        <article className="card">
          <h2>SMS Settings</h2>
          <p className="muted">
            Set the sender number and optional intake flow for missed calls (location, work type, callback).
          </p>

          <form action={updateOrgSmsSettingsAction} className="auth-form">
            <input type="hidden" name="orgId" value={orgId} />

            <label>
              Sender Number (E.164)
              <input
                name="smsFromNumberE164"
                defaultValue={organization.smsFromNumberE164 || ""}
                placeholder="+12065550100"
              />
            </label>

            <label className="inline-toggle">
              <input
                name="missedCallAutoReplyOn"
                type="checkbox"
                defaultChecked={organization.missedCallAutoReplyOn}
              />
              Enable missed-call auto-reply text
            </label>

            <label>
              Missed-Call Auto-Reply Message
              <textarea
                name="missedCallAutoReplyBody"
                rows={4}
                maxLength={1600}
                defaultValue={organization.missedCallAutoReplyBody || ""}
                placeholder={intakeAutomationDefaults.intro}
              />
            </label>

            <label className="inline-toggle">
              <input
                name="intakeAutomationEnabled"
                type="checkbox"
                defaultChecked={organization.intakeAutomationEnabled}
              />
              Enable automated intake prompts after missed call
            </label>

            <label>
              Intake Prompt: Ask Location
              <textarea
                name="intakeAskLocationBody"
                rows={2}
                maxLength={1600}
                defaultValue={organization.intakeAskLocationBody || ""}
                placeholder={intakeAutomationDefaults.askLocation}
              />
            </label>

            <label>
              Intake Prompt: Ask Work Type
              <textarea
                name="intakeAskWorkTypeBody"
                rows={2}
                maxLength={1600}
                defaultValue={organization.intakeAskWorkTypeBody || ""}
                placeholder={intakeAutomationDefaults.askWorkType}
              />
            </label>

            <label>
              Intake Prompt: Ask Callback Time
              <textarea
                name="intakeAskCallbackBody"
                rows={2}
                maxLength={1600}
                defaultValue={organization.intakeAskCallbackBody || ""}
                placeholder={intakeAutomationDefaults.askCallback}
              />
            </label>

            <label>
              Intake Completion Message
              <textarea
                name="intakeCompletionBody"
                rows={2}
                maxLength={1600}
                defaultValue={organization.intakeCompletionBody || ""}
                placeholder={intakeAutomationDefaults.completion}
              />
            </label>
            <p className="muted">Use {"{{time}}"} in completion text to inject the scheduled callback time.</p>

            <button className="btn primary" type="submit">
              Save SMS settings
            </button>

            {saved === "sms" ? <p className="form-status">SMS settings saved.</p> : null}
            {error === "invalid-sender" ? (
              <p className="form-status">Enter a valid sender number in E.164 format.</p>
            ) : null}
          </form>
        </article>

        <article className="card">
          <h2>Saved Message Templates</h2>
          <p className="muted">These appear in the lead message composer for this client.</p>

          <form action={createSmsTemplateAction} className="auth-form">
            <input type="hidden" name="orgId" value={orgId} />

            <label>
              Template Name
              <input name="templateName" maxLength={60} placeholder="Follow-up #1" />
            </label>
            <label>
              Template Body
              <textarea
                name="templateBody"
                rows={4}
                maxLength={1600}
                placeholder="Hey {{name}}, checking in about your request..."
              />
            </label>

            <button className="btn primary" type="submit">
              Add Template
            </button>
          </form>

          {saved === "template" ? <p className="form-status">Template added.</p> : null}
          {saved === "template-removed" ? <p className="form-status">Template removed.</p> : null}
          {error === "invalid-template-name" ? (
            <p className="form-status">Template name is required (max 60 chars).</p>
          ) : null}
          {error === "invalid-template-body" ? (
            <p className="form-status">Template body is required (max 1600 chars).</p>
          ) : null}
          {error === "template-not-found" ? (
            <p className="form-status">That template no longer exists.</p>
          ) : null}

          {templates.length === 0 ? (
            <p className="muted" style={{ marginTop: 12 }}>
              No templates yet.
            </p>
          ) : (
            <ul className="template-list">
              {templates.map((template) => (
                <li key={template.id} className="template-item">
                  <p>
                    <strong>{template.name}</strong>
                  </p>
                  <p className="muted">{template.body}</p>
                  <form action={archiveSmsTemplateAction}>
                    <input type="hidden" name="orgId" value={orgId} />
                    <input type="hidden" name="templateId" value={template.id} />
                    <button className="btn secondary" type="submit">
                      Remove
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>

      <section className="grid two-col">
        <article className="card">
          <h2>Lead Threads</h2>
          <p className="muted">Pick a lead and send replies directly from this job workspace.</p>

          {leadThreads.length === 0 ? (
            <p className="muted" style={{ marginTop: 12 }}>
              No leads yet.
            </p>
          ) : (
            <ul className="thread-list">
              {leadThreads.map((lead) => {
                const label = lead.contactName || lead.businessName || lead.phoneE164;
                const lastMessage = lead.messages[0];
                return (
                  <li
                    key={lead.id}
                    className={`thread-item ${activeLead?.id === lead.id ? "active" : ""}`}
                  >
                    <Link className="thread-link" href={`/hq/businesses/${orgId}?tab=messages&leadId=${lead.id}`}>
                      <div className="thread-top">
                        <strong>{label}</strong>
                        <span className="muted">{lead._count.messages} msgs</span>
                      </div>
                      <p className="muted">
                        {lastMessage
                          ? `${formatLabel(lastMessage.direction)} • ${toMessageSnippet(lastMessage.body)}`
                          : "No messages yet."}
                      </p>
                      <p className="muted">{lastMessage ? formatDateTime(lastMessage.createdAt) : ""}</p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </article>

        <article className="card">
          <h2>Send Message</h2>
          {activeLead ? (
            <>
              <p className="muted">
                Thread for {activeLead.contactName || activeLead.businessName || activeLead.phoneE164}
              </p>
              <LeadMessageThread
                leadId={activeLead.id}
                senderNumber={activeLead.org.smsFromNumberE164 || process.env.DEFAULT_OUTBOUND_FROM_E164 || null}
                templates={templates}
                initialMessages={activeLead.messages.map((message) => ({
                  ...message,
                  createdAt: message.createdAt.toISOString(),
                }))}
              />
            </>
          ) : (
            <p className="muted">Select a lead to open the conversation thread.</p>
          )}
        </article>
      </section>

      <section className="card">
        <h2>Recent Message Log</h2>
        {messages.length === 0 ? (
          <p className="muted" style={{ marginTop: 10 }}>
            No messages yet.
          </p>
        ) : (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Sent</th>
                  <th>Direction</th>
                  <th>Status</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Body</th>
                  <th>Lead</th>
                </tr>
              </thead>
              <tbody>
                {messages.map((message) => (
                  <tr key={message.id}>
                    <td>{formatDateTime(message.createdAt)}</td>
                    <td>{formatLabel(message.direction)}</td>
                    <td>{message.status ? formatLabel(message.status) : "-"}</td>
                    <td>{message.fromNumberE164}</td>
                    <td>{message.toNumberE164}</td>
                    <td>{message.body}</td>
                    <td>
                      {message.lead ? (
                        <Link className="table-link" href={`/hq/leads/${message.lead.id}`}>
                          {message.lead.contactName || message.lead.businessName || message.lead.phoneE164}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

async function CalendarTab({ orgId }: { orgId: string }) {
  const [followUps, events] = await Promise.all([
    prisma.lead.findMany({
      where: { orgId, nextFollowUpAt: { not: null } },
      select: {
        id: true,
        contactName: true,
        businessName: true,
        phoneE164: true,
        nextFollowUpAt: true,
      },
      orderBy: { nextFollowUpAt: "asc" },
    }),
    prisma.event.findMany({
      where: { orgId },
      include: {
        lead: { select: { id: true, contactName: true, businessName: true, phoneE164: true } },
      },
      orderBy: { startAt: "asc" },
    }),
  ]);

  const feed = [
    ...followUps
      .filter((lead): lead is typeof lead & { nextFollowUpAt: Date } => Boolean(lead.nextFollowUpAt))
      .map((lead) => ({
        id: `followup-${lead.id}`,
        type: "FOLLOW_UP",
        title: `Follow-up: ${lead.contactName || lead.businessName || lead.phoneE164}`,
        startAt: lead.nextFollowUpAt,
        leadId: lead.id,
      })),
    ...events.map((event) => ({
      id: event.id,
      type: event.type,
      title: event.title,
      startAt: event.startAt,
      leadId: event.lead?.id,
    })),
  ].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  return (
    <section className="card">
      <h2>Calendar</h2>
      {feed.length === 0 ? (
        <p className="muted" style={{ marginTop: 10 }}>
          No calendar items yet.
        </p>
      ) : (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Type</th>
                <th>Title</th>
                <th>Lead</th>
              </tr>
            </thead>
            <tbody>
              {feed.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="stack-cell">
                      <span>{formatDateTime(item.startAt)}</span>
                      {item.type === "FOLLOW_UP" && isOverdueFollowUp(item.startAt) ? (
                        <span className="overdue-chip">Overdue</span>
                      ) : null}
                    </div>
                  </td>
                  <td>{formatLabel(item.type)}</td>
                  <td>{item.title}</td>
                  <td>
                    {item.leadId ? (
                      <Link className="table-link" href={`/hq/leads/${item.leadId}`}>
                        Open Lead
                      </Link>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
