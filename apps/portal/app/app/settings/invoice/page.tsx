import Link from "next/link";
import { redirect } from "next/navigation";
import { getRequestTranslator } from "@/lib/i18n";
import { resolveOrganizationLogoUrl } from "@/lib/organization-logo";
import { normalizeInvoiceTemplate } from "@/lib/invoice-template";
import { prisma } from "@/lib/prisma";
import type { InvoicePreviewData } from "../../_components/invoice-preview";
import {
  getParam,
  requireAppOrgActor,
  resolveAppScope,
  withOrgQuery,
} from "../../_lib/portal-scope";
import InvoiceTemplateSettings from "./invoice-template-settings";

export const dynamic = "force-dynamic";

function withStatusQuery(
  path: string,
  key: string,
  value: string,
  orgId: string,
  internalUser: boolean,
) {
  return withOrgQuery(
    `${path}${path.includes("?") ? "&" : "?"}${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    orgId,
    internalUser,
  );
}

function parseBoundedInt(
  value: string,
  {
    min,
    max,
  }: {
    min: number;
    max: number;
  },
) {
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return null;
  }
  return parsed;
}

function buildAddressLines(input: {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}): string[] {
  const locality = [input.city, input.state, input.zip]
    .map((part) => (part || "").trim())
    .filter(Boolean)
    .join(", ");
  return [input.addressLine1, input.addressLine2, locality]
    .map((part) => (part || "").trim())
    .filter(Boolean);
}

export default async function InvoiceTemplateSettingsPage(
  props: {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const searchParams = await props.searchParams;
  const t = await getRequestTranslator();
  const requestedOrgId = getParam(searchParams?.orgId);
  const saved = getParam(searchParams?.saved);
  const error = getParam(searchParams?.error);
  const scope = await resolveAppScope({
    nextPath: "/app/settings/invoice",
    requestedOrgId,
  });
  const actor = await requireAppOrgActor("/app/settings/invoice", scope.orgId);
  const canManage =
    actor.internalUser ||
    actor.calendarAccessRole === "OWNER" ||
    actor.calendarAccessRole === "ADMIN";

  const organization = await prisma.organization.findUnique({
    where: { id: scope.orgId },
    select: {
      id: true,
      name: true,
      legalName: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      state: true,
      zip: true,
      phone: true,
      invoiceTemplate: true,
      invoicePaymentInstructions: true,
      invoiceCollectionsEnabled: true,
      invoiceCollectionsAutoSendEnabled: true,
      invoiceFirstReminderLeadDays: true,
      invoiceOverdueReminderCadenceDays: true,
      invoiceCollectionsMaxReminders: true,
      invoiceCollectionsUrgentAfterDays: true,
      invoiceCollectionsFinalAfterDays: true,
      logoPhotoId: true,
    },
  });

  if (!organization) {
    return null;
  }

  const logoUrl = await resolveOrganizationLogoUrl({
    orgId: organization.id,
    logoPhotoId: organization.logoPhotoId,
  });

  const businessName = organization.legalName?.trim() || organization.name;
  const businessAddressLines = buildAddressLines({
    addressLine1: organization.addressLine1,
    addressLine2: organization.addressLine2,
    city: organization.city,
    state: organization.state,
    zip: organization.zip,
  });
  const settingsPath = withOrgQuery(
    "/app/settings",
    scope.orgId,
    scope.internalUser,
  );
  const invoiceSettingsPath = withOrgQuery(
    "/app/settings/invoice",
    scope.orgId,
    scope.internalUser,
  );

  async function updateCollectionsSettingsAction(formData: FormData) {
    "use server";

    const actor = await requireAppOrgActor("/app/settings/invoice", scope.orgId);
    const canManageCollections =
      actor.internalUser ||
      actor.calendarAccessRole === "OWNER" ||
      actor.calendarAccessRole === "ADMIN";

    if (!canManageCollections) {
      redirect(
        withStatusQuery(
          "/app/settings/invoice",
          "error",
          "readonly",
          scope.orgId,
          scope.internalUser,
        ),
      );
    }

    const enabled = String(formData.get("invoiceCollectionsEnabled") || "") === "on";
    const autoSendEnabled =
      String(formData.get("invoiceCollectionsAutoSendEnabled") || "") === "on";
    const firstReminderLeadDays = parseBoundedInt(
      String(formData.get("invoiceFirstReminderLeadDays") || ""),
      { min: 0, max: 30 },
    );
    const overdueReminderCadenceDays = parseBoundedInt(
      String(formData.get("invoiceOverdueReminderCadenceDays") || ""),
      { min: 1, max: 60 },
    );
    const maxReminders = parseBoundedInt(
      String(formData.get("invoiceCollectionsMaxReminders") || ""),
      { min: 1, max: 6 },
    );
    const urgentAfterDays = parseBoundedInt(
      String(formData.get("invoiceCollectionsUrgentAfterDays") || ""),
      { min: 1, max: 120 },
    );
    const finalAfterDays = parseBoundedInt(
      String(formData.get("invoiceCollectionsFinalAfterDays") || ""),
      { min: 2, max: 180 },
    );

    if (
      firstReminderLeadDays === null ||
      overdueReminderCadenceDays === null ||
      maxReminders === null ||
      urgentAfterDays === null ||
      finalAfterDays === null ||
      finalAfterDays <= urgentAfterDays
    ) {
      redirect(
        withStatusQuery(
          "/app/settings/invoice",
          "error",
          "collections",
          scope.orgId,
          scope.internalUser,
        ),
      );
    }

    await prisma.organization.update({
      where: { id: scope.orgId },
      data: {
        invoiceCollectionsEnabled: enabled,
        invoiceCollectionsAutoSendEnabled: autoSendEnabled,
        invoiceFirstReminderLeadDays: firstReminderLeadDays,
        invoiceOverdueReminderCadenceDays: overdueReminderCadenceDays,
        invoiceCollectionsMaxReminders: maxReminders,
        invoiceCollectionsUrgentAfterDays: urgentAfterDays,
        invoiceCollectionsFinalAfterDays: finalAfterDays,
      },
    });

    redirect(
      withStatusQuery(
        "/app/settings/invoice",
        "saved",
        "collections",
        scope.orgId,
        scope.internalUser,
      ),
    );
  }

  const previewInvoice: InvoicePreviewData = {
    invoiceNumber: "INV-2026-1042",
    issueDate: new Date("2026-04-13T12:00:00.000Z").toISOString(),
    dueDate: new Date("2026-04-20T12:00:00.000Z").toISOString(),
    status: "SENT",
    jobTitle: t("invoiceTemplateSettings.previewInvoice.jobTitle"),
    termsLabel: t("invoiceTemplateSettings.previewInvoice.termsLabel"),
    business: {
      name: businessName,
      logoUrl,
      addressLines:
        businessAddressLines.length > 0
          ? businessAddressLines
          : ["1280 Foundry Lane", "San Antonio, TX 78205"],
      phone: organization.phone || "(210) 555-0188",
    },
    customer: {
      name: t("invoiceTemplateSettings.previewInvoice.customerName"),
      addressLines: ["1842 Juniper Ridge Drive", "Austin, TX 78704"],
    },
    lineItems: [
      {
        description: t("invoiceTemplateSettings.previewInvoice.lineItemOne"),
        quantity: "1",
        unitPrice: "850.00",
        subtotal: "850.00",
      },
      {
        description: t("invoiceTemplateSettings.previewInvoice.lineItemTwo"),
        quantity: "1",
        unitPrice: "1000.00",
        subtotal: "1000.00",
      },
    ],
    subtotal: "1850.00",
    taxLabel: t("invoiceTemplateSettings.previewInvoice.taxLabel"),
    taxAmount: "152.63",
    total: "2002.63",
    notes: t("invoiceTemplateSettings.previewInvoice.notes"),
    paymentTerms:
      organization.invoicePaymentInstructions?.trim() ||
      t("invoiceTemplateSettings.previewInvoice.paymentTerms"),
  };

  return (
    <section>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="invoice-header-row">
          <div className="stack-cell">
            <Link className="table-link" href={settingsPath}>
              {t("invoiceTemplateSettings.page.back")}
            </Link>
            <h2>{t("invoiceTemplateSettings.page.title")}</h2>
            <p className="muted">
              {t("invoiceTemplateSettings.page.description")}
            </p>
          </div>
        </div>
      </div>

      <InvoiceTemplateSettings
        orgId={organization.id}
        canManage={canManage}
        initialTemplate={normalizeInvoiceTemplate(organization.invoiceTemplate)}
        previewInvoice={previewInvoice}
      />

      <section className="card">
        <div className="invoice-header-row">
          <div className="stack-cell">
            <h2>{t("invoiceTemplateSettings.collections.title")}</h2>
            <p className="muted">
              {t("invoiceTemplateSettings.collections.description")}
            </p>
          </div>
        </div>

        {!canManage ? (
          <p className="form-status" style={{ marginTop: 12 }}>
            {t("invoiceTemplateSettings.collections.readOnly")}
          </p>
        ) : null}
        {saved === "collections" ? (
          <p className="form-status" style={{ marginTop: 12 }}>
            {t("invoiceTemplateSettings.collections.saved")}
          </p>
        ) : null}
        {error === "collections" ? (
          <p className="form-status" style={{ marginTop: 12 }}>
            {t("invoiceTemplateSettings.collections.error")}
          </p>
        ) : null}
        {error === "readonly" ? (
          <p className="form-status" style={{ marginTop: 12 }}>
            {t("invoiceTemplateSettings.collections.readOnly")}
          </p>
        ) : null}

        <form
          action={updateCollectionsSettingsAction}
          className="auth-form"
          style={{ marginTop: 16 }}
        >
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <input
              type="checkbox"
              name="invoiceCollectionsEnabled"
              defaultChecked={organization.invoiceCollectionsEnabled}
              disabled={!canManage}
              style={{ marginTop: 4 }}
            />
            <span>
              <strong>{t("invoiceTemplateSettings.collections.enabledLabel")}</strong>
              <br />
              <span className="muted">
                {t("invoiceTemplateSettings.collections.enabledNote")}
              </span>
            </span>
          </label>

          <label style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <input
              type="checkbox"
              name="invoiceCollectionsAutoSendEnabled"
              defaultChecked={organization.invoiceCollectionsAutoSendEnabled}
              disabled={!canManage}
              style={{ marginTop: 4 }}
            />
            <span>
              <strong>{t("invoiceTemplateSettings.collections.autoSendEnabledLabel")}</strong>
              <br />
              <span className="muted">
                {t("invoiceTemplateSettings.collections.autoSendEnabledNote")}
              </span>
            </span>
          </label>

          <label>
            {t("invoiceTemplateSettings.collections.firstReminderLeadDaysLabel")}
            <input
              type="number"
              min={0}
              max={30}
              name="invoiceFirstReminderLeadDays"
              defaultValue={organization.invoiceFirstReminderLeadDays}
              disabled={!canManage}
            />
            <span className="muted">
              {t("invoiceTemplateSettings.collections.firstReminderLeadDaysHelp")}
            </span>
          </label>

          <label>
            {t("invoiceTemplateSettings.collections.overdueReminderCadenceDaysLabel")}
            <input
              type="number"
              min={1}
              max={60}
              name="invoiceOverdueReminderCadenceDays"
              defaultValue={organization.invoiceOverdueReminderCadenceDays}
              disabled={!canManage}
            />
            <span className="muted">
              {t("invoiceTemplateSettings.collections.overdueReminderCadenceDaysHelp")}
            </span>
          </label>

          <label>
            {t("invoiceTemplateSettings.collections.maxRemindersLabel")}
            <input
              type="number"
              min={1}
              max={6}
              name="invoiceCollectionsMaxReminders"
              defaultValue={organization.invoiceCollectionsMaxReminders}
              disabled={!canManage}
            />
            <span className="muted">
              {t("invoiceTemplateSettings.collections.maxRemindersHelp")}
            </span>
          </label>

          <label>
            {t("invoiceTemplateSettings.collections.urgentAfterDaysLabel")}
            <input
              type="number"
              min={1}
              max={120}
              name="invoiceCollectionsUrgentAfterDays"
              defaultValue={organization.invoiceCollectionsUrgentAfterDays}
              disabled={!canManage}
            />
            <span className="muted">
              {t("invoiceTemplateSettings.collections.urgentAfterDaysHelp")}
            </span>
          </label>

          <label>
            {t("invoiceTemplateSettings.collections.finalAfterDaysLabel")}
            <input
              type="number"
              min={2}
              max={180}
              name="invoiceCollectionsFinalAfterDays"
              defaultValue={organization.invoiceCollectionsFinalAfterDays}
              disabled={!canManage}
            />
            <span className="muted">
              {t("invoiceTemplateSettings.collections.finalAfterDaysHelp")}
            </span>
          </label>

          <div className="quick-links">
            <button className="btn primary" type="submit" disabled={!canManage}>
              {t("invoiceTemplateSettings.collections.save")}
            </button>
            <Link className="btn secondary" href={invoiceSettingsPath}>
              {t("invoiceTemplateSettings.collections.reset")}
            </Link>
          </div>
        </form>
      </section>
    </section>
  );
}
