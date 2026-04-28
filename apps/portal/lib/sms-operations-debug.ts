const UNMATCHED_STATUS_CALLBACK_SUMMARY =
  "Unmatched outbound SMS status callback";
const RECOVERED_STATUS_CALLBACK_SUMMARY =
  "Recovered outbound SMS status callback";
const DEFAULT_PREVIEW_LENGTH = 90;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

type SmsMetadataRecord = Record<string, unknown>;

export type SmsFailureMetadata = {
  category: string | null;
  label: string | null;
  operatorAction: string | null;
  operatorActionLabel: string | null;
  operatorDetail: string | null;
  retryRecommended: boolean | null;
  blocksAutomationRetry: boolean | null;
  reason: string | null;
  providerErrorCode: string | null;
  providerErrorMessage: string | null;
};

export type LeadSmsDebugLeadInput = {
  id: string;
  orgId: string;
  orgName: string;
  contactName: string | null;
  businessName: string | null;
  phoneE164: string;
  status: string;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
};

export type LeadSmsDebugMessageInput = {
  id: string;
  direction: string;
  type: string;
  status: string | null;
  fromNumberE164: string;
  toNumberE164: string;
  body: string;
  providerMessageSid: string | null;
  createdAt: Date;
};

export type LeadSmsDebugEventInput = {
  id: string;
  type: string;
  channel: string;
  summary: string;
  providerStatus: string | null;
  providerMessageSid: string | null;
  occurredAt: Date;
  createdAt?: Date | null;
  metadataJson: unknown;
  messageId?: string | null;
};

export type LeadSmsDebugReceiptInput = {
  id: string;
  route: string;
  idempotencyKey: string;
  createdAt: Date;
  updatedAt?: Date | null;
  responseJson: unknown;
};

export type LeadSmsDebugConsentInput = {
  id?: string | null;
  status: "OPTED_IN" | "OPTED_OUT" | "UNKNOWN";
  source: string | null;
  lastKeyword: string | null;
  lastUpdatedAt: Date | null;
};

export type LeadSmsDebugBundleInput = {
  lead: LeadSmsDebugLeadInput;
  smsConsent?: LeadSmsDebugConsentInput | null;
  messages: LeadSmsDebugMessageInput[];
  communicationEvents: LeadSmsDebugEventInput[];
  receipts: LeadSmsDebugReceiptInput[];
  callbackEvents: LeadSmsDebugEventInput[];
};

export type LeadSmsDebugBundle = ReturnType<typeof buildLeadSmsDebugBundle>;

export type SmsWebhookMonitorEventInput = {
  type: string;
  channel: string;
  summary: string;
  providerStatus: string | null;
  providerMessageSid: string | null;
  occurredAt: Date;
  createdAt: Date;
  metadataJson: unknown;
};

export type SmsWebhookMonitorMessageInput = {
  direction: string;
  status: string | null;
  createdAt: Date;
};

export type SmsWebhookMonitorReport = {
  since: Date;
  latestInboundWebhookAt: Date | null;
  latestOutboundStatusCallbackAt: Date | null;
  latestFailedCallbackAt: Date | null;
  unmatchedCallbackCount24h: number;
  recoveredCallbackCount24h: number;
  callbackVolume24h: number;
  inboundSmsVolume24h: number;
  outboundSmsVolume24h: number;
  invalidSignatureAttemptPersistence: "deferred";
};

export type FailedSmsDrilldownInput = {
  id: string;
  orgId: string;
  orgName: string;
  leadId: string;
  leadLabel: string;
  leadStatus: string | null;
  toNumberE164: string;
  providerMessageSid: string | null;
  status: string | null;
  body: string;
  createdAt: Date;
  communicationEvents: Array<{
    providerStatus: string | null;
    metadataJson: unknown;
  }>;
};

export function asSmsMetadataRecord(value: unknown): SmsMetadataRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as SmsMetadataRecord;
}

export function smsMetadataString(
  metadataJson: unknown,
  key: string,
): string | null {
  const metadata = asSmsMetadataRecord(metadataJson);
  const value = metadata?.[key];
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${value}`;
  }
  return null;
}

function smsMetadataBoolean(metadataJson: unknown, key: string): boolean | null {
  const metadata = asSmsMetadataRecord(metadataJson);
  const value = metadata?.[key];
  return typeof value === "boolean" ? value : null;
}

function smsMetadataDate(metadataJson: unknown, key: string): Date | null {
  const value = smsMetadataString(metadataJson, key);
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function maxDate(left: Date | null, right: Date | null): Date | null {
  if (!left) return right;
  if (!right) return left;
  return right > left ? right : left;
}

function isWithinWindow(value: Date | null, since: Date): boolean {
  return Boolean(value && value.getTime() >= since.getTime());
}

export function maskSmsPhone(value: string | null | undefined): string {
  const normalized = (value || "").trim();
  const digits = normalized.replace(/\D/g, "");
  if (digits.length < 4) return normalized || "-";
  return `${normalized.startsWith("+") ? "+" : ""}***${digits.slice(-4)}`;
}

export function maskSmsProviderSid(value: string | null | undefined): string {
  const normalized = (value || "").trim();
  if (!normalized) return "-";
  if (normalized.length <= 8) return "****";
  return `${normalized.slice(0, 4)}...${normalized.slice(-4)}`;
}

export function safeSmsBodyPreview(
  value: string | null | undefined,
  maxLength = DEFAULT_PREVIEW_LENGTH,
): string {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "-";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function extractSmsFailureMetadata(
  metadataJson: unknown,
  providerStatus?: string | null,
): SmsFailureMetadata | null {
  const category = smsMetadataString(metadataJson, "failureCategory");
  const label =
    smsMetadataString(metadataJson, "failureLabel") ||
    smsMetadataString(metadataJson, "failureReason");
  const operatorAction = smsMetadataString(metadataJson, "failureOperatorAction");
  const operatorActionLabel = smsMetadataString(
    metadataJson,
    "failureOperatorActionLabel",
  );
  const operatorDetail = smsMetadataString(metadataJson, "failureOperatorDetail");
  const providerErrorCode = smsMetadataString(metadataJson, "providerErrorCode");
  const providerErrorMessage = smsMetadataString(
    metadataJson,
    "providerErrorMessage",
  );
  const reason =
    smsMetadataString(metadataJson, "failureReason") ||
    smsMetadataString(metadataJson, "deliveryNotice") ||
    providerErrorMessage ||
    providerErrorCode ||
    null;
  const retryRecommended = smsMetadataBoolean(
    metadataJson,
    "failureRetryRecommended",
  );
  const blocksAutomationRetry = smsMetadataBoolean(
    metadataJson,
    "failureBlocksAutomationRetry",
  );

  if (
    !category &&
    !label &&
    !operatorAction &&
    !operatorActionLabel &&
    !operatorDetail &&
    !reason &&
    !providerErrorCode &&
    !providerErrorMessage
  ) {
    const normalizedStatus = (providerStatus || "").trim();
    return normalizedStatus
      ? {
          category: null,
          label: normalizedStatus,
          operatorAction: null,
          operatorActionLabel: null,
          operatorDetail: null,
          retryRecommended: null,
          blocksAutomationRetry: null,
          reason: null,
          providerErrorCode: null,
          providerErrorMessage: null,
        }
      : null;
  }

  return {
    category,
    label,
    operatorAction,
    operatorActionLabel,
    operatorDetail,
    retryRecommended,
    blocksAutomationRetry,
    reason,
    providerErrorCode,
    providerErrorMessage,
  };
}

export function buildManualSmsReceiptIdempotencyKeys(
  events: Array<Pick<LeadSmsDebugEventInput, "metadataJson">>,
): string[] {
  const keys = new Set<string>();
  for (const event of events) {
    const clientKey = smsMetadataString(event.metadataJson, "clientIdempotencyKey");
    if (!clientKey) continue;
    keys.add(`manual-sms:inbox-send:${clientKey}`);
    keys.add(`manual-sms:lead-thread:${clientKey}`);
  }
  return [...keys].sort();
}

function detectComplianceKeyword(metadataJson: unknown): "STOP" | "START" | "HELP" | null {
  const body = smsMetadataString(metadataJson, "body");
  const normalized = (body || "").trim().toUpperCase();
  if (normalized === "STOP" || normalized === "START" || normalized === "HELP") {
    return normalized;
  }
  return null;
}

function callbackStatusDate(event: SmsWebhookMonitorEventInput): Date | null {
  return smsMetadataDate(event.metadataJson, "providerStatusUpdatedAt") ||
    event.createdAt ||
    event.occurredAt ||
    null;
}

function eventIsFailedCallback(event: SmsWebhookMonitorEventInput): boolean {
  const providerStatus = (event.providerStatus || "").toLowerCase();
  const metadataStatus = (smsMetadataString(event.metadataJson, "status") || "").toUpperCase();
  return (
    providerStatus === "failed" ||
    providerStatus === "undelivered" ||
    metadataStatus === "FAILED"
  );
}

export function buildSmsWebhookMonitorReport(input: {
  events: SmsWebhookMonitorEventInput[];
  messages: SmsWebhookMonitorMessageInput[];
  now?: Date;
  windowMs?: number;
}): SmsWebhookMonitorReport {
  const now = input.now || new Date();
  const since = new Date(now.getTime() - (input.windowMs || ONE_DAY_MS));
  let latestInboundWebhookAt: Date | null = null;
  let latestOutboundStatusCallbackAt: Date | null = null;
  let latestFailedCallbackAt: Date | null = null;
  let unmatchedCallbackCount24h = 0;
  let recoveredCallbackCount24h = 0;
  let callbackVolume24h = 0;

  for (const event of input.events) {
    if (event.channel !== "SMS") continue;
    const eventAt = event.occurredAt || event.createdAt;
    if (event.type === "INBOUND_SMS_RECEIVED") {
      latestInboundWebhookAt = maxDate(latestInboundWebhookAt, eventAt);
    }

    if (event.type !== "OUTBOUND_SMS_SENT" || !event.providerMessageSid) {
      continue;
    }

    const statusAt = callbackStatusDate(event);
    latestOutboundStatusCallbackAt = maxDate(
      latestOutboundStatusCallbackAt,
      statusAt,
    );
    if (isWithinWindow(statusAt, since)) {
      callbackVolume24h += 1;
    }
    if (eventIsFailedCallback(event)) {
      latestFailedCallbackAt = maxDate(latestFailedCallbackAt, statusAt);
    }
    if (
      event.summary === UNMATCHED_STATUS_CALLBACK_SUMMARY &&
      isWithinWindow(event.createdAt, since)
    ) {
      unmatchedCallbackCount24h += 1;
    }
    if (
      (event.summary === RECOVERED_STATUS_CALLBACK_SUMMARY ||
        smsMetadataBoolean(
          event.metadataJson,
          "recoveredFromUnmatchedStatusCallback",
        ) === true) &&
      isWithinWindow(event.createdAt, since)
    ) {
      recoveredCallbackCount24h += 1;
    }
  }

  return {
    since,
    latestInboundWebhookAt,
    latestOutboundStatusCallbackAt,
    latestFailedCallbackAt,
    unmatchedCallbackCount24h,
    recoveredCallbackCount24h,
    callbackVolume24h,
    inboundSmsVolume24h: input.messages.filter(
      (message) =>
        message.direction === "INBOUND" &&
        message.createdAt.getTime() >= since.getTime(),
    ).length,
    outboundSmsVolume24h: input.messages.filter(
      (message) =>
        message.direction === "OUTBOUND" &&
        message.createdAt.getTime() >= since.getTime(),
    ).length,
    invalidSignatureAttemptPersistence: "deferred",
  };
}

export function buildFailedSmsDrilldownRows(input: FailedSmsDrilldownInput[]) {
  return input.map((message) => {
    const failure =
      message.communicationEvents
        .map((event) =>
          extractSmsFailureMetadata(event.metadataJson, event.providerStatus),
        )
        .find(Boolean) || null;
    return {
      id: message.id,
      orgId: message.orgId,
      orgName: message.orgName,
      leadId: message.leadId,
      leadLabel: message.leadLabel,
      leadStatus: message.leadStatus || "-",
      maskedPhone: maskSmsPhone(message.toNumberE164),
      maskedProviderSid: maskSmsProviderSid(message.providerMessageSid),
      status: message.status || "FAILED",
      bodyPreview: safeSmsBodyPreview(message.body, 72),
      createdAt: message.createdAt,
      failure,
    };
  });
}

export function buildLeadSmsDebugBundle(input: LeadSmsDebugBundleInput) {
  const providerSidSet = new Set(
    [
      ...input.messages.map((message) => message.providerMessageSid),
      ...input.communicationEvents.map((event) => event.providerMessageSid),
    ].filter((value): value is string => Boolean(value)),
  );
  const callbacks = input.callbackEvents.filter(
    (event) =>
      Boolean(event.providerMessageSid && providerSidSet.has(event.providerMessageSid)) &&
      (event.summary === UNMATCHED_STATUS_CALLBACK_SUMMARY ||
        event.summary === RECOVERED_STATUS_CALLBACK_SUMMARY),
  );
  const unmatchedCallbackCount = callbacks.filter(
    (event) => event.summary === UNMATCHED_STATUS_CALLBACK_SUMMARY,
  ).length;
  const recoveredCallbackCount = callbacks.filter(
    (event) => event.summary === RECOVERED_STATUS_CALLBACK_SUMMARY,
  ).length;

  const communicationEvents = input.communicationEvents.map((event) => ({
    id: event.id,
    type: event.type,
    channel: event.channel,
    summary: event.summary,
    providerStatus: event.providerStatus,
    maskedProviderSid: maskSmsProviderSid(event.providerMessageSid),
    occurredAt: event.occurredAt,
    messageId: event.messageId || null,
    failure: extractSmsFailureMetadata(event.metadataJson, event.providerStatus),
    complianceKeyword: detectComplianceKeyword(event.metadataJson),
  }));
  const failureLabels = [
    ...communicationEvents
      .map((event) => event.failure?.label || event.failure?.reason)
      .filter((value): value is string => Boolean(value)),
    ...callbacks
      .map((event) => extractSmsFailureMetadata(event.metadataJson, event.providerStatus)?.label)
      .filter((value): value is string => Boolean(value)),
  ];
  const uniqueFailureLabels = [...new Set(failureLabels)];
  const messages = input.messages.map((message) => ({
    id: message.id,
    direction: message.direction,
    type: message.type,
    status: message.status,
    maskedFrom: maskSmsPhone(message.fromNumberE164),
    maskedTo: maskSmsPhone(message.toNumberE164),
    maskedProviderSid: maskSmsProviderSid(message.providerMessageSid),
    bodyPreview: safeSmsBodyPreview(message.body),
    createdAt: message.createdAt,
  }));
  const receipts = input.receipts.map((receipt) => ({
    id: receipt.id,
    route: receipt.route,
    createdAt: receipt.createdAt,
    updatedAt: receipt.updatedAt || null,
    responseJsonExists: Boolean(receipt.responseJson),
  }));
  const smsConsent: LeadSmsDebugConsentInput = input.smsConsent || {
    id: null,
    status: "UNKNOWN",
    source: null,
    lastKeyword: null,
    lastUpdatedAt: null,
  };
  const legacyDncFallbackActive =
    input.lead.status === "DNC" && smsConsent.status !== "OPTED_IN";
  const dncBlocked = smsConsent.status === "OPTED_OUT" || legacyDncFallbackActive;
  const consentOperatorLabel =
    smsConsent.status === "OPTED_OUT"
      ? "SMS opted out"
      : smsConsent.status === "OPTED_IN"
        ? "SMS opted in"
        : legacyDncFallbackActive
          ? "Legacy DNC fallback blocks SMS"
          : "SMS consent unknown";
  const complianceEvents = communicationEvents.filter(
    (event) => event.complianceKeyword || event.summary.toUpperCase().includes("STOP"),
  );
  const debugSummaryLines = [
    "SMS debug summary",
    `Lead: ${input.lead.id}`,
    `Org: ${input.lead.orgName} (${input.lead.orgId})`,
    `Phone: ${maskSmsPhone(input.lead.phoneE164)}`,
    `Lead status: ${input.lead.status}${legacyDncFallbackActive ? " (legacy DNC fallback active)" : ""}`,
    `SMS consent: ${smsConsent.status} (${consentOperatorLabel})`,
    `Consent source: ${smsConsent.source || "none"}`,
    `Consent keyword: ${smsConsent.lastKeyword || "none"}`,
    `Block state: ${dncBlocked ? "DNC/STOP blocked" : "not blocked by SMS consent"}`,
    `Messages: ${messages.length}`,
    ...messages.map(
      (message) =>
        `- ${message.id} ${message.direction} ${message.status || "unknown"} ${message.maskedProviderSid}`,
    ),
    `Callbacks: ${unmatchedCallbackCount} unmatched / ${recoveredCallbackCount} recovered`,
    uniqueFailureLabels.length
      ? `Failures: ${uniqueFailureLabels.join("; ")}`
      : "Failures: none detected",
  ];

  return {
    lead: {
      id: input.lead.id,
      orgId: input.lead.orgId,
      orgName: input.lead.orgName,
      contactName: input.lead.contactName,
      businessName: input.lead.businessName,
      maskedPhone: maskSmsPhone(input.lead.phoneE164),
      status: input.lead.status,
      dncBlocked,
      lastInboundAt: input.lead.lastInboundAt,
      lastOutboundAt: input.lead.lastOutboundAt,
    },
    smsConsent: {
      id: smsConsent.id || null,
      status: smsConsent.status,
      source: smsConsent.source || "none",
      lastKeyword: smsConsent.lastKeyword,
      lastUpdatedAt: smsConsent.lastUpdatedAt,
      operatorLabel: consentOperatorLabel,
      legacyDncFallbackActive,
    },
    messages,
    communicationEvents,
    receipts,
    callbackEvents: callbacks.map((event) => ({
      id: event.id,
      summary: event.summary,
      providerStatus: event.providerStatus,
      maskedProviderSid: maskSmsProviderSid(event.providerMessageSid),
      occurredAt: event.occurredAt,
      failure: extractSmsFailureMetadata(event.metadataJson, event.providerStatus),
    })),
    unmatchedCallbackCount,
    recoveredCallbackCount,
    complianceEvents,
    debugSummary: debugSummaryLines.join("\n"),
  };
}
