import assert from "node:assert/strict";
import test from "node:test";
import { parseSmsComplianceKeyword } from "../lib/sms-compliance.ts";
import {
  backfillSmsConsentFromLegacyDnc,
  getSmsConsentState,
  getSmsSendBlockState,
  recordSmsStart,
  recordSmsStop,
  safeSmsConsentBodyPreview,
} from "../lib/sms-consent.ts";

function clone(value) {
  return value ? { ...value } : value;
}

function makeSmsConsentClient({ consents = [], leads = [] } = {}) {
  const records = new Map();
  let nextId = 1;

  function keyFor(orgId, phoneE164) {
    return `${orgId}:${phoneE164}`;
  }

  function save(record) {
    records.set(keyFor(record.orgId, record.phoneE164), record);
    return record;
  }

  for (const consent of consents) {
    save({
      id: consent.id || `consent_${nextId++}`,
      orgId: consent.orgId,
      phoneE164: consent.phoneE164,
      customerId: consent.customerId || null,
      leadId: consent.leadId || null,
      status: consent.status || "UNKNOWN",
      source: consent.source || "SYSTEM",
      lastKeyword: consent.lastKeyword || null,
      lastMessageBodyPreview: consent.lastMessageBodyPreview || null,
      optedOutAt: consent.optedOutAt || null,
      optedInAt: consent.optedInAt || null,
      lastUpdatedAt: consent.lastUpdatedAt || new Date("2026-04-28T10:00:00.000Z"),
      createdAt: consent.createdAt || new Date("2026-04-28T10:00:00.000Z"),
      updatedAt: consent.updatedAt || new Date("2026-04-28T10:00:00.000Z"),
      metadataJson: consent.metadataJson || null,
    });
  }

  const client = {
    smsConsent: {
      async findUnique(args) {
        if (args.where.id) {
          return clone([...records.values()].find((record) => record.id === args.where.id) || null);
        }
        const lookup = args.where.orgId_phoneE164;
        return clone(records.get(keyFor(lookup.orgId, lookup.phoneE164)) || null);
      },
      async upsert(args) {
        const lookup = args.where.orgId_phoneE164;
        const existing = records.get(keyFor(lookup.orgId, lookup.phoneE164));
        if (existing) {
          Object.assign(existing, args.update, {
            updatedAt: new Date("2026-04-28T10:00:01.000Z"),
          });
          return clone(existing);
        }
        const record = {
          id: `consent_${nextId++}`,
          customerId: null,
          leadId: null,
          optedOutAt: null,
          optedInAt: null,
          createdAt: new Date("2026-04-28T10:00:00.000Z"),
          updatedAt: new Date("2026-04-28T10:00:00.000Z"),
          metadataJson: null,
          ...args.create,
        };
        save(record);
        return clone(record);
      },
      async create(args) {
        const record = {
          id: `consent_${nextId++}`,
          customerId: null,
          leadId: null,
          optedOutAt: null,
          optedInAt: null,
          lastKeyword: null,
          lastMessageBodyPreview: null,
          createdAt: new Date("2026-04-28T10:00:00.000Z"),
          updatedAt: new Date("2026-04-28T10:00:00.000Z"),
          metadataJson: null,
          ...args.data,
        };
        save(record);
        return clone(record);
      },
      async update(args) {
        const existing = [...records.values()].find((record) => record.id === args.where.id);
        assert.ok(existing, "expected consent record to update");
        Object.assign(existing, args.data, {
          updatedAt: new Date("2026-04-28T10:00:01.000Z"),
        });
        return clone(existing);
      },
    },
    lead: {
      async findMany(args) {
        const ordered = leads
          .filter((lead) => lead.status === args.where.status && lead.phoneE164)
          .sort((a, b) => a.id.localeCompare(b.id));
        const startIndex = args.cursor
          ? Math.max(0, ordered.findIndex((lead) => lead.id === args.cursor.id) + (args.skip || 0))
          : 0;
        return ordered.slice(startIndex, startIndex + args.take).map((lead) => ({
          id: lead.id,
          orgId: lead.orgId,
          customerId: lead.customerId || null,
          phoneE164: lead.phoneE164,
        }));
      },
    },
    records,
  };

  return client;
}

test("STOP creates or updates SmsConsent as OPTED_OUT", async () => {
  const client = makeSmsConsentClient();
  const consent = await recordSmsStop({
    client,
    orgId: "org_1",
    phoneE164: "+12533300042",
    leadId: "lead_1",
    customerId: "customer_1",
    body: "STOP please unsubscribe me from this long support message body",
    occurredAt: new Date("2026-04-28T12:00:00.000Z"),
  });

  assert.equal(consent.status, "OPTED_OUT");
  assert.equal(consent.source, "TWILIO_STOP");
  assert.equal(consent.lastKeyword, "STOP");
  assert.equal(consent.optedOutAt?.toISOString(), "2026-04-28T12:00:00.000Z");
  assert.equal(safeSmsConsentBodyPreview("STOP\n\nplease", 20), "STOP please");
});

test("START and UNSTOP create or update SmsConsent as OPTED_IN without changing lead status", async () => {
  const client = makeSmsConsentClient({
    consents: [
      {
        orgId: "org_1",
        phoneE164: "+12533300042",
        leadId: "lead_1",
        status: "OPTED_OUT",
        source: "TWILIO_STOP",
      },
    ],
  });

  const consent = await recordSmsStart({
    client,
    orgId: "org_1",
    phoneE164: "+12533300042",
    leadId: "lead_1",
    body: "UNSTOP",
    occurredAt: new Date("2026-04-28T12:05:00.000Z"),
  });

  assert.equal(consent.status, "OPTED_IN");
  assert.equal(consent.source, "TWILIO_START");
  assert.equal(consent.lastKeyword, "UNSTOP");
  assert.equal(consent.optedInAt?.toISOString(), "2026-04-28T12:05:00.000Z");
});

test("HELP is informational and does not create SMS consent", async () => {
  const client = makeSmsConsentClient();

  assert.equal(parseSmsComplianceKeyword("HELP"), "HELP");
  assert.equal(parseSmsComplianceKeyword("HELP me please"), "HELP");

  const consent = await getSmsConsentState({
    client,
    orgId: "org_1",
    phoneE164: "+12533300042",
  });
  assert.equal(consent.status, "UNKNOWN");
  assert.equal(client.records.size, 0);
});

test("outbound guard blocks explicit SmsConsent OPTED_OUT", async () => {
  const client = makeSmsConsentClient({
    consents: [
      {
        orgId: "org_1",
        phoneE164: "+12533300042",
        status: "OPTED_OUT",
        source: "TWILIO_STOP",
      },
    ],
  });

  const block = await getSmsSendBlockState({
    client,
    orgId: "org_1",
    phoneE164: "+12533300042",
    legacyLeadStatus: "FOLLOW_UP",
  });

  assert.equal(block.blocked, true);
  assert.equal(block.reasonCode, "SMS_CONSENT_OPTED_OUT");
});

test("outbound guard keeps legacy DNC fallback but explicit OPTED_IN can restore SMS consent", async () => {
  const fallbackClient = makeSmsConsentClient();
  const fallback = await getSmsSendBlockState({
    client: fallbackClient,
    orgId: "org_1",
    phoneE164: "+12533300042",
    legacyLeadStatus: "DNC",
  });
  assert.equal(fallback.blocked, true);
  assert.equal(fallback.reasonCode, "LEGACY_LEAD_DNC");

  const optedInClient = makeSmsConsentClient({
    consents: [
      {
        orgId: "org_1",
        phoneE164: "+12533300042",
        status: "OPTED_IN",
        source: "TWILIO_START",
      },
    ],
  });
  const restored = await getSmsSendBlockState({
    client: optedInClient,
    orgId: "org_1",
    phoneE164: "+12533300042",
    legacyLeadStatus: "DNC",
  });
  assert.equal(restored.blocked, false);
});

test("legacy DNC backfill is idempotent by org and phone", async () => {
  const client = makeSmsConsentClient({
    leads: [
      { id: "lead_1", orgId: "org_1", customerId: "customer_1", phoneE164: "+12533300042", status: "DNC" },
      { id: "lead_2", orgId: "org_1", customerId: "customer_2", phoneE164: "+12533300042", status: "DNC" },
      { id: "lead_3", orgId: "org_2", customerId: "customer_3", phoneE164: "+12533300042", status: "DNC" },
      { id: "lead_4", orgId: "org_1", customerId: "customer_4", phoneE164: "+12533300099", status: "FOLLOW_UP" },
    ],
  });

  const first = await backfillSmsConsentFromLegacyDnc({ client, batchSize: 2 });
  const second = await backfillSmsConsentFromLegacyDnc({ client, batchSize: 2 });

  assert.equal(first.candidates, 2);
  assert.equal(first.created, 2);
  assert.equal(first.updated, 0);
  assert.equal(second.candidates, 2);
  assert.equal(second.created, 0);
  assert.equal(second.updated, 2);
  assert.equal(client.records.size, 2);
});

test("same phone can have different SMS consent per org", async () => {
  const client = makeSmsConsentClient({
    consents: [
      {
        orgId: "org_1",
        phoneE164: "+12533300042",
        status: "OPTED_OUT",
        source: "TWILIO_STOP",
      },
      {
        orgId: "org_2",
        phoneE164: "+12533300042",
        status: "OPTED_IN",
        source: "TWILIO_START",
      },
    ],
  });

  const orgOne = await getSmsConsentState({ client, orgId: "org_1", phoneE164: "+12533300042" });
  const orgTwo = await getSmsConsentState({ client, orgId: "org_2", phoneE164: "+12533300042" });

  assert.equal(orgOne.status, "OPTED_OUT");
  assert.equal(orgTwo.status, "OPTED_IN");
});
