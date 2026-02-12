import { Prisma, type IntegrationProvider } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  fetchJobberClientsPage,
  fetchJobberInvoicesPage,
  fetchJobberJobsPage,
  refreshJobberTokens,
} from "./jobberClient";
import {
  fetchQboCustomersPage,
  fetchQboInvoicesPage,
  fetchQboPaymentsPage,
  refreshQboTokens,
} from "./qboClient";
import { getDecryptedAccessToken } from "./account-store";

const JOBBER_PAGE_SIZE = 50;
const QBO_PAGE_SIZE = 100;

type ImportDateRange = {
  from?: Date | null;
  to?: Date | null;
};

type ImportStats = {
  customers: number;
  jobs: number;
  invoices: number;
  invoiceLineItems: number;
  payments: number;
  notes: number;
  possibleDuplicates: number;
};

function parseDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function inDateRange(date: Date | null, range: ImportDateRange): boolean {
  if (!date) return true;
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}

function decimalToCents(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value).trim());
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
}

function parseOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function asPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

async function detectPossibleCustomerDuplicate(input: {
  orgId: string;
  provider: IntegrationProvider;
  externalId: string;
  email: string | null;
  phone: string | null;
}): Promise<boolean> {
  if (!input.email || !input.phone) {
    return false;
  }

  const match = await prisma.portableCustomer.findFirst({
    where: {
      orgId: input.orgId,
      email: input.email,
      phone: input.phone,
      NOT: {
        AND: [
          { provider: input.provider },
          { externalId: input.externalId },
        ],
      },
    },
    select: { id: true },
  });

  return Boolean(match);
}

function blankStats(): ImportStats {
  return {
    customers: 0,
    jobs: 0,
    invoices: 0,
    invoiceLineItems: 0,
    payments: 0,
    notes: 0,
    possibleDuplicates: 0,
  };
}

type ImportContext = {
  orgId: string;
  range: ImportDateRange;
  stats: ImportStats;
};

async function importJobber(ctx: ImportContext) {
  const token = await getDecryptedAccessToken({
    orgId: ctx.orgId,
    provider: "JOBBER",
    refresh: async (refreshToken) => {
      const refreshed = await refreshJobberTokens(refreshToken);
      return {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: refreshed.expiresAt,
        scopes: refreshed.scopes,
      };
    },
  });

  const customerIdByExternal = new Map<string, string>();
  const jobIdByExternal = new Map<string, string>();

  let clientCursor: string | null = null;
  while (true) {
    const page = await fetchJobberClientsPage({
      accessToken: token.accessToken,
      cursor: clientCursor,
      pageSize: JOBBER_PAGE_SIZE,
    });

    for (const client of page.nodes) {
      const updatedAt = parseDate(client.updatedAt) || parseDate(client.createdAt);
      if (!inDateRange(updatedAt, ctx.range)) {
        continue;
      }

      const displayName =
        parseOptionalString(client.name) ||
        parseOptionalString(client.companyName) ||
        [client.firstName, client.lastName].filter(Boolean).join(" ").trim() ||
        `Customer ${client.id}`;

      const email = parseOptionalString(client.email);
      const phone = parseOptionalString(client.phone);
      const possibleDuplicate = await detectPossibleCustomerDuplicate({
        orgId: ctx.orgId,
        provider: "JOBBER",
        externalId: client.id,
        email,
        phone,
      });

      const record = await prisma.portableCustomer.upsert({
        where: {
          orgId_provider_externalId: {
            orgId: ctx.orgId,
            provider: "JOBBER",
            externalId: client.id,
          },
        },
        update: {
          displayName,
          email,
          phone,
          possibleDuplicate,
          createdAtSource: parseDate(client.createdAt),
          updatedAtSource: parseDate(client.updatedAt),
          lastSyncedAt: new Date(),
          rawJson: asPrismaJson(client.raw),
        },
        create: {
          orgId: ctx.orgId,
          provider: "JOBBER",
          externalId: client.id,
          displayName,
          email,
          phone,
          possibleDuplicate,
          createdAtSource: parseDate(client.createdAt),
          updatedAtSource: parseDate(client.updatedAt),
          rawJson: asPrismaJson(client.raw),
        },
        select: { id: true },
      });

      customerIdByExternal.set(client.id, record.id);
      ctx.stats.customers += 1;
      if (possibleDuplicate) {
        ctx.stats.possibleDuplicates += 1;
      }
    }

    if (!page.pageInfo.hasNextPage || !page.pageInfo.endCursor) {
      break;
    }
    clientCursor = page.pageInfo.endCursor;
  }

  let jobsCursor: string | null = null;
  while (true) {
    const page = await fetchJobberJobsPage({
      accessToken: token.accessToken,
      cursor: jobsCursor,
      pageSize: JOBBER_PAGE_SIZE,
    });

    for (const job of page.nodes) {
      const updatedAt = parseDate(job.updatedAt) || parseDate(job.createdAt);
      if (!inDateRange(updatedAt, ctx.range)) {
        continue;
      }

      let customerId: string | null = null;
      if (job.clientId) {
        customerId = customerIdByExternal.get(job.clientId) || null;
        if (!customerId) {
          const existingCustomer = await prisma.portableCustomer.findUnique({
            where: {
              orgId_provider_externalId: {
                orgId: ctx.orgId,
                provider: "JOBBER",
                externalId: job.clientId,
              },
            },
            select: { id: true },
          });
          customerId = existingCustomer?.id || null;
        }
      }

      const record = await prisma.portableJob.upsert({
        where: {
          orgId_provider_externalId: {
            orgId: ctx.orgId,
            provider: "JOBBER",
            externalId: job.id,
          },
        },
        update: {
          customerId,
          customerExternalId: job.clientId || null,
          title: parseOptionalString(job.title) || `Job ${job.id}`,
          status: parseOptionalString(job.status),
          description: parseOptionalString(job.description),
          startAt: parseDate(job.startAt),
          endAt: parseDate(job.endAt),
          createdAtSource: parseDate(job.createdAt),
          updatedAtSource: parseDate(job.updatedAt),
          lastSyncedAt: new Date(),
          rawJson: asPrismaJson(job.raw),
        },
        create: {
          orgId: ctx.orgId,
          provider: "JOBBER",
          externalId: job.id,
          customerId,
          customerExternalId: job.clientId || null,
          title: parseOptionalString(job.title) || `Job ${job.id}`,
          status: parseOptionalString(job.status),
          description: parseOptionalString(job.description),
          startAt: parseDate(job.startAt),
          endAt: parseDate(job.endAt),
          createdAtSource: parseDate(job.createdAt),
          updatedAtSource: parseDate(job.updatedAt),
          rawJson: asPrismaJson(job.raw),
        },
        select: { id: true },
      });

      jobIdByExternal.set(job.id, record.id);
      ctx.stats.jobs += 1;
    }

    if (!page.pageInfo.hasNextPage || !page.pageInfo.endCursor) {
      break;
    }
    jobsCursor = page.pageInfo.endCursor;
  }

  let invoicesCursor: string | null = null;
  while (true) {
    const page = await fetchJobberInvoicesPage({
      accessToken: token.accessToken,
      cursor: invoicesCursor,
      pageSize: JOBBER_PAGE_SIZE,
    });

    for (const invoice of page.nodes) {
      const updatedAt = parseDate(invoice.updatedAt) || parseDate(invoice.createdAt) || parseDate(invoice.issuedAt);
      if (!inDateRange(updatedAt, ctx.range)) {
        continue;
      }

      let customerId: string | null = null;
      if (invoice.clientId) {
        customerId = customerIdByExternal.get(invoice.clientId) || null;
        if (!customerId) {
          const existing = await prisma.portableCustomer.findUnique({
            where: {
              orgId_provider_externalId: {
                orgId: ctx.orgId,
                provider: "JOBBER",
                externalId: invoice.clientId,
              },
            },
            select: { id: true },
          });
          customerId = existing?.id || null;
        }
      }

      let jobId: string | null = null;
      if (invoice.jobId) {
        jobId = jobIdByExternal.get(invoice.jobId) || null;
        if (!jobId) {
          const existing = await prisma.portableJob.findUnique({
            where: {
              orgId_provider_externalId: {
                orgId: ctx.orgId,
                provider: "JOBBER",
                externalId: invoice.jobId,
              },
            },
            select: { id: true },
          });
          jobId = existing?.id || null;
        }
      }

      const invoiceRecord = await prisma.portableInvoice.upsert({
        where: {
          orgId_provider_externalId: {
            orgId: ctx.orgId,
            provider: "JOBBER",
            externalId: invoice.id,
          },
        },
        update: {
          customerId,
          customerExternalId: invoice.clientId || null,
          jobId,
          jobExternalId: invoice.jobId || null,
          invoiceNumber: parseOptionalString(invoice.invoiceNumber),
          status: parseOptionalString(invoice.status),
          issuedAt: parseDate(invoice.issuedAt),
          dueAt: parseDate(invoice.dueAt),
          currency: parseOptionalString(invoice.currency),
          totalCents: decimalToCents(invoice.total),
          balanceCents: decimalToCents(invoice.balance),
          createdAtSource: parseDate(invoice.createdAt),
          updatedAtSource: parseDate(invoice.updatedAt),
          lastSyncedAt: new Date(),
          rawJson: asPrismaJson(invoice.raw),
        },
        create: {
          orgId: ctx.orgId,
          provider: "JOBBER",
          externalId: invoice.id,
          customerId,
          customerExternalId: invoice.clientId || null,
          jobId,
          jobExternalId: invoice.jobId || null,
          invoiceNumber: parseOptionalString(invoice.invoiceNumber),
          status: parseOptionalString(invoice.status),
          issuedAt: parseDate(invoice.issuedAt),
          dueAt: parseDate(invoice.dueAt),
          currency: parseOptionalString(invoice.currency),
          totalCents: decimalToCents(invoice.total),
          balanceCents: decimalToCents(invoice.balance),
          createdAtSource: parseDate(invoice.createdAt),
          updatedAtSource: parseDate(invoice.updatedAt),
          rawJson: asPrismaJson(invoice.raw),
        },
        select: { id: true },
      });

      ctx.stats.invoices += 1;

      for (let index = 0; index < invoice.lineItems.length; index += 1) {
        const lineItem = invoice.lineItems[index]!;
        const externalId = lineItem.id || `${invoice.id}:line:${index + 1}`;

        await prisma.portableInvoiceLineItem.upsert({
          where: {
            orgId_provider_externalId: {
              orgId: ctx.orgId,
              provider: "JOBBER",
              externalId,
            },
          },
          update: {
            invoiceId: invoiceRecord.id,
            invoiceExternalId: invoice.id,
            description: parseOptionalString(lineItem.description),
            quantityDecimal: parseOptionalString(lineItem.quantity),
            unitPriceCents: decimalToCents(lineItem.unitPrice),
            amountCents: decimalToCents(lineItem.total),
            position: index + 1,
            lastSyncedAt: new Date(),
            rawJson: asPrismaJson(lineItem.raw),
          },
          create: {
            orgId: ctx.orgId,
            provider: "JOBBER",
            externalId,
            invoiceId: invoiceRecord.id,
            invoiceExternalId: invoice.id,
            description: parseOptionalString(lineItem.description),
            quantityDecimal: parseOptionalString(lineItem.quantity),
            unitPriceCents: decimalToCents(lineItem.unitPrice),
            amountCents: decimalToCents(lineItem.total),
            position: index + 1,
            rawJson: asPrismaJson(lineItem.raw),
          },
        });
        ctx.stats.invoiceLineItems += 1;
      }
    }

    if (!page.pageInfo.hasNextPage || !page.pageInfo.endCursor) {
      break;
    }
    invoicesCursor = page.pageInfo.endCursor;
  }
}

async function importQbo(ctx: ImportContext) {
  const token = await getDecryptedAccessToken({
    orgId: ctx.orgId,
    provider: "QBO",
    refresh: async (refreshToken) => {
      const refreshed = await refreshQboTokens(refreshToken);
      return {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: refreshed.expiresAt,
        scopes: refreshed.scopes,
      };
    },
  });

  if (!token.realmId) {
    throw new Error("QuickBooks connection is missing realmId.");
  }

  const customerIdByExternal = new Map<string, string>();
  const jobIdByExternal = new Map<string, string>();
  const invoiceIdByExternal = new Map<string, string>();

  let customerStart = 1;
  while (true) {
    const page = await fetchQboCustomersPage({
      accessToken: token.accessToken,
      realmId: token.realmId,
      startPosition: customerStart,
      maxResults: QBO_PAGE_SIZE,
    });

    if (page.records.length === 0) {
      break;
    }

    for (const customer of page.records) {
      const updatedAt = parseDate(customer.updatedAt) || parseDate(customer.createdAt);
      if (!inDateRange(updatedAt, ctx.range)) {
        continue;
      }

      const displayName =
        parseOptionalString(customer.displayName) ||
        parseOptionalString(customer.companyName) ||
        `Customer ${customer.id}`;
      const email = parseOptionalString(customer.email);
      const phone = parseOptionalString(customer.phone);
      const possibleDuplicate = await detectPossibleCustomerDuplicate({
        orgId: ctx.orgId,
        provider: "QBO",
        externalId: customer.id,
        email,
        phone,
      });

      const customerRecord = await prisma.portableCustomer.upsert({
        where: {
          orgId_provider_externalId: {
            orgId: ctx.orgId,
            provider: "QBO",
            externalId: customer.id,
          },
        },
        update: {
          displayName,
          email,
          phone,
          possibleDuplicate,
          createdAtSource: parseDate(customer.createdAt),
          updatedAtSource: parseDate(customer.updatedAt),
          lastSyncedAt: new Date(),
          rawJson: asPrismaJson(customer.raw),
        },
        create: {
          orgId: ctx.orgId,
          provider: "QBO",
          externalId: customer.id,
          displayName,
          email,
          phone,
          possibleDuplicate,
          createdAtSource: parseDate(customer.createdAt),
          updatedAtSource: parseDate(customer.updatedAt),
          rawJson: asPrismaJson(customer.raw),
        },
        select: { id: true },
      });

      customerIdByExternal.set(customer.id, customerRecord.id);
      ctx.stats.customers += 1;
      if (possibleDuplicate) {
        ctx.stats.possibleDuplicates += 1;
      }

      const asProject = customer.raw["Job"] === true;
      if (asProject) {
        const project = await prisma.portableJob.upsert({
          where: {
            orgId_provider_externalId: {
              orgId: ctx.orgId,
              provider: "QBO",
              externalId: `customer-project:${customer.id}`,
            },
          },
          update: {
            customerId: customerRecord.id,
            customerExternalId: customer.id,
            title: displayName,
            status: "ACTIVE",
            description: "Imported QBO project/sub-customer",
            updatedAtSource: parseDate(customer.updatedAt),
            createdAtSource: parseDate(customer.createdAt),
            lastSyncedAt: new Date(),
            rawJson: asPrismaJson(customer.raw),
          },
          create: {
            orgId: ctx.orgId,
            provider: "QBO",
            externalId: `customer-project:${customer.id}`,
            customerId: customerRecord.id,
            customerExternalId: customer.id,
            title: displayName,
            status: "ACTIVE",
            description: "Imported QBO project/sub-customer",
            updatedAtSource: parseDate(customer.updatedAt),
            createdAtSource: parseDate(customer.createdAt),
            rawJson: asPrismaJson(customer.raw),
          },
          select: { id: true },
        });
        jobIdByExternal.set(`customer-project:${customer.id}`, project.id);
        ctx.stats.jobs += 1;
      }
    }

    if (!page.nextStartPosition) {
      break;
    }
    customerStart = page.nextStartPosition;
  }

  let invoiceStart = 1;
  while (true) {
    const page = await fetchQboInvoicesPage({
      accessToken: token.accessToken,
      realmId: token.realmId,
      startPosition: invoiceStart,
      maxResults: QBO_PAGE_SIZE,
    });

    if (page.records.length === 0) {
      break;
    }

    for (const invoice of page.records) {
      const updatedAt = parseDate(invoice.updatedAt) || parseDate(invoice.createdAt) || parseDate(invoice.txnDate);
      if (!inDateRange(updatedAt, ctx.range)) {
        continue;
      }

      const customerId = invoice.customerId
        ? customerIdByExternal.get(invoice.customerId) ||
          (
            await prisma.portableCustomer.findUnique({
              where: {
                orgId_provider_externalId: {
                  orgId: ctx.orgId,
                  provider: "QBO",
                  externalId: invoice.customerId,
                },
              },
              select: { id: true },
            })
          )?.id ||
          null
        : null;

      const inferredJobExternal = invoice.customerId ? `customer-project:${invoice.customerId}` : null;
      const jobId = inferredJobExternal
        ? jobIdByExternal.get(inferredJobExternal) ||
          (
            await prisma.portableJob.findUnique({
              where: {
                orgId_provider_externalId: {
                  orgId: ctx.orgId,
                  provider: "QBO",
                  externalId: inferredJobExternal,
                },
              },
              select: { id: true },
            })
          )?.id ||
          null
        : null;

      const invoiceRecord = await prisma.portableInvoice.upsert({
        where: {
          orgId_provider_externalId: {
            orgId: ctx.orgId,
            provider: "QBO",
            externalId: invoice.id,
          },
        },
        update: {
          customerId,
          customerExternalId: invoice.customerId || null,
          jobId,
          jobExternalId: inferredJobExternal,
          invoiceNumber: parseOptionalString(invoice.invoiceNumber),
          status: parseOptionalString(invoice.status),
          issuedAt: parseDate(invoice.txnDate),
          dueAt: parseDate(invoice.dueDate),
          currency: parseOptionalString(invoice.currency),
          totalCents: decimalToCents(invoice.totalAmt),
          balanceCents: decimalToCents(invoice.balance),
          createdAtSource: parseDate(invoice.createdAt),
          updatedAtSource: parseDate(invoice.updatedAt),
          lastSyncedAt: new Date(),
          rawJson: asPrismaJson(invoice.raw),
        },
        create: {
          orgId: ctx.orgId,
          provider: "QBO",
          externalId: invoice.id,
          customerId,
          customerExternalId: invoice.customerId || null,
          jobId,
          jobExternalId: inferredJobExternal,
          invoiceNumber: parseOptionalString(invoice.invoiceNumber),
          status: parseOptionalString(invoice.status),
          issuedAt: parseDate(invoice.txnDate),
          dueAt: parseDate(invoice.dueDate),
          currency: parseOptionalString(invoice.currency),
          totalCents: decimalToCents(invoice.totalAmt),
          balanceCents: decimalToCents(invoice.balance),
          createdAtSource: parseDate(invoice.createdAt),
          updatedAtSource: parseDate(invoice.updatedAt),
          rawJson: asPrismaJson(invoice.raw),
        },
        select: { id: true },
      });

      invoiceIdByExternal.set(invoice.id, invoiceRecord.id);
      ctx.stats.invoices += 1;

      for (let index = 0; index < invoice.lineItems.length; index += 1) {
        const line = invoice.lineItems[index]!;
        const externalId = line.id || `${invoice.id}:line:${index + 1}`;

        await prisma.portableInvoiceLineItem.upsert({
          where: {
            orgId_provider_externalId: {
              orgId: ctx.orgId,
              provider: "QBO",
              externalId,
            },
          },
          update: {
            invoiceId: invoiceRecord.id,
            invoiceExternalId: invoice.id,
            description: parseOptionalString(line.description),
            quantityDecimal: parseOptionalString(line.quantity),
            unitPriceCents: decimalToCents(line.unitPrice),
            amountCents: decimalToCents(line.amount),
            position: index + 1,
            lastSyncedAt: new Date(),
            rawJson: asPrismaJson(line.raw),
          },
          create: {
            orgId: ctx.orgId,
            provider: "QBO",
            externalId,
            invoiceId: invoiceRecord.id,
            invoiceExternalId: invoice.id,
            description: parseOptionalString(line.description),
            quantityDecimal: parseOptionalString(line.quantity),
            unitPriceCents: decimalToCents(line.unitPrice),
            amountCents: decimalToCents(line.amount),
            position: index + 1,
            rawJson: asPrismaJson(line.raw),
          },
        });
        ctx.stats.invoiceLineItems += 1;
      }

      const noteBody = parseOptionalString(invoice.raw["PrivateNote"]);
      if (noteBody) {
        await prisma.portableNote.upsert({
          where: {
            orgId_provider_externalId: {
              orgId: ctx.orgId,
              provider: "QBO",
              externalId: `invoice-note:${invoice.id}`,
            },
          },
          update: {
            customerId,
            customerExternalId: invoice.customerId || null,
            invoiceId: invoiceRecord.id,
            invoiceExternalId: invoice.id,
            body: noteBody,
            authoredBy: "QuickBooks",
            notedAt: parseDate(invoice.updatedAt) || parseDate(invoice.txnDate),
            updatedAtSource: parseDate(invoice.updatedAt),
            createdAtSource: parseDate(invoice.createdAt),
            lastSyncedAt: new Date(),
            rawJson: asPrismaJson(invoice.raw),
          },
          create: {
            orgId: ctx.orgId,
            provider: "QBO",
            externalId: `invoice-note:${invoice.id}`,
            customerId,
            customerExternalId: invoice.customerId || null,
            invoiceId: invoiceRecord.id,
            invoiceExternalId: invoice.id,
            body: noteBody,
            authoredBy: "QuickBooks",
            notedAt: parseDate(invoice.updatedAt) || parseDate(invoice.txnDate),
            updatedAtSource: parseDate(invoice.updatedAt),
            createdAtSource: parseDate(invoice.createdAt),
            rawJson: asPrismaJson(invoice.raw),
          },
        });
        ctx.stats.notes += 1;
      }
    }

    if (!page.nextStartPosition) {
      break;
    }
    invoiceStart = page.nextStartPosition;
  }

  let paymentStart = 1;
  while (true) {
    const page = await fetchQboPaymentsPage({
      accessToken: token.accessToken,
      realmId: token.realmId,
      startPosition: paymentStart,
      maxResults: QBO_PAGE_SIZE,
    });

    if (page.records.length === 0) {
      break;
    }

    for (const payment of page.records) {
      const updatedAt = parseDate(payment.updatedAt) || parseDate(payment.createdAt) || parseDate(payment.txnDate);
      if (!inDateRange(updatedAt, ctx.range)) {
        continue;
      }

      const customerId = payment.customerId
        ? customerIdByExternal.get(payment.customerId) ||
          (
            await prisma.portableCustomer.findUnique({
              where: {
                orgId_provider_externalId: {
                  orgId: ctx.orgId,
                  provider: "QBO",
                  externalId: payment.customerId,
                },
              },
              select: { id: true },
            })
          )?.id ||
          null
        : null;

      const invoiceId = payment.linkedInvoiceId
        ? invoiceIdByExternal.get(payment.linkedInvoiceId) ||
          (
            await prisma.portableInvoice.findUnique({
              where: {
                orgId_provider_externalId: {
                  orgId: ctx.orgId,
                  provider: "QBO",
                  externalId: payment.linkedInvoiceId,
                },
              },
              select: { id: true },
            })
          )?.id ||
          null
        : null;

      await prisma.portablePayment.upsert({
        where: {
          orgId_provider_externalId: {
            orgId: ctx.orgId,
            provider: "QBO",
            externalId: payment.id,
          },
        },
        update: {
          customerId,
          customerExternalId: payment.customerId || null,
          invoiceId,
          invoiceExternalId: payment.linkedInvoiceId || null,
          amountCents: decimalToCents(payment.amount),
          currency: null,
          paidAt: parseDate(payment.txnDate),
          status: "PAID",
          method: parseOptionalString(payment.paymentMethod),
          reference: parseOptionalString(payment.referenceNumber),
          createdAtSource: parseDate(payment.createdAt),
          updatedAtSource: parseDate(payment.updatedAt),
          lastSyncedAt: new Date(),
          rawJson: asPrismaJson(payment.raw),
        },
        create: {
          orgId: ctx.orgId,
          provider: "QBO",
          externalId: payment.id,
          customerId,
          customerExternalId: payment.customerId || null,
          invoiceId,
          invoiceExternalId: payment.linkedInvoiceId || null,
          amountCents: decimalToCents(payment.amount),
          currency: null,
          paidAt: parseDate(payment.txnDate),
          status: "PAID",
          method: parseOptionalString(payment.paymentMethod),
          reference: parseOptionalString(payment.referenceNumber),
          createdAtSource: parseDate(payment.createdAt),
          updatedAtSource: parseDate(payment.updatedAt),
          rawJson: asPrismaJson(payment.raw),
        },
      });
      ctx.stats.payments += 1;
    }

    if (!page.nextStartPosition) {
      break;
    }
    paymentStart = page.nextStartPosition;
  }
}

export async function runProviderImport(input: {
  orgId: string;
  provider: IntegrationProvider;
  dateFrom?: Date | null;
  dateTo?: Date | null;
}) {
  const startedAt = new Date();
  const run = await prisma.importRun.create({
    data: {
      orgId: input.orgId,
      provider: input.provider,
      status: "RUNNING",
      startedAt,
      statsJson: asPrismaJson({}),
    },
    select: { id: true },
  });

  const stats = blankStats();
  const range: ImportDateRange = {
    from: input.dateFrom || null,
    to: input.dateTo || null,
  };

  try {
    if (input.provider === "JOBBER") {
      await importJobber({ orgId: input.orgId, range, stats });
    } else {
      await importQbo({ orgId: input.orgId, range, stats });
    }

    const finishedAt = new Date();
    await prisma.importRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCESS",
        finishedAt,
        statsJson: asPrismaJson(stats),
        errorJson: Prisma.JsonNull,
      },
    });

    await prisma.integrationAccount.updateMany({
      where: {
        orgId: input.orgId,
        provider: input.provider,
      },
      data: {
        lastSyncedAt: finishedAt,
        lastError: null,
        status: "CONNECTED",
      },
    });

    return {
      runId: run.id,
      status: "SUCCESS" as const,
      stats,
    };
  } catch (error) {
    const finishedAt = new Date();
    const errorMessage = error instanceof Error ? error.message : "Unknown import error.";
    await prisma.importRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        finishedAt,
        statsJson: asPrismaJson(stats),
        errorJson: asPrismaJson({
          message: errorMessage,
        }),
      },
    });

    await prisma.integrationAccount.updateMany({
      where: {
        orgId: input.orgId,
        provider: input.provider,
      },
      data: {
        status: "ERROR",
        lastError: errorMessage,
      },
    });

    throw error;
  }
}
