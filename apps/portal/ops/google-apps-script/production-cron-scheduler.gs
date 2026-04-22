const TIEGUI_DEFAULT_BASE_URL = "https://app.tieguisolutions.com";
const TIEGUI_BASE_URL_PROPERTY = "TIEGUI_BASE_URL";
const TIEGUI_CRON_SECRET_PROPERTY = "TIEGUI_CRON_SECRET";

const TIEGUI_FREQUENT_CRON_JOBS = [
  { name: "intake", path: "/api/cron/intake" },
  {
    name: "owner_booking_reminders",
    path: "/api/cron/owner-booking-reminders",
  },
  { name: "integrations_refresh", path: "/api/cron/integrations/refresh" },
  { name: "google_sync", path: "/api/cron/google/sync" },
];

const TIEGUI_GHOST_BUSTER_JOB = {
  name: "ghost_buster",
  path: "/api/cron/ghost-buster",
};
const TIEGUI_INVOICE_ASSIST_JOB = {
  name: "invoice_assist",
  path: "/api/cron/invoice-assist?windowDays=30&limit=200",
};

function runTieGuiFrequentCrons() {
  TIEGUI_FREQUENT_CRON_JOBS.forEach(runTieGuiCronJob_);
}

function runTieGuiGhostBusterCron() {
  runTieGuiCronJob_(TIEGUI_GHOST_BUSTER_JOB);
}

function runTieGuiInvoiceAssistCron() {
  runTieGuiCronJob_(TIEGUI_INVOICE_ASSIST_JOB);
}

function setupTieGuiProductionTriggers() {
  deleteTieGuiCronTriggers_();

  ScriptApp.newTrigger("runTieGuiFrequentCrons")
    .timeBased()
    .everyMinutes(5)
    .create();

  ScriptApp.newTrigger("runTieGuiGhostBusterCron")
    .timeBased()
    .everyMinutes(30)
    .create();

  ScriptApp.newTrigger("runTieGuiInvoiceAssistCron")
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();
}

function deleteTieGuiCronTriggers_() {
  const allowedHandlers = new Set([
    "runTieGuiFrequentCrons",
    "runTieGuiGhostBusterCron",
    "runTieGuiInvoiceAssistCron",
  ]);

  ScriptApp.getProjectTriggers().forEach((trigger) => {
    if (allowedHandlers.has(trigger.getHandlerFunction())) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function runTieGuiCronJob_(job) {
  const baseUrl = getTieGuiBaseUrl_();
  const cronSecret = getTieGuiCronSecret_();
  const response = UrlFetchApp.fetch(`${baseUrl}${job.path}`, {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: `Bearer ${cronSecret}`,
      "x-cron-secret": cronSecret,
    },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      source: "google-apps-script",
      job: job.name,
      triggeredAt: new Date().toISOString(),
    }),
  });

  const status = response.getResponseCode();
  const body = response.getContentText();
  console.log(
    JSON.stringify({
      job: job.name,
      status,
      body,
      triggeredAt: new Date().toISOString(),
    }),
  );

  if (status < 200 || status >= 300) {
    throw new Error(`TieGui cron ${job.name} failed with ${status}: ${body}`);
  }
}

function getTieGuiBaseUrl_() {
  const configured = PropertiesService.getScriptProperties().getProperty(
    TIEGUI_BASE_URL_PROPERTY,
  );
  return (configured || TIEGUI_DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function getTieGuiCronSecret_() {
  const secret = PropertiesService.getScriptProperties().getProperty(
    TIEGUI_CRON_SECRET_PROPERTY,
  );
  if (!secret) {
    throw new Error(`Missing script property ${TIEGUI_CRON_SECRET_PROPERTY}`);
  }
  return secret;
}
