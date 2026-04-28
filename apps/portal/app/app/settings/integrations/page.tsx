import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getOrgCalendarSettings, getWorkerCalendarTimeZone } from "@/lib/calendar/availability";
import { requireSessionUser } from "@/lib/session";
import { disconnectIntegrationAccount } from "@/lib/integrations/account-store";
import { getGoogleAccountBlockRules, normalizeReadCalendarIds, updateGoogleAccountSettings } from "@/lib/integrations/google-account-store";
import {
  createTieGuiGoogleCalendar,
  disconnectGoogleForOrgUser,
  fetchGoogleCalendarsForOrgUser,
  hasWritePermissionFromScopes,
  syncGoogleBusyBlocksForOrgUser,
} from "@/lib/integrations/google-sync";
import { getIntegrationProviderConfiguration } from "@/lib/integrations/provider-config";
import {
  disconnectOrganizationStripeConnection,
  refreshOrganizationStripeConnection,
} from "@/lib/integrations/stripe-connect";
import { getRequestLocale } from "@/lib/i18n";
import { formatDateTime } from "@/lib/hq";
import { listCustomerImportRuns } from "@/lib/customer-import-crm";
import { getParam, requireAppOrgAccess, resolveAppScope, withOrgQuery } from "../../_lib/portal-scope";
import { requireAppPageViewer } from "../../_lib/portal-viewer";
import CustomerDataImportCard from "./customer-data-import-card";

export const dynamic = "force-dynamic";

function parseStringValues(formData: FormData, key: string): string[] {
  return formData
    .getAll(key)
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function getIntegrationsCopy(locale: string) {
  const isSpanish = locale.startsWith("es");
  if (isSpanish) {
    return {
      page: {
        title: "Integraciones",
        subtitle: (organizationName: string) =>
          `Conecta Google Calendar, Outlook y Stripe para ${organizationName}.`,
        backToSettings: "Volver a ajustes",
        exportMyData: "Exportar mis datos",
      },
      feedback: {
        viewDetails: "Ver detalles",
        notConfiguredNotice: "No configurado. Revisa el estado arriba.",
      },
      health: {
        title: "Estado de integraciones",
        subtitle:
          "Preparación del entorno para proveedores OAuth. Configura cualquier llave faltante y vuelve a desplegar para habilitar conexiones. Esto muestra solo nombres de llaves, nunca valores secretos.",
        configured: "Configurado",
        notConfigured: "No configurado",
        missingKeys: "Llaves de entorno faltantes:",
      },
      common: {
        status: "Estado",
        connectedAt: "Conectado el",
        lastSync: "Última sincronización",
        scopes: "Permisos",
        disconnect: "Desconectar",
        saveSyncSetting: "Guardar ajuste de sincronización",
        enableOngoingSync: "Activar sincronización continua (fase 2)",
        emptyValue: "-",
      },
      statusValues: {
        ACTIVE: "Activo",
        CONNECTED: "Conectado",
        DISCONNECTED: "Desconectado",
        ERROR: "Error",
        NOT_CONNECTED: "No conectado",
        PENDING: "Pendiente",
        RESTRICTED: "Requiere atención",
        IDLE: "Inactivo",
        RUNNING: "En ejecución",
        OK: "Correcto",
        SUCCESS: "Correcto",
        FAILED: "Falló",
      } as Record<string, string>,
      stats: {
        customers: "clientes",
        jobs: "trabajos",
        invoices: "facturas",
        payments: "pagos",
      },
      messages: {
        saved: {
          import: "Importación iniciada.",
          "disconnected-jobber": "Jobber desconectado.",
          "disconnected-qbo": "QuickBooks desconectado.",
          "disconnected-outlook": "Outlook desconectado.",
          "stripe-connected": "Stripe conectado.",
          "stripe-disconnected": "Stripe desconectado.",
          "stripe-refreshed": "Estado de Stripe actualizado.",
          "google-disconnected": "Google Calendar desconectado.",
          "sync-updated": "Ajuste de sincronización guardado.",
          "google-settings": "Ajustes de Google guardados.",
          "google-sync-now": "Sincronización de Google ejecutada.",
          "google-calendar-created": "Calendario de Google creado.",
        } as Record<string, string>,
        errors: {
          "missing-org": "Falta la organización.",
          unauthorized: "No autorizado.",
          "invalid-request": "La solicitud no es válida.",
          "invalid-provider": "El proveedor no es válido.",
          "invalid-provider-value": "El valor del proveedor no es válido.",
          "invalid-date": "La fecha no es válida.",
          "invalid-date-range": "El rango de fechas no es válido.",
          "integration-sync-failed": "No se pudo guardar el ajuste de sincronización.",
          "outlook-import-not-supported": "La importación de Outlook no es compatible.",
          "import-failed": "La importación falló.",
          "google-settings-save-failed": "No se pudieron guardar los ajustes de Google.",
          "google-sync-failed": "La sincronización de Google falló.",
          "google-calendar-create-failed": "No se pudo crear el calendario de Google.",
          "google-calendars-load-failed": "No se pudieron cargar los calendarios de Google.",
          "session-user-missing-id": "Falta el ID del usuario de la sesión.",
          jobber_not_configured: "Jobber no está configurado en este entorno.",
          qbo_not_configured: "QuickBooks Online no está configurado en este entorno.",
          stripe_not_configured: "Stripe no está configurado en este entorno.",
          "stripe-missing-org": "Falta la organización de Stripe en la devolución.",
          "stripe-connection-not-started": "Primero inicia la conexión de Stripe desde el portal.",
          "stripe-missing-code": "Stripe no devolvió el código de autorización.",
          "stripe-invalid-state": "El estado de Stripe ya no es válido. Intenta conectar de nuevo.",
          "stripe-callback-failed": "No se pudo completar la conexión con Stripe.",
          "stripe-refresh-failed": "No se pudo actualizar el estado de Stripe.",
          "stripe-disconnect-failed": "No se pudo desconectar Stripe.",
          google_not_configured: "Google Calendar no está configurado en este entorno.",
          outlook_not_configured: "Microsoft Outlook no está configurado en este entorno.",
        } as Record<string, string>,
      },
      outlook: {
        title: "Microsoft Outlook",
        subtitle: "Conecta un buzón de Microsoft 365 para envíos desde el portal como enlaces de estimados y órdenes de compra.",
        mailbox: "Buzón",
        account: "Cuenta",
        error: "Error",
        connect: "Conectar Outlook",
        reconnect: "Reconectar Outlook",
      },
      stripe: {
        title: "Stripe Payments",
        subtitle:
          "Conecta la cuenta de Stripe del negocio para preparar cobros en línea y planes recurrentes. Esta base deja a cada organización cobrar directo en su propia cuenta.",
        accountEmail: "Email de Stripe",
        accountName: "Nombre del negocio",
        accountId: "ID de cuenta",
        country: "País",
        currency: "Moneda",
        liveMode: "Modo",
        error: "Error",
        capabilities: "Capacidades",
        detailsSubmitted: "Perfil enviado",
        chargesEnabled: "Cobros listos",
        chargesPending: "Cobros pendientes",
        payoutsEnabled: "Depósitos listos",
        payoutsPending: "Depósitos pendientes",
        refresh: "Actualizar estado",
        connect: "Conectar Stripe",
        reconnect: "Reconectar Stripe",
        ready: "Listo para cobros",
        notReady: "Todavía no listo",
        live: "Producción",
        test: "Pruebas",
      },
      google: {
        title: "Google Calendar (por usuario)",
        subtitle: "Conecta tu propia cuenta de Google para sincronizar tus trabajos asignados en TieGui e importar tus bloques ocupados.",
        connectedEmail: "Email conectado",
        syncError: "Error de sincronización",
        connectRead: "Conectar Google (lectura)",
        reconnectRead: "Reconectar (lectura)",
        connectWrite: "Conectar con acceso de escritura",
        reconnectWrite: "Reconectar (lectura + escritura)",
        syncNow: "Sincronizar ahora",
        enableSync: "Activar sincronización para mi usuario",
        writeTargetCalendar: "Calendario destino para escritura",
        noWriteCalendar: "Sin calendario de escritura",
        writeScopeNotice: "No se concedió permiso de escritura. Reconecta con acceso de escritura para enviar trabajos de TieGui a Google.",
        readCalendarsLegend: "Calendarios de lectura usados para bloquear disponibilidad",
        noCalendars: "No se encontraron calendarios para esta cuenta de Google.",
        useForBlocking: "Usar {name} para bloquear disponibilidad",
        blockBusyOnly: "Bloquear disponibilidad solo cuando el evento de Google esté como Ocupado",
        blockAllDay: "Contar eventos de todo el día como ocupados",
        saveSettings: "Guardar ajustes de Google",
        createCalendarLabel: "Crear nuevo calendario de Google",
        createCalendarAction: "Crear calendario y usarlo como destino de escritura",
        defaultCalendarName: "Trabajos TieGui",
        primary: "Principal",
      },
      migration: {
        title: "Traer datos de clientes a TieGui",
        subtitle:
          "Jobber y QuickBooks ya no se muestran como integraciones de autoservicio. En su lugar, TieGui ofrece una importación limpia por CSV o Excel para traer datos al CRM sin ensuciar la base.",
        body:
          "Descarga la plantilla, acomoda tus columnas si hace falta y revisa la vista previa antes de importar. TieGui usa el teléfono como llave principal para crear o actualizar clientes y leads de forma conservadora.",
        supportedTitle: "Qué podemos traer",
        supportedItems: [
          "Clientes y contactos",
          "Direcciones, ciudad y tipo de trabajo",
          "Notas del cliente para el CRM",
          "Actualizaciones conservadoras de clientes y leads existentes",
        ],
        howTitle: "Cómo prepararlo",
        howItems: [
          "Exporta los datos desde tu sistema actual en CSV o Excel.",
          "Mantén una hoja por tipo de dato cuando sea posible.",
          "Usa columnas claras como nombre, teléfono, email, dirección y notas.",
          "Carga el archivo abajo, revisa la vista previa y luego impórtalo al CRM.",
        ],
      },
    };
  }

  return {
    page: {
      title: "Integrations",
      subtitle: (organizationName: string) =>
        `Connect Google Calendar, Outlook, and Stripe for ${organizationName}.`,
      backToSettings: "Back to Settings",
      exportMyData: "Export My Data",
    },
    feedback: {
      viewDetails: "View details",
      notConfiguredNotice: "Not configured. See status above.",
    },
    health: {
      title: "Integrations Health",
      subtitle:
        "Environment readiness for OAuth providers. Set any missing keys and redeploy to enable connections. This shows key names only, never secret values.",
      configured: "Configured",
      notConfigured: "Not configured",
      missingKeys: "Missing env keys:",
    },
    common: {
      status: "Status",
      connectedAt: "Connected at",
      lastSync: "Last sync",
      scopes: "Scopes",
      disconnect: "Disconnect",
      saveSyncSetting: "Save Sync Setting",
      enableOngoingSync: "Enable ongoing sync (phase 2)",
      emptyValue: "-",
    },
    statusValues: {
      ACTIVE: "Active",
      CONNECTED: "Connected",
      DISCONNECTED: "Disconnected",
      ERROR: "Error",
      NOT_CONNECTED: "Not connected",
      PENDING: "Pending",
      RESTRICTED: "Needs attention",
      IDLE: "Idle",
      RUNNING: "Running",
      OK: "OK",
      SUCCESS: "Success",
      FAILED: "Failed",
    } as Record<string, string>,
    stats: {
      customers: "customers",
      jobs: "jobs",
      invoices: "invoices",
      payments: "payments",
    },
    messages: {
      saved: {
        import: "Import started.",
        "disconnected-jobber": "Jobber disconnected.",
        "disconnected-qbo": "QuickBooks disconnected.",
        "disconnected-outlook": "Outlook disconnected.",
        "stripe-connected": "Stripe connected.",
        "stripe-disconnected": "Stripe disconnected.",
        "stripe-refreshed": "Stripe status refreshed.",
        "google-disconnected": "Google Calendar disconnected.",
        "sync-updated": "Sync setting saved.",
        "google-settings": "Google settings saved.",
        "google-sync-now": "Google sync completed.",
        "google-calendar-created": "Google calendar created.",
      } as Record<string, string>,
      errors: {
        "missing-org": "Organization is missing.",
        unauthorized: "Unauthorized.",
        "invalid-request": "The request is invalid.",
        "invalid-provider": "The provider is invalid.",
        "invalid-provider-value": "The provider value is invalid.",
        "invalid-date": "The date is invalid.",
        "invalid-date-range": "The date range is invalid.",
        "integration-sync-failed": "Failed to save sync setting.",
        "outlook-import-not-supported": "Outlook import is not supported.",
        "import-failed": "Import failed.",
        "google-settings-save-failed": "Failed to save Google settings.",
        "google-sync-failed": "Google sync failed.",
        "google-calendar-create-failed": "Failed to create Google calendar.",
        "google-calendars-load-failed": "Failed to load Google calendars.",
        "session-user-missing-id": "Session user is missing id.",
        jobber_not_configured: "Jobber isn't configured in this environment.",
        qbo_not_configured: "QuickBooks Online isn't configured in this environment.",
        stripe_not_configured: "Stripe isn't configured in this environment.",
        "stripe-missing-org": "Stripe returned without an organization context.",
        "stripe-connection-not-started": "Start the Stripe connection from the portal first.",
        "stripe-missing-code": "Stripe didn't return an authorization code.",
        "stripe-invalid-state": "Stripe state is no longer valid. Try connecting again.",
        "stripe-callback-failed": "Failed to complete the Stripe connection.",
        "stripe-refresh-failed": "Failed to refresh Stripe status.",
        "stripe-disconnect-failed": "Failed to disconnect Stripe.",
        google_not_configured: "Google Calendar isn't configured in this environment.",
        outlook_not_configured: "Microsoft Outlook isn't configured in this environment.",
      } as Record<string, string>,
    },
    outlook: {
      title: "Microsoft Outlook",
      subtitle: "Connect a Microsoft 365 mailbox for portal email sends like estimate share links and purchase orders.",
      mailbox: "Mailbox",
      account: "Account",
      error: "Error",
      connect: "Connect Outlook",
      reconnect: "Reconnect Outlook",
    },
    stripe: {
      title: "Stripe Payments",
      subtitle:
        "Connect the business Stripe account to prepare online collections and recurring billing. Each organization gets paid directly into its own Stripe account.",
      accountEmail: "Stripe email",
      accountName: "Business name",
      accountId: "Account id",
      country: "Country",
      currency: "Currency",
      liveMode: "Mode",
      error: "Error",
      capabilities: "Capabilities",
      detailsSubmitted: "Profile submitted",
      chargesEnabled: "charges enabled",
      chargesPending: "charges pending",
      payoutsEnabled: "payouts enabled",
      payoutsPending: "payouts pending",
      refresh: "Refresh Status",
      connect: "Connect Stripe",
      reconnect: "Reconnect Stripe",
      ready: "Ready to collect",
      notReady: "Not ready yet",
      live: "Live",
      test: "Test",
    },
    google: {
      title: "Google Calendar (Per User)",
      subtitle: "Connect your own Google account to sync your assigned TieGui jobs and import your busy blocks.",
      connectedEmail: "Connected email",
      syncError: "Sync error",
      connectRead: "Connect Google (Read)",
      reconnectRead: "Reconnect (Read)",
      connectWrite: "Connect with Write Access",
      reconnectWrite: "Reconnect (Read + Write)",
      syncNow: "Sync Now",
      enableSync: "Enable sync for my user",
      writeTargetCalendar: "Write target calendar",
      noWriteCalendar: "No write calendar",
      writeScopeNotice: "Write scope is not granted. Reconnect with write access to push TieGui jobs to Google.",
      readCalendarsLegend: "Read calendars used to block availability",
      noCalendars: "No calendars found for this Google account.",
      useForBlocking: "Use {name} for availability blocking",
      blockBusyOnly: "Block availability only when Google event is Busy",
      blockAllDay: "Count all-day events as busy",
      saveSettings: "Save Google Settings",
      createCalendarLabel: "Create new Google calendar",
      createCalendarAction: "Create Calendar and Use as Write Target",
      defaultCalendarName: "TieGui Jobs",
      primary: "Primary",
    },
    migration: {
      title: "Bring Customer Data Into TieGui",
      subtitle:
        "Jobber and QuickBooks are no longer shown as self-serve integrations. Instead, TieGui provides a clean CSV or Excel import path so customer data can move into the CRM without polluting it.",
      body:
        "Download the template, line up your columns if needed, and review the preview before importing. TieGui uses phone as the primary key so customer and lead records are created or updated conservatively.",
      supportedTitle: "What we can bring over",
      supportedItems: [
        "Customers and contacts",
        "Addresses, city, and work type",
        "Customer notes for the CRM",
        "Conservative updates to existing customers and leads",
      ],
      howTitle: "How to prepare it",
      howItems: [
        "Export the file from your current system as CSV or Excel.",
        "Keep one sheet per data type when possible.",
        "Use clear columns like name, phone, email, address, and notes.",
        "Upload it below, review the preview, and then import it into the CRM.",
      ],
    },
  };
}

type IntegrationsCopy = ReturnType<typeof getIntegrationsCopy>;

function formatEnumLabel(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatStatusValue(value: string | null | undefined, copy: IntegrationsCopy): string {
  if (!value) return copy.common.emptyValue;
  return copy.statusValues[value] || formatEnumLabel(value);
}

function resolveSavedMessage(saved: string | null, copy: IntegrationsCopy): string | null {
  if (!saved) return null;
  return copy.messages.saved[saved] || saved;
}

function formatIntegrationErrorMessage(error: string, copy: IntegrationsCopy): string {
  return copy.messages.errors[error] || error;
}

function isProviderConfigurationError(error: string): boolean {
  return error === "google_not_configured" || error === "outlook_not_configured" || error === "stripe_not_configured";
}

function IntegrationConnectAction({
  configured,
  href,
  className,
  label,
}: {
  configured: boolean;
  href: string;
  className: string;
  label: string;
}) {
  if (!configured) {
    return (
      <button className={className} type="button" disabled>
        {label}
      </button>
    );
  }

  return (
    <a className={className} href={href}>
      {label}
    </a>
  );
}

type IntegrationHealthItem = {
  label: string;
  configured: boolean;
  missingKeys: string[];
};

function formatConfigurationStatus(configured: boolean, copy: IntegrationsCopy): string {
  return configured ? `${copy.health.configured} ✅` : `${copy.health.notConfigured} ⚠️`;
}

function IntegrationHealthPanel({
  items,
  showMissingKeys,
  copy,
}: {
  items: IntegrationHealthItem[];
  showMissingKeys: boolean;
  copy: IntegrationsCopy;
}) {
  return (
    <section className="card" id="integrations-health">
      <h2>{copy.health.title}</h2>
      <p className="muted">{copy.health.subtitle}</p>
      <div className="integration-health-grid">
        {items.map((item) => (
          <article key={item.label} className="integration-health-card">
            <p style={{ margin: 0 }}>
              <strong>{item.label}</strong>
            </p>
            <p className="muted" style={{ marginTop: 8 }}>
              {formatConfigurationStatus(item.configured, copy)}
            </p>
            {!item.configured && showMissingKeys && item.missingKeys.length > 0 ? (
              <div style={{ marginTop: 10 }}>
                <p className="muted" style={{ margin: 0 }}>
                  {copy.health.missingKeys}
                </p>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    marginTop: 8,
                  }}
                >
                  {item.missingKeys.map((key) => (
                    <code key={key} className="integration-health-chip">
                      {key}
                    </code>
                  ))}
                </div>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
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
    if (providerValue !== "OUTLOOK") {
      throw new Error("Invalid provider");
    }

    await disconnectIntegrationAccount({
      orgId,
      provider: "OUTLOOK",
    });

    revalidatePath("/app/settings/integrations");
    redirect(withOrgQuery("/app/settings/integrations?saved=disconnected-outlook", orgId, internalUser));
  } catch {
    redirect(withOrgQuery("/app/settings/integrations?error=invalid-provider", orgId, internalUser));
  }
}

async function refreshStripeAction(formData: FormData) {
  "use server";

  const orgId = String(formData.get("orgId") || "").trim();
  if (!orgId) {
    redirect("/app/settings/integrations?error=missing-org");
  }

  const { internalUser } = await requireAppOrgAccess("/app/settings/integrations", orgId);
  const { stripeConfigured } = getIntegrationProviderConfiguration();
  if (!stripeConfigured) {
    redirect(withOrgQuery("/app/settings/integrations?error=stripe_not_configured", orgId, internalUser));
  }

  try {
    await refreshOrganizationStripeConnection({ orgId });
    revalidatePath("/app/settings/integrations");
    redirect(withOrgQuery("/app/settings/integrations?saved=stripe-refreshed", orgId, internalUser));
  } catch (error) {
    const message = error instanceof Error ? error.message : "stripe-refresh-failed";
    redirect(withOrgQuery(`/app/settings/integrations?error=${encodeURIComponent(message)}`, orgId, internalUser));
  }
}

async function disconnectStripeAction(formData: FormData) {
  "use server";

  const orgId = String(formData.get("orgId") || "").trim();
  if (!orgId) {
    redirect("/app/settings/integrations?error=missing-org");
  }

  const { internalUser } = await requireAppOrgAccess("/app/settings/integrations", orgId);
  const { stripeConfigured } = getIntegrationProviderConfiguration();
  if (!stripeConfigured) {
    redirect(withOrgQuery("/app/settings/integrations?error=stripe_not_configured", orgId, internalUser));
  }

  try {
    await disconnectOrganizationStripeConnection({ orgId });
    revalidatePath("/app/settings/integrations");
    redirect(withOrgQuery("/app/settings/integrations?saved=stripe-disconnected", orgId, internalUser));
  } catch (error) {
    const message = error instanceof Error ? error.message : "stripe-disconnect-failed";
    redirect(withOrgQuery(`/app/settings/integrations?error=${encodeURIComponent(message)}`, orgId, internalUser));
  }
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
    const message = error instanceof Error ? error.message : "google-settings-save-failed";
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
    const message = error instanceof Error ? error.message : "google-sync-failed";
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

  const locale = await getRequestLocale();
  const copy = getIntegrationsCopy(locale);
  const calendarName = String(formData.get("calendarName") || "").trim() || copy.google.defaultCalendarName;

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
    const message = error instanceof Error ? error.message : "google-calendar-create-failed";
    redirect(withOrgQuery(`/app/settings/integrations?error=${encodeURIComponent(message)}`, orgId, internalUser));
  }
}

export default async function IntegrationsSettingsPage(
  props: {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const searchParams = await props.searchParams;
  const locale = await getRequestLocale();
  const copy = getIntegrationsCopy(locale);
  const requestedOrgId = getParam(searchParams?.orgId);
  const scope = await resolveAppScope({ nextPath: "/app/settings/integrations", requestedOrgId });
  const saved = getParam(searchParams?.saved);
  const error = getParam(searchParams?.error);
  const viewer = await requireAppPageViewer({
    nextPath: "/app/settings/integrations",
    orgId: scope.orgId,
  });
  const sessionUser = await requireSessionUser("/app/settings/integrations");
  const {
    googleConfigured,
    outlookConfigured,
    stripeConfigured,
    googleMissingKeys,
    outlookMissingKeys,
    stripeMissingKeys,
  } = getIntegrationProviderConfiguration();

  const googleResult = sessionUser.id
    ? await fetchGoogleCalendarsForOrgUser({
        orgId: scope.orgId,
        userId: sessionUser.id,
      }).catch((fetchError) => ({
        connected: false,
        account: null,
        calendars: [],
        hasWriteScope: false,
        error: fetchError instanceof Error ? fetchError.message : "google-calendars-load-failed",
      }))
    : {
        connected: false,
        account: null,
        calendars: [],
        hasWriteScope: false,
        error: "session-user-missing-id",
      };

  const [organization, accounts, stripeConnection, customerImportHistory] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: scope.orgId },
      select: { id: true, name: true },
    }),
    prisma.integrationAccount.findMany({
      where: { orgId: scope.orgId },
      orderBy: { provider: "asc" },
    }),
    prisma.organizationStripeConnection.findUnique({
      where: { orgId: scope.orgId },
    }),
    listCustomerImportRuns({ orgId: scope.orgId }),
  ]);

  if (!organization) {
    redirect(scope.internalUser ? "/hq/businesses" : "/app");
  }

  const outlook = accounts.find((account) => account.provider === "OUTLOOK");
  const stripeConnected = Boolean(stripeConnection && stripeConnection.status !== "DISCONNECTED");
  const googleAccount = googleResult.connected ? googleResult.account : null;
  const googleCalendars = googleResult.calendars || [];
  const googleReadCalendarIds = googleAccount ? normalizeReadCalendarIds(googleAccount.readCalendarIdsJson) : [];
  const googleBlockRules = googleAccount ? getGoogleAccountBlockRules(googleAccount) : {};
  const googleHasWriteScope = googleAccount ? hasWritePermissionFromScopes(googleAccount.scopes) : false;
  const googleLoadError = "error" in googleResult ? formatIntegrationErrorMessage(String(googleResult.error || ""), copy) : "";
  const stripeCapabilities = stripeConnection
    ? [
        stripeConnection.chargesEnabled ? copy.stripe.chargesEnabled : copy.stripe.chargesPending,
        stripeConnection.payoutsEnabled ? copy.stripe.payoutsEnabled : copy.stripe.payoutsPending,
      ].join(", ")
    : copy.common.emptyValue;
  const savedMessage = resolveSavedMessage(saved, copy);
  const providerConfigurationError =
    error && isProviderConfigurationError(error) ? formatIntegrationErrorMessage(error, copy) : null;
  const pageError = error ? formatIntegrationErrorMessage(error, copy) : null;
  const canViewMissingKeyDetails = viewer.internalUser || viewer.calendarAccessRole === "OWNER";
  const healthItems: IntegrationHealthItem[] = [
    {
      label: "Stripe Payments",
      configured: stripeConfigured,
      missingKeys: stripeMissingKeys,
    },
    {
      label: "Google Calendar",
      configured: googleConfigured,
      missingKeys: googleMissingKeys,
    },
    {
      label: "Microsoft Outlook",
      configured: outlookConfigured,
      missingKeys: outlookMissingKeys,
    },
  ];

  return (
    <>
      <section className="card">
        <h2>{copy.page.title}</h2>
        <p className="muted">{copy.page.subtitle(organization.name)}</p>
        <div className="quick-links" style={{ marginTop: 12 }}>
          <Link className="btn secondary" href={withOrgQuery("/app/settings", scope.orgId, scope.internalUser)}>
            {copy.page.backToSettings}
          </Link>
          <a className="btn secondary" href={withOrgQuery("/api/export", scope.orgId, scope.internalUser)}>
            {copy.page.exportMyData}
          </a>
        </div>
        {savedMessage ? <p className="form-status">{savedMessage}</p> : null}
        {error ? (
          <p className="form-status">
            {providerConfigurationError ? (
              <>
                {providerConfigurationError}{" "}
                <a href="#integrations-health">{copy.feedback.viewDetails}</a>
              </>
            ) : (
              <>{pageError}</>
            )}
          </p>
        ) : null}
      </section>

      <IntegrationHealthPanel items={healthItems} showMissingKeys={canViewMissingKeyDetails} copy={copy} />

      <section className="grid">
        <article className="card">
          <h2>{copy.stripe.title}</h2>
          <p className="muted">{copy.stripe.subtitle}</p>
          <p style={{ marginTop: 10 }}>
            {copy.common.status}: <strong>{formatStatusValue(stripeConnection?.status || "NOT_CONNECTED", copy)}</strong>
          </p>
          <p className="muted">{copy.stripe.accountEmail}: {stripeConnection?.stripeAccountEmail || copy.common.emptyValue}</p>
          <p className="muted">{copy.stripe.accountName}: {stripeConnection?.stripeDisplayName || copy.common.emptyValue}</p>
          <p className="muted">{copy.stripe.accountId}: {stripeConnection?.stripeAccountId || copy.common.emptyValue}</p>
          <p className="muted">{copy.stripe.country}: {stripeConnection?.stripeCountry || copy.common.emptyValue}</p>
          <p className="muted">{copy.stripe.currency}: {stripeConnection?.defaultCurrency || copy.common.emptyValue}</p>
          <p className="muted">
            {copy.stripe.liveMode}: {stripeConnection ? (stripeConnection.livemode ? copy.stripe.live : copy.stripe.test) : copy.common.emptyValue}
          </p>
          <p className="muted">{copy.stripe.capabilities}: {stripeCapabilities}</p>
          <p className="muted">
            {copy.stripe.detailsSubmitted}:{" "}
            {stripeConnection
              ? stripeConnection.detailsSubmitted
                ? copy.health.configured
                : copy.health.notConfigured
              : copy.common.emptyValue}
          </p>
          <p className="muted">
            {copy.common.connectedAt}: {stripeConnection ? formatDateTime(stripeConnection.connectedAt) : copy.common.emptyValue}
          </p>
          <p className="muted">
            {copy.common.lastSync}: {stripeConnection?.lastSyncedAt ? formatDateTime(stripeConnection.lastSyncedAt) : copy.common.emptyValue}
          </p>
          <p className="muted">{copy.stripe.error}: {stripeConnection?.lastError || copy.common.emptyValue}</p>
          {!stripeConfigured ? <p className="form-status">{copy.feedback.notConfiguredNotice}</p> : null}
          <div className="quick-links" style={{ marginTop: 10 }}>
            <IntegrationConnectAction
              configured={stripeConfigured}
              className="btn primary"
              href={withOrgQuery("/api/integrations/stripe/connect", scope.orgId, scope.internalUser)}
              label={stripeConnection ? copy.stripe.reconnect : copy.stripe.connect}
            />
            {stripeConnected ? (
              <form action={refreshStripeAction}>
                <input type="hidden" name="orgId" value={scope.orgId} />
                <button className="btn secondary" type="submit" disabled={!stripeConfigured}>
                  {copy.stripe.refresh}
                </button>
              </form>
            ) : null}
            {stripeConnected ? (
              <form action={disconnectStripeAction}>
                <input type="hidden" name="orgId" value={scope.orgId} />
                <button className="btn secondary" type="submit" disabled={!stripeConfigured}>
                  {copy.common.disconnect}
                </button>
              </form>
            ) : null}
          </div>
        </article>

        <article className="card">
          <h2>{copy.outlook.title}</h2>
          <p className="muted">{copy.outlook.subtitle}</p>
          <p style={{ marginTop: 10 }}>
            {copy.common.status}: <strong>{formatStatusValue(outlook?.status || "NOT_CONNECTED", copy)}</strong>
          </p>
          <p className="muted">{copy.outlook.mailbox}: {outlook?.providerEmail || copy.common.emptyValue}</p>
          <p className="muted">
            {copy.outlook.account}: {outlook?.providerDisplayName || outlook?.providerAccountId || copy.common.emptyValue}
          </p>
          <p className="muted">
            {copy.common.connectedAt}: {outlook ? formatDateTime(outlook.connectedAt) : copy.common.emptyValue}
          </p>
          <p className="muted">
            {copy.common.lastSync}: {outlook?.lastSyncedAt ? formatDateTime(outlook.lastSyncedAt) : copy.common.emptyValue}
          </p>
          <p className="muted">
            {copy.common.scopes}: {outlook?.scopes.join(", ") || copy.common.emptyValue}
          </p>
          <p className="muted">{copy.outlook.error}: {outlook?.lastError || copy.common.emptyValue}</p>
          {!outlookConfigured ? <p className="form-status">{copy.feedback.notConfiguredNotice}</p> : null}
          <div className="quick-links" style={{ marginTop: 10 }}>
            <IntegrationConnectAction
              configured={outlookConfigured}
              className="btn primary"
              href={withOrgQuery("/api/integrations/outlook/connect", scope.orgId, scope.internalUser)}
              label={outlook ? copy.outlook.reconnect : copy.outlook.connect}
            />
            {outlook ? (
              <form action={disconnectAction}>
                <input type="hidden" name="orgId" value={scope.orgId} />
                <input type="hidden" name="provider" value="OUTLOOK" />
                <button className="btn secondary" type="submit">
                  {copy.common.disconnect}
                </button>
              </form>
            ) : null}
          </div>
        </article>

        <article className="card">
          <h2>{copy.google.title}</h2>
          <p className="muted">{copy.google.subtitle}</p>
          <p style={{ marginTop: 10 }}>
            {copy.common.status}: <strong>{formatStatusValue(googleAccount ? googleAccount.syncStatus : "NOT_CONNECTED", copy)}</strong>
          </p>
          <p className="muted">{copy.google.connectedEmail}: {googleAccount?.googleEmail || copy.common.emptyValue}</p>
          <p className="muted">
            {copy.common.connectedAt}: {googleAccount ? formatDateTime(googleAccount.connectedAt) : copy.common.emptyValue}
          </p>
          <p className="muted">
            {copy.common.lastSync}: {googleAccount?.lastSyncAt ? formatDateTime(googleAccount.lastSyncAt) : copy.common.emptyValue}
          </p>
          <p className="muted">
            {copy.common.scopes}: {googleAccount?.scopes.join(", ") || copy.common.emptyValue}
          </p>
          <p className="muted">{copy.google.syncError}: {googleAccount?.syncError || googleLoadError || copy.common.emptyValue}</p>
          {!googleConfigured ? <p className="form-status">{copy.feedback.notConfiguredNotice}</p> : null}

          <div className="quick-links" style={{ marginTop: 10 }}>
            <IntegrationConnectAction
              configured={googleConfigured}
              className="btn primary"
              href={withOrgQuery("/api/integrations/google/connect?mode=read", scope.orgId, scope.internalUser)}
              label={googleAccount ? copy.google.reconnectRead : copy.google.connectRead}
            />
            <IntegrationConnectAction
              configured={googleConfigured}
              className="btn secondary"
              href={withOrgQuery("/api/integrations/google/connect?mode=write", scope.orgId, scope.internalUser)}
              label={googleHasWriteScope ? copy.google.reconnectWrite : copy.google.connectWrite}
            />
            {googleAccount ? (
              <form action={disconnectGoogleAction}>
                <input type="hidden" name="orgId" value={scope.orgId} />
                <button className="btn secondary" type="submit">
                  {copy.common.disconnect}
                </button>
              </form>
            ) : null}
            {googleAccount ? (
              <form action={syncGoogleNowAction}>
                <input type="hidden" name="orgId" value={scope.orgId} />
                <button className="btn secondary" type="submit">
                  {copy.google.syncNow}
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
                  {copy.google.enableSync}
                </label>

                <label>
                  {copy.google.writeTargetCalendar}
                  <select name="writeCalendarId" defaultValue={googleAccount.writeCalendarId || ""}>
                    <option value="">{copy.google.noWriteCalendar}</option>
                    {googleCalendars.map((calendar) => (
                      <option key={calendar.id} value={calendar.id}>
                        {calendar.summary}
                        {calendar.primary ? ` (${copy.google.primary})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {!googleHasWriteScope ? (
                  <p className="muted">{copy.google.writeScopeNotice}</p>
                ) : null}

                <fieldset className="auth-form" style={{ gap: 8 }}>
                  <legend>{copy.google.readCalendarsLegend}</legend>
                  {googleCalendars.length === 0 ? (
                    <p className="muted">{copy.google.noCalendars}</p>
                  ) : (
                    googleCalendars.map((calendar) => {
                      const selected = googleReadCalendarIds.includes(calendar.id);
                      const rule = googleBlockRules[calendar.id] || {
                        blockIfBusyOnly: true,
                        blockAllDay: true,
                      };
                      return (
                        <div key={calendar.id} className="integration-calendar-card">
                          <label className="inline-toggle">
                            <input type="checkbox" name="readCalendarIds" value={calendar.id} defaultChecked={selected} />
                            {copy.google.useForBlocking.replace("{name}", calendar.summary)}
                          </label>
                          <label className="inline-toggle">
                            <input
                              type="checkbox"
                              name="busyOnlyCalendarIds"
                              value={calendar.id}
                              defaultChecked={rule.blockIfBusyOnly !== false}
                            />
                            {copy.google.blockBusyOnly}
                          </label>
                          <label className="inline-toggle">
                            <input
                              type="checkbox"
                              name="allDayCalendarIds"
                              value={calendar.id}
                              defaultChecked={rule.blockAllDay !== false}
                            />
                            {copy.google.blockAllDay}
                          </label>
                        </div>
                      );
                    })
                  )}
                </fieldset>

                <button className="btn secondary" type="submit">
                  {copy.google.saveSettings}
                </button>
              </form>

              <form action={createGoogleCalendarAction} className="auth-form" style={{ marginTop: 12 }}>
                <input type="hidden" name="orgId" value={scope.orgId} />
                <label>
                  {copy.google.createCalendarLabel}
                  <input name="calendarName" defaultValue={copy.google.defaultCalendarName} />
                </label>
                <button className="btn secondary" type="submit">
                  {copy.google.createCalendarAction}
                </button>
              </form>
            </>
          ) : null}
        </article>
      </section>

      <section className="card">
        <h2>{copy.migration.title}</h2>
        <p className="muted">{copy.migration.subtitle}</p>
        <p style={{ marginTop: 12 }}>{copy.migration.body}</p>

        <div className="grid" style={{ marginTop: 16 }}>
          <article className="card" style={{ margin: 0 }}>
            <h3 style={{ marginTop: 0 }}>{copy.migration.supportedTitle}</h3>
            <ul className="list" style={{ marginTop: 8 }}>
              {copy.migration.supportedItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>

          <article className="card" style={{ margin: 0 }}>
            <h3 style={{ marginTop: 0 }}>{copy.migration.howTitle}</h3>
            <ol className="list" style={{ marginTop: 8, paddingLeft: 20 }}>
              {copy.migration.howItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          </article>
        </div>

        <CustomerDataImportCard orgId={scope.orgId} initialHistory={customerImportHistory} />
      </section>
    </>
  );
}
