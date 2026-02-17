import type { TwilioConfigStatus } from "@prisma/client";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { normalizeE164 } from "@/lib/phone";
import { requireInternalUser } from "@/lib/session";
import { sendOutboundSms } from "@/lib/sms";
import { decryptTwilioAuthToken, encryptTwilioAuthToken, maskSecretTail } from "@/lib/twilio-config-crypto";
import { validateTwilioOrgConfig } from "@/lib/twilio-org";

export const dynamic = "force-dynamic";

const STATUS_OPTIONS: Array<{ value: TwilioConfigStatus; label: string }> = [
  { value: "PENDING_A2P", label: "PENDING_A2P" },
  { value: "ACTIVE", label: "ACTIVE" },
  { value: "PAUSED", label: "PAUSED" },
];

function getString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseStatus(value: string): TwilioConfigStatus | null {
  if (value === "PENDING_A2P" || value === "ACTIVE" || value === "PAUSED") {
    return value;
  }
  return null;
}

function statusUrl(orgId: string, query: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }
  const suffix = params.toString();
  return `/hq/orgs/${orgId}/twilio${suffix ? `?${suffix}` : ""}`;
}

async function saveTwilioConfigAction(formData: FormData) {
  "use server";

  const orgId = getString(formData.get("orgId"));
  if (!orgId) redirect("/hq/businesses");

  const actor = await requireInternalUser(`/hq/orgs/${orgId}/twilio`);
  const twilioSubaccountSid = getString(formData.get("twilioSubaccountSid"));
  const messagingServiceSid = getString(formData.get("messagingServiceSid"));
  const authTokenRaw = getString(formData.get("twilioAuthToken"));
  const phoneNumberRaw = getString(formData.get("phoneNumber"));
  const status = parseStatus(getString(formData.get("status")));

  if (!twilioSubaccountSid.startsWith("AC")) {
    redirect(statusUrl(orgId, { error: "Subaccount SID must start with AC." }));
  }
  if (!messagingServiceSid.startsWith("MG")) {
    redirect(statusUrl(orgId, { error: "Messaging Service SID must start with MG." }));
  }
  if (!status) {
    redirect(statusUrl(orgId, { error: "Invalid Twilio status." }));
  }

  const phoneNumber = normalizeE164(phoneNumberRaw);
  if (!phoneNumber) {
    redirect(statusUrl(orgId, { error: "Phone number must be valid E.164." }));
  }

  const existing = await prisma.organizationTwilioConfig.findUnique({
    where: { organizationId: orgId },
    select: {
      id: true,
      status: true,
      twilioAuthTokenEncrypted: true,
    },
  });

  if (!existing && !authTokenRaw) {
    redirect(statusUrl(orgId, { error: "Auth token is required for first-time setup." }));
  }

  let tokenToEncrypt: string | null = null;
  if (authTokenRaw) {
    tokenToEncrypt = authTokenRaw;
  } else if (existing) {
    try {
      tokenToEncrypt = decryptTwilioAuthToken(existing.twilioAuthTokenEncrypted);
    } catch {
      redirect(statusUrl(orgId, { error: "Unable to decrypt existing token. Check TWILIO_TOKEN_ENCRYPTION_KEY." }));
    }
  }

  if (!tokenToEncrypt) {
    redirect(statusUrl(orgId, { error: "Auth token is missing." }));
  }

  let encryptedToken = "";
  try {
    encryptedToken = encryptTwilioAuthToken(tokenToEncrypt);
  } catch {
    redirect(statusUrl(orgId, { error: "Unable to encrypt token. Check TWILIO_TOKEN_ENCRYPTION_KEY." }));
  }

  const saved = await prisma.$transaction(async (tx) => {
    const config = await tx.organizationTwilioConfig.upsert({
      where: { organizationId: orgId },
      create: {
        organizationId: orgId,
        twilioSubaccountSid,
        twilioAuthTokenEncrypted: encryptedToken,
        messagingServiceSid,
        phoneNumber,
        status,
      },
      update: {
        twilioSubaccountSid,
        twilioAuthTokenEncrypted: encryptedToken,
        messagingServiceSid,
        phoneNumber,
        status,
      },
      select: {
        id: true,
        status: true,
      },
    });

    // Keep legacy sender field aligned while older flows are being migrated.
    await tx.organization.update({
      where: { id: orgId },
      data: { smsFromNumberE164: phoneNumber },
    });

    await tx.twilioConfigAuditLog.create({
      data: {
        organizationId: orgId,
        twilioConfigId: config.id,
        actorUserId: actor.id,
        action: existing ? "UPDATED" : "CREATED",
        previousStatus: existing?.status || null,
        nextStatus: status,
        metadataJson: {
          twilioSubaccountSid,
          messagingServiceSid,
          phoneNumber,
          tokenUpdated: Boolean(authTokenRaw),
        },
      },
    });

    if (existing && existing.status !== status) {
      await tx.twilioConfigAuditLog.create({
        data: {
          organizationId: orgId,
          twilioConfigId: config.id,
          actorUserId: actor.id,
          action: "STATUS_CHANGED",
          previousStatus: existing.status,
          nextStatus: status,
          metadataJson: {
            reason: "Changed from HQ Twilio settings",
          },
        },
      });
    }

    return config;
  });

  revalidatePath(`/hq/orgs/${orgId}/twilio`);
  revalidatePath(`/hq/businesses/${orgId}`);
  revalidatePath("/hq/businesses");
  revalidatePath("/app/settings");

  redirect(statusUrl(orgId, { saved: "1", status: saved.status }));
}

async function validateTwilioConfigAction(formData: FormData) {
  "use server";

  const orgId = getString(formData.get("orgId"));
  if (!orgId) redirect("/hq/businesses");

  const actor = await requireInternalUser(`/hq/orgs/${orgId}/twilio`);
  const twilioSubaccountSid = getString(formData.get("twilioSubaccountSid"));
  const messagingServiceSid = getString(formData.get("messagingServiceSid"));
  const authTokenRaw = getString(formData.get("twilioAuthToken"));
  const phoneNumberRaw = getString(formData.get("phoneNumber"));

  const existing = await prisma.organizationTwilioConfig.findUnique({
    where: { organizationId: orgId },
    select: {
      id: true,
      twilioSubaccountSid: true,
      twilioAuthTokenEncrypted: true,
      messagingServiceSid: true,
      phoneNumber: true,
    },
  });

  const subaccountSid = twilioSubaccountSid || existing?.twilioSubaccountSid || "";
  const messagingSid = messagingServiceSid || existing?.messagingServiceSid || "";
  const phoneNumber = phoneNumberRaw || existing?.phoneNumber || "";
  let authToken = authTokenRaw;
  if (!authToken && existing) {
    try {
      authToken = decryptTwilioAuthToken(existing.twilioAuthTokenEncrypted);
    } catch {
      redirect(statusUrl(orgId, { error: "Unable to decrypt saved token. Check TWILIO_TOKEN_ENCRYPTION_KEY." }));
    }
  }

  if (!subaccountSid || !messagingSid || !phoneNumber || !authToken) {
    redirect(statusUrl(orgId, { error: "Provide Twilio fields (or save config) before validation." }));
  }

  const validation = await validateTwilioOrgConfig({
    twilioSubaccountSid: subaccountSid,
    twilioAuthToken: authToken,
    messagingServiceSid: messagingSid,
    phoneNumber,
  });

  await prisma.twilioConfigAuditLog.create({
    data: {
      organizationId: orgId,
      twilioConfigId: existing?.id || null,
      actorUserId: actor.id,
      action: "VALIDATED",
      metadataJson: validation.ok
        ? {
            ok: true,
            twilioSubaccountSid: subaccountSid,
            messagingServiceSid: messagingSid,
            normalizedPhoneNumber: validation.normalizedPhoneNumber,
            serviceFriendlyName: validation.serviceFriendlyName,
          }
        : {
            ok: false,
            twilioSubaccountSid: subaccountSid,
            messagingServiceSid: messagingSid,
            error: validation.error,
          },
    },
  });

  if (!validation.ok) {
    redirect(statusUrl(orgId, { error: validation.error }));
  }

  redirect(statusUrl(orgId, { validated: "1" }));
}

async function sendTestSmsAction(formData: FormData) {
  "use server";

  const orgId = getString(formData.get("orgId"));
  if (!orgId) redirect("/hq/businesses");

  const actor = await requireInternalUser(`/hq/orgs/${orgId}/twilio`);
  const destinationRaw = getString(formData.get("testToNumber"));
  const body = getString(formData.get("testBody")) || "TieGui test SMS: Twilio org routing is active.";
  const destination = normalizeE164(destinationRaw);
  if (!destination) {
    redirect(statusUrl(orgId, { error: "Test destination must be valid E.164." }));
  }

  const result = await sendOutboundSms({
    orgId,
    toNumberE164: destination,
    body,
    allowPendingA2P: true,
  });

  const config = await prisma.organizationTwilioConfig.findUnique({
    where: { organizationId: orgId },
    select: { id: true },
  });

  await prisma.twilioConfigAuditLog.create({
    data: {
      organizationId: orgId,
      twilioConfigId: config?.id || null,
      actorUserId: actor.id,
      action: "TEST_SMS_SENT",
      metadataJson: {
        toNumberE164: destination,
        status: result.status,
        providerMessageSid: result.providerMessageSid,
        notice: result.notice || null,
      },
    },
  });

  if (result.status === "FAILED") {
    redirect(statusUrl(orgId, { error: result.notice || "Test SMS failed." }));
  }

  redirect(statusUrl(orgId, { tested: "1", notice: result.notice || "sent" }));
}

export default async function HqOrgTwilioPage({
  params,
  searchParams,
}: {
  params: { orgId: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireInternalUser(`/hq/orgs/${params.orgId}/twilio`);

  const organization = await prisma.organization.findUnique({
    where: { id: params.orgId },
    select: {
      id: true,
      name: true,
      twilioConfig: {
        select: {
          id: true,
          twilioSubaccountSid: true,
          twilioAuthTokenEncrypted: true,
          messagingServiceSid: true,
          phoneNumber: true,
          status: true,
          updatedAt: true,
        },
      },
      twilioConfigAuditLogs: {
        orderBy: { createdAt: "desc" },
        take: 12,
        select: {
          id: true,
          action: true,
          previousStatus: true,
          nextStatus: true,
          metadataJson: true,
          createdAt: true,
          actorUser: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      },
    },
  });

  if (!organization) notFound();

  const error = getString((searchParams?.error as string) || null);
  const saved = getString((searchParams?.saved as string) || null) === "1";
  const validated = getString((searchParams?.validated as string) || null) === "1";
  const tested = getString((searchParams?.tested as string) || null) === "1";
  const notice = getString((searchParams?.notice as string) || null);

  let maskedToken = "";
  if (organization.twilioConfig?.twilioAuthTokenEncrypted) {
    try {
      maskedToken = maskSecretTail(decryptTwilioAuthToken(organization.twilioConfig.twilioAuthTokenEncrypted), 4);
    } catch {
      maskedToken = "(unavailable)";
    }
  }

  return (
    <>
      <section className="card">
        <Link href={`/hq/businesses/${organization.id}`} className="table-link">
          ← Back to Business Folder
        </Link>
        <h2 style={{ marginTop: 10 }}>Twilio Config · {organization.name}</h2>
        <p className="muted">Per-org subaccount setup for inbound routing, outbound messaging, and test sends.</p>

        {error ? <p className="form-error">{error}</p> : null}
        {saved ? <p className="form-status">Twilio config saved.</p> : null}
        {validated ? <p className="form-status">Twilio validation passed.</p> : null}
        {tested ? <p className="form-status">Test SMS sent {notice ? `(${notice})` : ""}.</p> : null}
      </section>

      <section className="card">
        <h3>Organization Twilio Credentials</h3>
        <form action={saveTwilioConfigAction} className="stack" style={{ marginTop: 12 }}>
          <input type="hidden" name="orgId" value={organization.id} />
          <div className="form-grid">
            <label>
              Twilio Subaccount SID
              <input
                name="twilioSubaccountSid"
                defaultValue={organization.twilioConfig?.twilioSubaccountSid || ""}
                placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                required
              />
            </label>
            <label>
              Messaging Service SID
              <input
                name="messagingServiceSid"
                defaultValue={organization.twilioConfig?.messagingServiceSid || ""}
                placeholder="MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                required
              />
            </label>
            <label>
              Phone Number (E.164)
              <input
                name="phoneNumber"
                defaultValue={organization.twilioConfig?.phoneNumber || ""}
                placeholder="+12065550100"
                required
              />
            </label>
            <label>
              Status
              <select name="status" defaultValue={organization.twilioConfig?.status || "PENDING_A2P"}>
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              Auth Token
              <input
                name="twilioAuthToken"
                type="password"
                autoComplete="new-password"
                placeholder={maskedToken ? `Leave blank to keep token (${maskedToken})` : "Enter auth token"}
              />
            </label>
          </div>

          <div className="quick-links">
            <button type="submit" className="btn primary">
              Save Config
            </button>
            <button type="submit" formAction={validateTwilioConfigAction} className="btn secondary">
              Validate
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h3>Send Test SMS</h3>
        <p className="muted">
          Uses this organization&apos;s Twilio subaccount + Messaging Service credentials. Works in ACTIVE or
          PENDING_A2P mode.
        </p>
        <form action={sendTestSmsAction} className="stack" style={{ marginTop: 12 }}>
          <input type="hidden" name="orgId" value={organization.id} />
          <div className="form-grid">
            <label>
              Destination phone (E.164)
              <input name="testToNumber" placeholder="+12065550199" required />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              Message body
              <textarea
                name="testBody"
                defaultValue="TieGui test SMS: Twilio org routing is active."
                maxLength={500}
                rows={3}
              />
            </label>
          </div>
          <div className="quick-links">
            <button type="submit" className="btn secondary">
              Send Test SMS
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h3>Audit Trail</h3>
        {organization.twilioConfigAuditLogs.length === 0 ? (
          <p className="muted">No Twilio config changes logged yet.</p>
        ) : (
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Status</th>
                  <th>Actor</th>
                </tr>
              </thead>
              <tbody>
                {organization.twilioConfigAuditLogs.map((entry) => (
                  <tr key={entry.id}>
                    <td>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(entry.createdAt)}</td>
                    <td>{entry.action}</td>
                    <td>
                      {entry.previousStatus || "-"} → {entry.nextStatus || "-"}
                    </td>
                    <td>{entry.actorUser?.name || entry.actorUser?.email || "System"}</td>
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
