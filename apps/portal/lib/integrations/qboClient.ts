import { Buffer } from "node:buffer";
import { normalizeEnvValue } from "@/lib/env";

const QBO_AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
const QBO_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const QBO_API_BASE_URL = "https://quickbooks.api.intuit.com";
const DEFAULT_QBO_SCOPES = ["com.intuit.quickbooks.accounting"];

type JsonObject = Record<string, unknown>;

type QboTokenPayload = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string[];
};

type QboPage<T> = {
  records: T[];
  nextStartPosition: number | null;
};

export type QboCustomerRecord = {
  id: string;
  displayName?: string;
  companyName?: string;
  email?: string;
  phone?: string;
  createdAt?: string;
  updatedAt?: string;
  raw: JsonObject;
};

export type QboInvoiceLineRecord = {
  id?: string;
  description?: string;
  amount?: string;
  unitPrice?: string;
  quantity?: string;
  raw: JsonObject;
};

export type QboInvoiceRecord = {
  id: string;
  customerId?: string;
  invoiceNumber?: string;
  status?: string;
  dueDate?: string;
  txnDate?: string;
  totalAmt?: string;
  balance?: string;
  currency?: string;
  createdAt?: string;
  updatedAt?: string;
  lineItems: QboInvoiceLineRecord[];
  raw: JsonObject;
};

export type QboPaymentRecord = {
  id: string;
  customerId?: string;
  amount?: string;
  txnDate?: string;
  paymentMethod?: string;
  referenceNumber?: string;
  linkedInvoiceId?: string;
  createdAt?: string;
  updatedAt?: string;
  raw: JsonObject;
};

function getQboClientId(): string {
  const value = normalizeEnvValue(process.env.QBO_CLIENT_ID);
  if (!value) {
    throw new Error("QBO_CLIENT_ID is required.");
  }
  return value;
}

function getQboClientSecret(): string {
  const value = normalizeEnvValue(process.env.QBO_CLIENT_SECRET);
  if (!value) {
    throw new Error("QBO_CLIENT_SECRET is required.");
  }
  return value;
}

export function resolveQboRedirectUri(origin: string): string {
  return normalizeEnvValue(process.env.QBO_REDIRECT_URI) || `${origin}/api/integrations/qbo/callback`;
}

export function getQboScopes(): string[] {
  const configured = normalizeEnvValue(process.env.QBO_SCOPES);
  if (!configured) {
    return DEFAULT_QBO_SCOPES;
  }
  return configured
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildQboAuthorizeUrl(input: {
  state: string;
  redirectUri: string;
}) {
  const params = new URLSearchParams({
    client_id: getQboClientId(),
    response_type: "code",
    scope: getQboScopes().join(" "),
    redirect_uri: input.redirectUri,
    state: input.state,
  });
  return `${QBO_AUTHORIZE_URL}?${params.toString()}`;
}

function parseExpiresAt(expiresIn: unknown): Date | null {
  const seconds = typeof expiresIn === "number" ? expiresIn : Number.parseInt(String(expiresIn || ""), 10);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  return new Date(Date.now() + seconds * 1000);
}

function parseScopes(scope: unknown): string[] {
  if (typeof scope !== "string") return [];
  return scope
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

function toRecordArray(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === "object" && !Array.isArray(item)) as JsonObject[];
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function parseJsonSafe(response: Response): Promise<JsonObject> {
  const payload = (await response.json().catch(() => null)) as JsonObject | null;
  return payload || {};
}

function qboTokenAuthHeader(): string {
  return `Basic ${Buffer.from(`${getQboClientId()}:${getQboClientSecret()}`).toString("base64")}`;
}

async function requestQboToken(params: URLSearchParams): Promise<QboTokenPayload> {
  const response = await fetch(QBO_TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: qboTokenAuthHeader(),
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(`QuickBooks token request failed (${response.status}).`);
  }

  const accessToken = getString(payload.access_token);
  if (!accessToken) {
    throw new Error("QuickBooks token response did not include access_token.");
  }

  return {
    accessToken,
    refreshToken: getString(payload.refresh_token) || null,
    expiresAt: parseExpiresAt(payload.expires_in),
    scopes: parseScopes(payload.scope),
  };
}

export async function exchangeQboCodeForTokens(input: {
  code: string;
  redirectUri: string;
}): Promise<QboTokenPayload> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
  });

  return requestQboToken(params);
}

export async function refreshQboTokens(refreshToken: string): Promise<QboTokenPayload> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  return requestQboToken(params);
}

export async function qboQuery<T = JsonObject>(input: {
  accessToken: string;
  realmId: string;
  query: string;
}): Promise<T> {
  const url = new URL(`${QBO_API_BASE_URL}/v3/company/${encodeURIComponent(input.realmId)}/query`);
  url.searchParams.set("query", input.query);
  url.searchParams.set("minorversion", "75");

  const response = await fetch(url.toString(), {
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      accept: "application/json",
    },
  });

  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(`QuickBooks query failed (${response.status}).`);
  }

  return payload as T;
}

function parseCustomer(item: JsonObject): QboCustomerRecord | null {
  const id = getString(item.Id);
  if (!id) return null;

  const email = toObject(item.PrimaryEmailAddr);
  const phone = toObject(item.PrimaryPhone);
  const metadata = toObject(item.MetaData);

  return {
    id,
    displayName: getString(item.DisplayName),
    companyName: getString(item.CompanyName),
    email: getString(email?.Address),
    phone: getString(phone?.FreeFormNumber),
    createdAt: getString(metadata?.CreateTime),
    updatedAt: getString(metadata?.LastUpdatedTime),
    raw: item,
  };
}

function parseInvoiceLine(item: JsonObject): QboInvoiceLineRecord {
  const salesLineDetail = toObject(item.SalesItemLineDetail);
  return {
    id: getString(item.Id),
    description: getString(item.Description),
    amount: getString(item.Amount),
    unitPrice: getString(salesLineDetail?.UnitPrice),
    quantity: getString(salesLineDetail?.Qty),
    raw: item,
  };
}

function parseInvoice(item: JsonObject): QboInvoiceRecord | null {
  const id = getString(item.Id);
  if (!id) return null;

  const customerRef = toObject(item.CustomerRef);
  const metadata = toObject(item.MetaData);
  const currencyRef = toObject(item.CurrencyRef);
  const lineItems = toRecordArray(item.Line).map(parseInvoiceLine);

  return {
    id,
    customerId: getString(customerRef?.value),
    invoiceNumber: getString(item.DocNumber),
    status: getString(item.EmailStatus) || getString(item.PrivateNote),
    dueDate: getString(item.DueDate),
    txnDate: getString(item.TxnDate),
    totalAmt: getString(item.TotalAmt),
    balance: getString(item.Balance),
    currency: getString(currencyRef?.value),
    createdAt: getString(metadata?.CreateTime),
    updatedAt: getString(metadata?.LastUpdatedTime),
    lineItems,
    raw: item,
  };
}

function parsePayment(item: JsonObject): QboPaymentRecord | null {
  const id = getString(item.Id);
  if (!id) return null;

  const customerRef = toObject(item.CustomerRef);
  const methodRef = toObject(item.PaymentMethodRef);
  const metadata = toObject(item.MetaData);
  const lineItems = toRecordArray(item.Line);
  const firstLine = lineItems[0] || null;
  const linkedTxnValue = firstLine ? firstLine["LinkedTxn"] : null;
  const linkedTxnRaw = Array.isArray(linkedTxnValue) ? linkedTxnValue[0] : null;
  const linkedTxn = toObject(linkedTxnRaw);

  return {
    id,
    customerId: getString(customerRef?.value),
    amount: getString(item.TotalAmt),
    txnDate: getString(item.TxnDate),
    paymentMethod: getString(methodRef?.name) || getString(methodRef?.value),
    referenceNumber: getString(item.PaymentRefNum),
    linkedInvoiceId: getString(linkedTxn?.TxnId),
    createdAt: getString(metadata?.CreateTime),
    updatedAt: getString(metadata?.LastUpdatedTime),
    raw: item,
  };
}

function parseQueryPage<T extends JsonObject>(
  payload: JsonObject,
  key: string,
  parser: (value: JsonObject) => T | null,
): QboPage<T> {
  const queryResponse = toObject(payload.QueryResponse) || {};
  const records = toRecordArray(queryResponse[key]).map(parser).filter(Boolean) as T[];
  const startPosition = Number.parseInt(String(queryResponse.startPosition || "1"), 10);
  const maxResults = Number.parseInt(String(queryResponse.maxResults || records.length || "0"), 10);
  const hasMore = records.length >= maxResults && maxResults > 0;
  const nextStartPosition = hasMore ? startPosition + maxResults : null;

  return {
    records,
    nextStartPosition,
  };
}

export async function fetchQboCustomersPage(input: {
  accessToken: string;
  realmId: string;
  startPosition: number;
  maxResults: number;
}): Promise<QboPage<QboCustomerRecord>> {
  const query = `select * from Customer startposition ${input.startPosition} maxresults ${input.maxResults}`;
  const payload = await qboQuery<JsonObject>({
    accessToken: input.accessToken,
    realmId: input.realmId,
    query,
  });
  return parseQueryPage(payload, "Customer", parseCustomer);
}

export async function fetchQboInvoicesPage(input: {
  accessToken: string;
  realmId: string;
  startPosition: number;
  maxResults: number;
}): Promise<QboPage<QboInvoiceRecord>> {
  const query = `select * from Invoice startposition ${input.startPosition} maxresults ${input.maxResults}`;
  const payload = await qboQuery<JsonObject>({
    accessToken: input.accessToken,
    realmId: input.realmId,
    query,
  });
  return parseQueryPage(payload, "Invoice", parseInvoice);
}

export async function fetchQboPaymentsPage(input: {
  accessToken: string;
  realmId: string;
  startPosition: number;
  maxResults: number;
}): Promise<QboPage<QboPaymentRecord>> {
  const query = `select * from Payment startposition ${input.startPosition} maxresults ${input.maxResults}`;
  const payload = await qboQuery<JsonObject>({
    accessToken: input.accessToken,
    realmId: input.realmId,
    query,
  });
  return parseQueryPage(payload, "Payment", parsePayment);
}
