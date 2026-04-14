import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { CalendarAccessRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getParam, requireAppOrgActor, resolveAppScope, withOrgQuery } from "../../_lib/portal-scope";
import BrandingSaveStatus from "./branding-save-status";
import OrgLogoUploader from "./org-logo-uploader";

export const dynamic = "force-dynamic";

function clampText(value: string, max: number): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function normalizeInvoicePrefix(value: string): string | null {
  const trimmed = value.trim().toUpperCase();
  if (!trimmed) return null;
  if (!/^[A-Z0-9]{2,8}$/.test(trimmed)) return null;
  return trimmed;
}

async function requireBrandingWriteAccess(orgId: string): Promise<{ internalUser: boolean; calendarAccessRole: CalendarAccessRole | null }> {
  const actor = await requireAppOrgActor("/app/settings/branding", orgId);

  if (actor.internalUser) {
    return { internalUser: true, calendarAccessRole: null };
  }

  const role = actor.calendarAccessRole;
  if (role !== "OWNER" && role !== "ADMIN") {
    redirect(withOrgQuery("/app/settings?error=forbidden", orgId, false));
  }

  return { internalUser: false, calendarAccessRole: role };
}

async function updateBrandingAction(formData: FormData) {
  "use server";

  const orgId = String(formData.get("orgId") || "").trim();
  if (!orgId) {
    redirect("/app/settings");
  }

  const { internalUser } = await requireBrandingWriteAccess(orgId);

  const legalName = clampText(String(formData.get("legalName") || ""), 140);
  const addressLine1 = clampText(String(formData.get("addressLine1") || ""), 140);
  const addressLine2 = clampText(String(formData.get("addressLine2") || ""), 140);
  const city = clampText(String(formData.get("city") || ""), 80);
  const state = clampText(String(formData.get("state") || ""), 40);
  const zip = clampText(String(formData.get("zip") || ""), 20);
  const phone = clampText(String(formData.get("phone") || ""), 40);
  const email = clampText(String(formData.get("email") || ""), 120);
  const website = clampText(String(formData.get("website") || ""), 160);
  const licenseNumber = clampText(String(formData.get("licenseNumber") || ""), 80);
  const ein = clampText(String(formData.get("ein") || ""), 40);
  const invoicePrefixRaw = String(formData.get("invoicePrefix") || "");
  const invoicePaymentInstructions = clampText(String(formData.get("invoicePaymentInstructions") || ""), 2000);

  const invoicePrefix = normalizeInvoicePrefix(invoicePrefixRaw);
  if (!invoicePrefix) {
    redirect(withOrgQuery("/app/settings/branding?error=invoicePrefix", orgId, internalUser));
  }

  await prisma.organization.update({
    where: { id: orgId },
    data: {
      legalName,
      addressLine1,
      addressLine2,
      city,
      state,
      zip,
      phone,
      email,
      website,
      licenseNumber,
      ein,
      invoicePrefix,
      invoicePaymentInstructions,
    },
    select: { id: true },
  });

  revalidatePath("/app/settings/branding");
  revalidatePath("/app/invoices");

  redirect(withOrgQuery("/app/settings/branding?saved=1", orgId, internalUser));
}

export default async function BrandingSettingsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const requestedOrgId = getParam(searchParams?.orgId);
  const scope = await resolveAppScope({ nextPath: "/app/settings/branding", requestedOrgId });
  const saved = getParam(searchParams?.saved);
  const error = getParam(searchParams?.error);

  await requireBrandingWriteAccess(scope.orgId);

  const org = await prisma.organization.findUnique({
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
      email: true,
      website: true,
      licenseNumber: true,
      ein: true,
      invoicePrefix: true,
      invoicePaymentInstructions: true,
    },
  });

  if (!org) {
    redirect("/app/settings");
  }

  const settingsPath = withOrgQuery("/app/settings", scope.orgId, scope.internalUser);
  const invoicePrefixError =
    error === "invoicePrefix" ? "Invoice prefix must be 2-8 letters/numbers (example: INV)." : null;

  return (
    <section className="card">
      <div className="invoice-header-row">
        <div className="stack-cell">
          <Link className="table-link" href={settingsPath}>
            ← Back to Settings
          </Link>
          <h2>Branding & Invoices</h2>
          <p className="muted">These details appear on invoice PDFs so they look like your own system.</p>
        </div>
      </div>

      <div className="grid two-col" style={{ marginTop: 12 }}>
        <article>
          <h2 style={{ marginTop: 0 }}>Logo</h2>
          <p className="muted">Optional. Recommended size: a wide logo, under 2MB.</p>
          <p className="form-status">If object storage is unavailable, uploads fall back to secure inline storage.</p>
          <OrgLogoUploader orgId={org.id} />
        </article>

        <article>
          <h2 style={{ marginTop: 0 }}>Business identity</h2>
          <form action={updateBrandingAction} className="auth-form" style={{ marginTop: 12 }}>
            <input type="hidden" name="orgId" value={org.id} />

            <label>
              Company name (on invoices)
              <input name="legalName" defaultValue={org.legalName || org.name} maxLength={140} />
            </label>

            <div className="grid two-col">
              <label>
                Address line 1
                <input name="addressLine1" defaultValue={org.addressLine1 || ""} maxLength={140} />
              </label>
              <label>
                Address line 2
                <input name="addressLine2" defaultValue={org.addressLine2 || ""} maxLength={140} />
              </label>
            </div>

            <div className="grid two-col">
              <label>
                City
                <input name="city" defaultValue={org.city || ""} maxLength={80} />
              </label>
              <label>
                State
                <input name="state" defaultValue={org.state || ""} maxLength={40} />
              </label>
            </div>

            <div className="grid two-col">
              <label>
                ZIP
                <input name="zip" defaultValue={org.zip || ""} maxLength={20} />
              </label>
              <label>
                Phone
                <input name="phone" defaultValue={org.phone || ""} maxLength={40} />
              </label>
            </div>

            <div className="grid two-col">
              <label>
                Email
                <input name="email" defaultValue={org.email || ""} maxLength={120} />
              </label>
              <label>
                Website
                <input name="website" defaultValue={org.website || ""} maxLength={160} />
              </label>
            </div>

            <div className="grid two-col">
              <label>
                License #
                <input name="licenseNumber" defaultValue={org.licenseNumber || ""} maxLength={80} />
              </label>
              <label>
                EIN
                <input name="ein" defaultValue={org.ein || ""} maxLength={40} />
              </label>
            </div>

            <div className="grid two-col">
              <label>
                Invoice prefix
                <input name="invoicePrefix" defaultValue={org.invoicePrefix || "INV"} maxLength={8} placeholder="INV" />
                <small className="muted">Used for new invoices only (example: INV-2026-0001).</small>
              </label>
            </div>

            <label>
              Payment instructions (optional)
              <textarea
                name="invoicePaymentInstructions"
                rows={4}
                defaultValue={org.invoicePaymentInstructions || ""}
                maxLength={2000}
                placeholder="Example: Make checks payable to Velocity Landscapes LLC. Venmo: @velocity-landscapes."
              />
            </label>

            <button className="btn primary" type="submit">
              Save Branding
            </button>
          </form>

          <BrandingSaveStatus
            errorMessage={invoicePrefixError}
            saved={saved === "1"}
            successMessage="Branding saved."
          />
        </article>
      </div>
    </section>
  );
}
