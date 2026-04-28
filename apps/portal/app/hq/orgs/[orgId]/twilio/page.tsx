import type { TwilioConfigStatus } from "@prisma/client";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { formatDateTimeForDisplay } from "@/lib/calendar/dates";
import { normalizeEnvValue } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { normalizeE164 } from "@/lib/phone";
import { requireInternalUser } from "@/lib/session";
import { sendOutboundSms } from "@/lib/sms";
import {
  decryptTwilioAuthToken,
  encryptTwilioAuthToken,
  maskSid,
  maskSecretTail,
} from "@/lib/twilio-config-crypto";
import { validateTwilioOrgConfig } from "@/lib/twilio-org";

export const dynamic = "force-dynamic";

const STATUS_OPTIONS: Array<{ value: TwilioConfigStatus; label: string }> = [
  { value: "PENDING_A2P", label: "PENDING_A2P" },
  { value: "ACTIVE", label: "ACTIVE" },
  { value: "PAUSED", label: "PAUSED" },
];

const APP_BASE_URL = "https://app.tieguisolutions.com";
const TWILIO_WEBHOOKS = [
  {
    label: "Inbound SMS",
    method: "POST",
    url: `${APP_BASE_URL}/api/webhooks/twilio/sms`,
  },
  {
    label: "Outbound SMS status callback",
    method: "POST",
    url: `${APP_BASE_URL}/api/webhooks/twilio/sms/status`,
  },
  {
    label: "Voice incoming call",
    method: "POST",
    url: `${APP_BASE_URL}/api/webhooks/twilio/voice`,
  },
  {
    label: "Voice after-call callback",
    method: "POST",
    url: `${APP_BASE_URL}/api/webhooks/twilio/after-call`,
  },
] as const;

function getString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function boolEnv(key: string): boolean {
  return Boolean(normalizeEnvValue(process.env[key]));
}

function enabledEnv(key: string): boolean {
  return normalizeEnvValue(process.env[key]) === "true";
}

function maskPhone(value: string | null | undefined): string {
  const normalized = (value || "").trim();
  const digits = normalized.replace(/\D/g, "");
  if (digits.length < 4) return normalized || "-";
  return `${normalized.startsWith("+") ? "+" : ""}***${digits.slice(-4)}`;
}

function previewText(value: string | null | undefined, maxLength = 90): string {
  const trimmed = (value || "").replace(/\s+/g, " ").trim();
  if (!trimmed) return "-";
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}…` : trimmed;
}

function displayText(value: string | number | boolean | Date | null | undefined): string {
  if (value instanceof Date) {
    return formatDateTimeForDisplay(value, { dateStyle: "medium", timeStyle: "short" });
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return Number.isFinite(value) ? `${value}` : "-";
  const text = String(value || "").trim();
  return text || "-";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function metadataString(metadataJson: unknown, keys: string[]): string | null {
  const metadata = asRecord(metadataJson);
  if (!metadata) return null;
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return `${value}`;
    }
  }
  return null;
}

function formatStatusBadge(value: string, ok: boolean) {
  return (
    <span className={`badge ${ok ? "status-success" : "status-overdue"}`}>
      {value}
    </span>
  );
}

function getFailureReason(input: {
  providerMessageSid: string | null;
  communicationEvents: Array<{
    providerStatus: string | null;
    metadataJson: unknown;
  }>;
}): string {
  for (const event of input.communicationEvents) {
    const reason = metadataString(event.metadataJson, [
      "failureReason",
      "failureLabel",
      "deliveryNotice",
      "providerErrorMessage",
      "providerErrorCode",
      "dispatchFailureReason",
      "errorMessage",
      "error",
    ]);
    if (reason) return reason;
    if (event.providerStatus) return event.providerStatus;
  }

  return input.providerMessageSid
    ? "Provider accepted the message, then reported failure."
    : "Failed before Twilio accepted the message.";
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
  const voiceForwardingNumberRaw = getString(
    formData.get("voiceForwardingNumber"),
  );
  const status = parseStatus(getString(formData.get("status")));

  if (!twilioSubaccountSid.startsWith("AC")) {
    redirect(statusUrl(orgId, { error: "Account SID must start with AC." }));
  }
  if (!messagingServiceSid.startsWith("MG")) {
    redirect(
      statusUrl(orgId, { error: "Messaging Service SID must start with MG." }),
    );
  }
  if (!status) {
    redirect(statusUrl(orgId, { error: "Invalid Twilio status." }));
  }

  const phoneNumber = normalizeE164(phoneNumberRaw);
  if (!phoneNumber) {
    redirect(statusUrl(orgId, { error: "Phone number must be valid E.164." }));
  }

  const voiceForwardingNumber = voiceForwardingNumberRaw
    ? normalizeE164(voiceForwardingNumberRaw)
    : null;
  if (voiceForwardingNumberRaw && !voiceForwardingNumber) {
    redirect(
      statusUrl(orgId, { error: "Forwarding number must be valid E.164." }),
    );
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
    redirect(
      statusUrl(orgId, {
        error: "Auth token is required for first-time setup.",
      }),
    );
  }

  let tokenToEncrypt: string | null = null;
  if (authTokenRaw) {
    tokenToEncrypt = authTokenRaw;
  } else if (existing) {
    try {
      tokenToEncrypt = decryptTwilioAuthToken(
        existing.twilioAuthTokenEncrypted,
      );
    } catch {
      redirect(
        statusUrl(orgId, {
          error:
            "Unable to decrypt existing token. Check TWILIO_TOKEN_ENCRYPTION_KEY.",
        }),
      );
    }
  }

  if (!tokenToEncrypt) {
    redirect(statusUrl(orgId, { error: "Auth token is missing." }));
  }

  let encryptedToken = "";
  try {
    encryptedToken = encryptTwilioAuthToken(tokenToEncrypt);
  } catch {
    redirect(
      statusUrl(orgId, {
        error: "Unable to encrypt token. Check TWILIO_TOKEN_ENCRYPTION_KEY.",
      }),
    );
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
        voiceForwardingNumber,
        status,
      },
      update: {
        twilioSubaccountSid,
        twilioAuthTokenEncrypted: encryptedToken,
        messagingServiceSid,
        phoneNumber,
        voiceForwardingNumber,
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
          voiceForwardingNumber,
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

  const subaccountSid =
    twilioSubaccountSid || existing?.twilioSubaccountSid || "";
  const messagingSid =
    messagingServiceSid || existing?.messagingServiceSid || "";
  const phoneNumber = phoneNumberRaw || existing?.phoneNumber || "";
  let authToken = authTokenRaw;
  if (!authToken && existing) {
    try {
      authToken = decryptTwilioAuthToken(existing.twilioAuthTokenEncrypted);
    } catch {
      redirect(
        statusUrl(orgId, {
          error:
            "Unable to decrypt saved token. Check TWILIO_TOKEN_ENCRYPTION_KEY.",
        }),
      );
    }
  }

  if (!subaccountSid || !messagingSid || !phoneNumber || !authToken) {
    redirect(
      statusUrl(orgId, {
        error: "Provide Twilio fields (or save config) before validation.",
      }),
    );
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
  const body =
    getString(formData.get("testBody")) ||
    "TieGui test SMS: Twilio org routing is active.";
  const destination = normalizeE164(destinationRaw);
  if (!destination) {
    redirect(
      statusUrl(orgId, { error: "Test destination must be valid E.164." }),
    );
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

export default async function HqOrgTwilioPage(
  props: {
    params: Promise<{ orgId: string }>;
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
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
          voiceForwardingNumber: true,
          status: true,
          updatedAt: true,
        },
      },
      smsRegistrationApplication: true,
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
  const validated =
    getString((searchParams?.validated as string) || null) === "1";
  const tested = getString((searchParams?.tested as string) || null) === "1";
  const notice = getString((searchParams?.notice as string) || null);

  let maskedToken = "";
  if (organization.twilioConfig?.twilioAuthTokenEncrypted) {
    try {
      maskedToken = maskSecretTail(
        decryptTwilioAuthToken(
          organization.twilioConfig.twilioAuthTokenEncrypted,
        ),
        4,
      );
    } catch {
      maskedToken = "(unavailable)";
    }
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [
    messageCounts,
    latestInboundSms,
    latestOutboundSms,
    latestStatusCallback,
    latestVoiceCall,
    recentFailedSms,
    recentUnmatchedStatusCallbacks,
  ] = await Promise.all([
    prisma.message.groupBy({
      by: ["direction", "status"],
      where: {
        orgId: organization.id,
        createdAt: { gte: thirtyDaysAgo },
      },
      _count: { status: true },
    }),
    prisma.message.findFirst({
      where: {
        orgId: organization.id,
        direction: "INBOUND",
      },
      orderBy: { createdAt: "desc" },
      select: {
        createdAt: true,
        fromNumberE164: true,
        body: true,
        status: true,
      },
    }),
    prisma.message.findFirst({
      where: {
        orgId: organization.id,
        direction: "OUTBOUND",
      },
      orderBy: { createdAt: "desc" },
      select: {
        createdAt: true,
        toNumberE164: true,
        body: true,
        status: true,
        type: true,
      },
    }),
    prisma.communicationEvent.findFirst({
      where: {
        orgId: organization.id,
        channel: "SMS",
        type: "OUTBOUND_SMS_SENT",
        providerMessageSid: { not: null },
        providerStatus: {
          in: ["queued", "sent", "delivered", "undelivered", "failed"],
        },
      },
      orderBy: { createdAt: "desc" },
      select: {
        createdAt: true,
        providerStatus: true,
        providerMessageSid: true,
        metadataJson: true,
      },
    }),
    prisma.call.findFirst({
      where: { orgId: organization.id },
      orderBy: { startedAt: "desc" },
      select: {
        startedAt: true,
        status: true,
        fromNumberE164: true,
        toNumberE164: true,
        twilioCallSid: true,
      },
    }),
    prisma.message.findMany({
      where: {
        orgId: organization.id,
        direction: "OUTBOUND",
        status: "FAILED",
        createdAt: { gte: thirtyDaysAgo },
      },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        createdAt: true,
        type: true,
        toNumberE164: true,
        body: true,
        providerMessageSid: true,
        lead: {
          select: {
            id: true,
            contactName: true,
            businessName: true,
            status: true,
          },
        },
        communicationEvents: {
          orderBy: { createdAt: "desc" },
          take: 3,
          select: {
            providerStatus: true,
            metadataJson: true,
          },
        },
      },
    }),
    prisma.communicationEvent.findMany({
      where: {
        orgId: organization.id,
        channel: "SMS",
        type: "OUTBOUND_SMS_SENT",
        summary: "Unmatched outbound SMS status callback",
        providerMessageSid: { not: null },
        createdAt: { gte: thirtyDaysAgo },
      },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        createdAt: true,
        providerStatus: true,
        providerMessageSid: true,
        metadataJson: true,
      },
    }),
  ]);

  const countMessages = (direction: "INBOUND" | "OUTBOUND", status?: string) =>
    messageCounts
      .filter((item) => item.direction === direction && (!status || item.status === status))
      .reduce((sum, item) => sum + item._count.status, 0);
  const outbound30d = countMessages("OUTBOUND");
  const inbound30d = countMessages("INBOUND");
  const failed30d = countMessages("OUTBOUND", "FAILED");
  const delivered30d = countMessages("OUTBOUND", "DELIVERED");
  const sent30d = countMessages("OUTBOUND", "SENT");
  const envSnapshot = {
    tokenEncryptionKeyPresent: boolEnv("TWILIO_TOKEN_ENCRYPTION_KEY"),
    sendEnabled: enabledEnv("TWILIO_SEND_ENABLED"),
    validateSignature: enabledEnv("TWILIO_VALIDATE_SIGNATURE"),
    voiceAfterCallOverridePresent: boolEnv("TWILIO_VOICE_AFTER_CALL_URL"),
  };
  const readinessRows = [
    {
      label: "Config saved",
      ok: Boolean(organization.twilioConfig),
      detail: organization.twilioConfig
        ? `${maskSid(organization.twilioConfig.twilioSubaccountSid)} / ${maskSid(organization.twilioConfig.messagingServiceSid)}`
        : "No org Twilio config yet",
    },
    {
      label: "Status active",
      ok: organization.twilioConfig?.status === "ACTIVE",
      detail: organization.twilioConfig?.status || "Not configured",
    },
    {
      label: "Token encryption key",
      ok: envSnapshot.tokenEncryptionKeyPresent,
      detail: envSnapshot.tokenEncryptionKeyPresent ? "Present in deployment" : "Missing in this runtime",
    },
    {
      label: "Live send flag",
      ok: envSnapshot.sendEnabled,
      detail: envSnapshot.sendEnabled ? "TWILIO_SEND_ENABLED=true" : "Queue-only or disabled here",
    },
    {
      label: "Webhook signature validation",
      ok: envSnapshot.validateSignature,
      detail: envSnapshot.validateSignature ? "TWILIO_VALIDATE_SIGNATURE=true" : "Signature validation disabled here",
    },
    {
      label: "Inbound webhook seen",
      ok: Boolean(latestInboundSms),
      detail: latestInboundSms
        ? formatDateTimeForDisplay(latestInboundSms.createdAt, { dateStyle: "medium", timeStyle: "short" })
        : "No inbound SMS recorded yet",
    },
    {
      label: "Status callback seen",
      ok: Boolean(latestStatusCallback),
      detail: latestStatusCallback
        ? `${latestStatusCallback.providerStatus || "status"} · ${formatDateTimeForDisplay(latestStatusCallback.createdAt, {
            dateStyle: "medium",
            timeStyle: "short",
          })}`
        : "No Twilio status callback recorded yet",
    },
    {
      label: "Unmatched status callbacks",
      ok: recentUnmatchedStatusCallbacks.length === 0,
      detail:
        recentUnmatchedStatusCallbacks.length === 0
          ? "None recorded in the last 30 days"
          : `${recentUnmatchedStatusCallbacks.length} recent callback(s) need investigation`,
    },
    {
      label: "Voice activity seen",
      ok: Boolean(latestVoiceCall),
      detail: latestVoiceCall
        ? `${latestVoiceCall.status} · ${formatDateTimeForDisplay(latestVoiceCall.startedAt, {
            dateStyle: "medium",
            timeStyle: "short",
          })}`
        : "No voice call recorded yet",
    },
  ];
  const smsRegistration = organization.smsRegistrationApplication;
  const smsRegistrationBusinessRows = smsRegistration
    ? [
        ["Status", smsRegistration.status],
        ["Submitted", smsRegistration.submittedAt],
        ["Legal business name", smsRegistration.businessName],
        ["Brand / DBA", smsRegistration.brandName],
        ["Business type", smsRegistration.businessType],
        ["Industry", smsRegistration.businessIndustry],
        ["EIN status", smsRegistration.businessRegistrationIdentifier],
        ["Company type", smsRegistration.companyType],
        ["Website", smsRegistration.websiteUrl],
        ["Social links", smsRegistration.socialMediaProfileUrls],
        ["Address name", smsRegistration.customerName],
        ["Street", smsRegistration.street],
        ["Street 2", smsRegistration.streetSecondary],
        ["City", smsRegistration.city],
        ["State/region", smsRegistration.region],
        ["Postal code", smsRegistration.postalCode],
        ["Country", smsRegistration.isoCountry],
      ] as const
    : [];
  const smsRegistrationContactRows = smsRegistration
    ? [
        ["Authorized first name", smsRegistration.authorizedFirstName],
        ["Authorized last name", smsRegistration.authorizedLastName],
        ["Job title", smsRegistration.authorizedTitle],
        ["Job position", smsRegistration.authorizedJobPosition],
        ["Phone", smsRegistration.authorizedPhoneE164],
        ["Email", smsRegistration.authorizedEmail],
        ["Brand contact email", smsRegistration.brandContactEmail],
      ] as const
    : [];
  const smsRegistrationCampaignRows = smsRegistration
    ? [
        ["Use case", smsRegistration.campaignUseCase],
        ["Campaign description", smsRegistration.campaignDescription],
        ["Opt-in flow", smsRegistration.messageFlow],
        ["Privacy policy", smsRegistration.privacyPolicyUrl],
        ["Terms", smsRegistration.termsOfServiceUrl],
        ["Opt-in proof", smsRegistration.optInProofUrl],
        ["Includes links", smsRegistration.hasEmbeddedLinks],
        ["Includes phone numbers", smsRegistration.hasEmbeddedPhone],
        ["Opt-in keywords", smsRegistration.optInKeywords],
        ["Opt-in reply", smsRegistration.optInMessage],
        ["Opt-out keywords", smsRegistration.optOutKeywords],
        ["Opt-out reply", smsRegistration.optOutMessage],
        ["Help keywords", smsRegistration.helpKeywords],
        ["Help reply", smsRegistration.helpMessage],
        ["Estimated monthly texts", smsRegistration.estimatedMonthlyMessages],
        ["Existing Twilio number", smsRegistration.desiredSenderNumberE164],
        ["Customer consent confirmed", smsRegistration.customerConsentConfirmed],
        ["Submission authorized", smsRegistration.registrationSubmissionAuthorized],
      ] as const
    : [];
  const smsRegistrationSamples = smsRegistration
    ? [
        smsRegistration.sampleMessage1,
        smsRegistration.sampleMessage2,
        smsRegistration.sampleMessage3,
        smsRegistration.sampleMessage4,
        smsRegistration.sampleMessage5,
      ].filter((sample): sample is string => Boolean(sample))
    : [];

  return (
    <>
      <section className="card">
        <Link href={`/hq/businesses/${organization.id}`} className="table-link">
          ← Back to Business Folder
        </Link>
        <h2 style={{ marginTop: 10 }}>Twilio Config · {organization.name}</h2>
        <p className="muted">
          Per-org Twilio account setup for inbound routing, outbound messaging,
          and test sends.
        </p>

        {error ? <p className="form-error">{error}</p> : null}
        {saved ? <p className="form-status">Twilio config saved.</p> : null}
        {validated ? (
          <p className="form-status">Twilio validation passed.</p>
        ) : null}
        {tested ? (
          <p className="form-status">
            Test SMS sent {notice ? `(${notice})` : ""}.
          </p>
        ) : null}
      </section>

      <section className="card">
        <h3>Internal Twilio Launch Readiness</h3>
        <p className="muted">
          Admin-operated setup for this business. Customers should only see
          live, pending, paused, or setup-needed states.
        </p>
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Check</th>
                <th>Status</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {readinessRows.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td>{formatStatusBadge(row.ok ? "Ready" : "Needs attention", row.ok)}</td>
                  <td>{row.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h3>Traffic Health</h3>
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Window</th>
                <th>Inbound</th>
                <th>Outbound</th>
                <th>Sent</th>
                <th>Delivered</th>
                <th>Failed</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Last 30 days</td>
                <td>{inbound30d}</td>
                <td>{outbound30d}</td>
                <td>{sent30d}</td>
                <td>{delivered30d}</td>
                <td>{formatStatusBadge(`${failed30d}`, failed30d === 0)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Signal</th>
                <th>Latest</th>
                <th>Context</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Inbound SMS</td>
                <td>
                  {latestInboundSms
                    ? formatDateTimeForDisplay(latestInboundSms.createdAt, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })
                    : "-"}
                </td>
                <td>
                  {latestInboundSms
                    ? `${maskPhone(latestInboundSms.fromNumberE164)} · ${previewText(latestInboundSms.body)}`
                    : "No inbound SMS recorded."}
                </td>
              </tr>
              <tr>
                <td>Outbound SMS</td>
                <td>
                  {latestOutboundSms
                    ? formatDateTimeForDisplay(latestOutboundSms.createdAt, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })
                    : "-"}
                </td>
                <td>
                  {latestOutboundSms
                    ? `${latestOutboundSms.type} / ${latestOutboundSms.status || "UNKNOWN"} to ${maskPhone(
                        latestOutboundSms.toNumberE164,
                      )} · ${previewText(latestOutboundSms.body)}`
                    : "No outbound SMS recorded."}
                </td>
              </tr>
              <tr>
                <td>Status callback</td>
                <td>
                  {latestStatusCallback
                    ? formatDateTimeForDisplay(latestStatusCallback.createdAt, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })
                    : "-"}
                </td>
                <td>
                  {latestStatusCallback
                    ? `${latestStatusCallback.providerStatus || "unknown"} · ${maskSid(
                        latestStatusCallback.providerMessageSid,
                      )}`
                    : "No outbound status callback recorded."}
                </td>
              </tr>
              <tr>
                <td>Voice call</td>
                <td>
                  {latestVoiceCall
                    ? formatDateTimeForDisplay(latestVoiceCall.startedAt, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })
                    : "-"}
                </td>
                <td>
                  {latestVoiceCall
                    ? `${latestVoiceCall.status} · ${maskPhone(latestVoiceCall.fromNumberE164)} → ${maskPhone(
                        latestVoiceCall.toNumberE164,
                      )}`
                    : "No voice call recorded."}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h3>Twilio Webhooks</h3>
        <p className="muted">
          Paste these URLs into the Twilio phone number or Messaging Service
          settings for this business.
        </p>
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Use</th>
                <th>Method</th>
                <th>URL</th>
              </tr>
            </thead>
            <tbody>
              {TWILIO_WEBHOOKS.map((webhook) => (
                <tr key={webhook.url}>
                  <td>{webhook.label}</td>
                  <td>
                    <code>{webhook.method}</code>
                  </td>
                  <td>
                    <code>{webhook.url}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {envSnapshot.voiceAfterCallOverridePresent ? (
          <p className="form-status" style={{ marginTop: 10 }}>
            Voice after-call override is configured in this runtime.
          </p>
        ) : null}
      </section>

      <section className="card">
        <h3>Unmatched Status Callbacks</h3>
        {recentUnmatchedStatusCallbacks.length === 0 ? (
          <p className="muted">No unmatched Twilio status callbacks in the last 30 days.</p>
        ) : (
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Status</th>
                  <th>Message SID</th>
                  <th>Reason</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {recentUnmatchedStatusCallbacks.map((callback) => (
                  <tr key={callback.id}>
                    <td>
                      {formatDateTimeForDisplay(callback.createdAt, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </td>
                    <td>{callback.providerStatus || "unknown"}</td>
                    <td>{maskSid(callback.providerMessageSid)}</td>
                    <td>
                      {metadataString(callback.metadataJson, [
                        "failureReason",
                        "failureLabel",
                        "providerErrorMessage",
                        "providerErrorCode",
                      ]) || "No provider error detail."}
                    </td>
                    <td>
                      {metadataString(callback.metadataJson, [
                        "failureOperatorActionLabel",
                        "failureOperatorDetail",
                      ]) || "Review manually"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h3>Recent Failed SMS</h3>
        {recentFailedSms.length === 0 ? (
          <p className="muted">No outbound SMS failures in the last 30 days.</p>
        ) : (
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Type</th>
                  <th>Lead</th>
                  <th>Reason</th>
                  <th>Action</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {recentFailedSms.map((message) => {
                  const leadLabel =
                    message.lead.contactName ||
                    message.lead.businessName ||
                    maskPhone(message.toNumberE164);
                  return (
                    <tr key={message.id}>
                      <td>
                        {formatDateTimeForDisplay(message.createdAt, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </td>
                      <td>{message.type}</td>
                      <td>
                        <Link
                          className="table-link"
                          href={`/hq/leads/${message.lead.id}`}
                        >
                          {leadLabel}
                        </Link>
                      </td>
                      <td>
                        {getFailureReason({
                          providerMessageSid: message.providerMessageSid,
                          communicationEvents: message.communicationEvents,
                        })}
                      </td>
                      <td>
                        {message.communicationEvents
                          .map((event) =>
                            metadataString(event.metadataJson, [
                              "failureOperatorActionLabel",
                              "failureOperatorDetail",
                            ]),
                          )
                          .find(Boolean) || "Review manually"}
                      </td>
                      <td>{previewText(message.body, 72)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h3>Customer SMS Registration Intake</h3>
        <p className="muted">
          Customer-submitted A2P/Twilio application answers. If the customer deletes the intake from onboarding, this section clears.
        </p>
        {!smsRegistration ? (
          <p className="muted" style={{ marginTop: 10 }}>
            No texting approval application has been saved yet.
          </p>
        ) : (
          <>
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Business field</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {smsRegistrationBusinessRows.map(([label, value]) => (
                    <tr key={label}>
                      <td>{label}</td>
                      <td>{displayText(value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="table-wrap" style={{ marginTop: 16 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Contact field</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {smsRegistrationContactRows.map(([label, value]) => (
                    <tr key={label}>
                      <td>{label}</td>
                      <td>{displayText(value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="table-wrap" style={{ marginTop: 16 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Campaign field</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {smsRegistrationCampaignRows.map(([label, value]) => (
                    <tr key={label}>
                      <td>{label}</td>
                      <td>{displayText(value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="table-wrap" style={{ marginTop: 16 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Sample</th>
                    <th>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {smsRegistrationSamples.map((sample, index) => (
                    <tr key={`${index}-${sample.slice(0, 16)}`}>
                      <td>Sample {index + 1}</td>
                      <td>{sample}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="card">
        <h3>Organization Twilio Credentials</h3>
        <form
          action={saveTwilioConfigAction}
          className="stack"
          style={{ marginTop: 12 }}
        >
          <input type="hidden" name="orgId" value={organization.id} />
          <div className="form-grid">
            <label>
              Twilio Account SID
              <input
                name="twilioSubaccountSid"
                defaultValue={
                  organization.twilioConfig?.twilioSubaccountSid || ""
                }
                placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                required
              />
            </label>
            <label>
              Messaging Service SID
              <input
                name="messagingServiceSid"
                defaultValue={
                  organization.twilioConfig?.messagingServiceSid || ""
                }
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
              Voice Forwarding Number (E.164)
              <input
                name="voiceForwardingNumber"
                defaultValue={
                  organization.twilioConfig?.voiceForwardingNumber || ""
                }
                placeholder="+12065550199"
              />
            </label>
            <label>
              Status
              <select
                name="status"
                defaultValue={
                  organization.twilioConfig?.status || "PENDING_A2P"
                }
              >
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
                placeholder={
                  maskedToken
                    ? `Leave blank to keep token (${maskedToken})`
                    : "Enter auth token"
                }
              />
            </label>
          </div>

          <p className="muted" style={{ marginTop: 0 }}>
            Use the Twilio account SID, auth token, messaging service SID, and
            phone number that all belong to the same Twilio account. Calls to
            the Twilio line ring this number first. Leave it blank to fall back
            to the first owner or admin phone on file. That same destination is
            also used for internal schedule alerts and pre-visit reminders.
          </p>

          <div className="quick-links">
            <button type="submit" className="btn primary">
              Save Config
            </button>
            <button
              type="submit"
              formAction={validateTwilioConfigAction}
              className="btn secondary"
            >
              Validate
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h3>Send Test SMS</h3>
        <p className="muted">
          Uses this organization&apos;s Twilio account + Messaging Service
          credentials. Works in ACTIVE or PENDING_A2P mode.
        </p>
        <form
          action={sendTestSmsAction}
          className="stack"
          style={{ marginTop: 12 }}
        >
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
                    <td>
                      {formatDateTimeForDisplay(entry.createdAt, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </td>
                    <td>{entry.action}</td>
                    <td>
                      {entry.previousStatus || "-"} → {entry.nextStatus || "-"}
                    </td>
                    <td>
                      {entry.actorUser?.name ||
                        entry.actorUser?.email ||
                        "System"}
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
