import { normalizeEnvValue } from "@/lib/env";

const JOBBER_AUTH_URL = "https://api.getjobber.com/api/oauth/authorize";
const JOBBER_TOKEN_URL = "https://api.getjobber.com/api/oauth/token";
const JOBBER_GRAPHQL_URL = "https://api.getjobber.com/api/graphql";
const DEFAULT_JOBBER_SCOPES = ["read_clients", "read_jobs", "read_invoices"];

type JsonObject = Record<string, unknown>;

type JobberTokenPayload = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string[];
};

type PageInfo = {
  hasNextPage: boolean;
  endCursor: string | null;
};

type JobberPage<T> = {
  nodes: T[];
  pageInfo: PageInfo;
};

type GraphQlResult<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

type JobberClientRecord = {
  id: string;
  name?: string;
  companyName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  createdAt?: string;
  updatedAt?: string;
  raw: JsonObject;
};

type JobberJobRecord = {
  id: string;
  clientId?: string;
  title?: string;
  description?: string;
  status?: string;
  startAt?: string;
  endAt?: string;
  createdAt?: string;
  updatedAt?: string;
  raw: JsonObject;
};

type JobberInvoiceLineItemRecord = {
  id?: string;
  description?: string;
  quantity?: string;
  unitPrice?: string;
  total?: string;
  raw: JsonObject;
};

type JobberInvoiceRecord = {
  id: string;
  clientId?: string;
  jobId?: string;
  invoiceNumber?: string;
  status?: string;
  issuedAt?: string;
  dueAt?: string;
  total?: string;
  balance?: string;
  currency?: string;
  lineItems: JobberInvoiceLineItemRecord[];
  createdAt?: string;
  updatedAt?: string;
  raw: JsonObject;
};

function getJobberClientId(): string {
  const clientId = normalizeEnvValue(process.env.JOBBER_CLIENT_ID);
  if (!clientId) {
    throw new Error("JOBBER_CLIENT_ID is required.");
  }
  return clientId;
}

function getJobberClientSecret(): string {
  const clientSecret = normalizeEnvValue(process.env.JOBBER_CLIENT_SECRET);
  if (!clientSecret) {
    throw new Error("JOBBER_CLIENT_SECRET is required.");
  }
  return clientSecret;
}

export function resolveJobberRedirectUri(origin: string): string {
  return normalizeEnvValue(process.env.JOBBER_REDIRECT_URI) || `${origin}/api/integrations/jobber/callback`;
}

export function getJobberScopes(): string[] {
  const configured = normalizeEnvValue(process.env.JOBBER_SCOPES);
  if (!configured) {
    return DEFAULT_JOBBER_SCOPES;
  }
  return configured
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function buildJobberAuthorizeUrl(input: {
  state: string;
  redirectUri: string;
}) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: getJobberClientId(),
    redirect_uri: input.redirectUri,
    state: input.state,
    scope: getJobberScopes().join(" "),
  });

  return `${JOBBER_AUTH_URL}?${params.toString()}`;
}

function parseTokenScopes(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseExpiresAt(expiresIn: unknown): Date | null {
  const asNumber = typeof expiresIn === "number" ? expiresIn : Number.parseInt(String(expiresIn || ""), 10);
  if (!Number.isFinite(asNumber) || asNumber <= 0) {
    return null;
  }
  return new Date(Date.now() + asNumber * 1000);
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

function toNodeArray(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === "object" && !Array.isArray(item)) as JsonObject[];
}

async function parseJsonSafe(response: Response): Promise<JsonObject> {
  const payload = (await response.json().catch(() => null)) as JsonObject | null;
  return payload || {};
}

async function requestJobberToken(params: URLSearchParams): Promise<JobberTokenPayload> {
  const response = await fetch(JOBBER_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(`Jobber token exchange failed (${response.status}).`);
  }

  const accessToken = getString(payload.access_token);
  if (!accessToken) {
    throw new Error("Jobber token response did not include access_token.");
  }

  return {
    accessToken,
    refreshToken: getString(payload.refresh_token) || null,
    expiresAt: parseExpiresAt(payload.expires_in),
    scopes: parseTokenScopes(payload.scope),
  };
}

export async function exchangeJobberCodeForTokens(input: {
  code: string;
  redirectUri: string;
}): Promise<JobberTokenPayload> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: getJobberClientId(),
    client_secret: getJobberClientSecret(),
    redirect_uri: input.redirectUri,
    code: input.code,
  });
  return requestJobberToken(params);
}

export async function refreshJobberTokens(refreshToken: string): Promise<JobberTokenPayload> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: getJobberClientId(),
    client_secret: getJobberClientSecret(),
    refresh_token: refreshToken,
  });
  return requestJobberToken(params);
}

export async function jobberGraphQL<T>(input: {
  accessToken: string;
  query: string;
  variables?: JsonObject;
}): Promise<T> {
  const response = await fetch(JOBBER_GRAPHQL_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query: input.query,
      variables: input.variables || {},
    }),
  });

  const payload = (await response.json().catch(() => null)) as GraphQlResult<T> | null;

  if (!response.ok) {
    throw new Error(`Jobber GraphQL request failed (${response.status}).`);
  }

  if (!payload) {
    throw new Error("Jobber GraphQL response was empty.");
  }

  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    const message = payload.errors.map((error) => error.message).filter(Boolean).join("; ");
    throw new Error(message || "Jobber GraphQL returned errors.");
  }

  if (!payload.data) {
    throw new Error("Jobber GraphQL response did not include data.");
  }

  return payload.data;
}

function parsePageInfo(value: unknown): PageInfo {
  const page = getObject(value) || {};
  return {
    hasNextPage: page.hasNextPage === true,
    endCursor: getString(page.endCursor) || null,
  };
}

function parseJobberClient(node: JsonObject): JobberClientRecord | null {
  const id = getString(node.id);
  if (!id) return null;

  const emails = toNodeArray(node.emails);
  const phones = toNodeArray(node.phoneNumbers);
  const primaryEmail =
    emails.find((item) => item.primary === true && getString(item.address)) || emails.find((item) => getString(item.address));
  const primaryPhone =
    phones.find((item) => item.primary === true && getString(item.number)) || phones.find((item) => getString(item.number));

  return {
    id,
    name: getString(node.name),
    companyName: getString(node.companyName),
    firstName: getString(node.firstName),
    lastName: getString(node.lastName),
    email: getString(primaryEmail?.address),
    phone: getString(primaryPhone?.number),
    createdAt: getString(node.createdAt),
    updatedAt: getString(node.updatedAt),
    raw: node,
  };
}

function parseJobberJob(node: JsonObject): JobberJobRecord | null {
  const id = getString(node.id);
  if (!id) return null;
  const client = getObject(node.client);

  return {
    id,
    clientId: getString(client?.id),
    title: getString(node.title),
    description: getString(node.description),
    status: getString(node.status),
    startAt: getString(node.startAt),
    endAt: getString(node.endAt),
    createdAt: getString(node.createdAt),
    updatedAt: getString(node.updatedAt),
    raw: node,
  };
}

function parseInvoiceLineItem(node: JsonObject): JobberInvoiceLineItemRecord {
  return {
    id: getString(node.id),
    description: getString(node.description),
    quantity: getString(node.quantity),
    unitPrice: getString(node.unitPrice),
    total: getString(node.total),
    raw: node,
  };
}

function parseJobberInvoice(node: JsonObject): JobberInvoiceRecord | null {
  const id = getString(node.id);
  if (!id) return null;
  const client = getObject(node.client);
  const job = getObject(node.job);
  const lineItems = toNodeArray(node.lineItems).map(parseInvoiceLineItem);

  return {
    id,
    clientId: getString(client?.id),
    jobId: getString(job?.id),
    invoiceNumber: getString(node.invoiceNumber),
    status: getString(node.status),
    issuedAt: getString(node.issuedAt) || getString(node.issueDate),
    dueAt: getString(node.dueAt) || getString(node.dueDate),
    total: getString(node.total),
    balance: getString(node.balance),
    currency: getString(node.currencyCode) || getString(node.currency),
    lineItems,
    createdAt: getString(node.createdAt),
    updatedAt: getString(node.updatedAt),
    raw: node,
  };
}

const JOBBER_CLIENTS_QUERY = `
  query JobberClients($first: Int!, $after: String) {
    clients(first: $first, after: $after) {
      nodes {
        id
        name
        companyName
        firstName
        lastName
        createdAt
        updatedAt
        emails {
          address
          primary
        }
        phoneNumbers {
          number
          primary
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const JOBBER_JOBS_QUERY = `
  query JobberJobs($first: Int!, $after: String) {
    jobs(first: $first, after: $after) {
      nodes {
        id
        title
        description
        status
        startAt
        endAt
        createdAt
        updatedAt
        client {
          id
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const JOBBER_INVOICES_QUERY = `
  query JobberInvoices($first: Int!, $after: String) {
    invoices(first: $first, after: $after) {
      nodes {
        id
        invoiceNumber
        status
        issuedAt
        dueAt
        total
        balance
        currencyCode
        createdAt
        updatedAt
        client {
          id
        }
        job {
          id
        }
        lineItems {
          id
          description
          quantity
          unitPrice
          total
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export async function fetchJobberClientsPage(input: {
  accessToken: string;
  cursor: string | null;
  pageSize: number;
}): Promise<JobberPage<JobberClientRecord>> {
  const data = await jobberGraphQL<{ clients?: { nodes?: JsonObject[]; pageInfo?: JsonObject } }>({
    accessToken: input.accessToken,
    query: JOBBER_CLIENTS_QUERY,
    variables: {
      first: input.pageSize,
      after: input.cursor,
    },
  });

  const connection = data.clients || {};
  const nodes = toNodeArray(connection.nodes).map(parseJobberClient).filter(Boolean) as JobberClientRecord[];

  return {
    nodes,
    pageInfo: parsePageInfo(connection.pageInfo),
  };
}

export async function fetchJobberJobsPage(input: {
  accessToken: string;
  cursor: string | null;
  pageSize: number;
}): Promise<JobberPage<JobberJobRecord>> {
  const data = await jobberGraphQL<{ jobs?: { nodes?: JsonObject[]; pageInfo?: JsonObject } }>({
    accessToken: input.accessToken,
    query: JOBBER_JOBS_QUERY,
    variables: {
      first: input.pageSize,
      after: input.cursor,
    },
  });

  const connection = data.jobs || {};
  const nodes = toNodeArray(connection.nodes).map(parseJobberJob).filter(Boolean) as JobberJobRecord[];

  return {
    nodes,
    pageInfo: parsePageInfo(connection.pageInfo),
  };
}

export async function fetchJobberInvoicesPage(input: {
  accessToken: string;
  cursor: string | null;
  pageSize: number;
}): Promise<JobberPage<JobberInvoiceRecord>> {
  const data = await jobberGraphQL<{ invoices?: { nodes?: JsonObject[]; pageInfo?: JsonObject } }>({
    accessToken: input.accessToken,
    query: JOBBER_INVOICES_QUERY,
    variables: {
      first: input.pageSize,
      after: input.cursor,
    },
  });

  const connection = data.invoices || {};
  const nodes = toNodeArray(connection.nodes).map(parseJobberInvoice).filter(Boolean) as JobberInvoiceRecord[];

  return {
    nodes,
    pageInfo: parsePageInfo(connection.pageInfo),
  };
}
