import assert from "node:assert/strict";
import test from "node:test";
import { canSendSms } from "../lib/sms-outbound-compliance.ts";

function clone(value) {
  return value ? { ...value } : value;
}

function makeComplianceClient({ consents = [], leads = [] } = {}) {
  const consentRecords = new Map();

  function consentKey(orgId, phoneE164) {
    return `${orgId}:${phoneE164}`;
  }

  for (const consent of consents) {
    consentRecords.set(consentKey(consent.orgId, consent.phoneE164), {
      id: consent.id || `${consent.orgId}_${consent.phoneE164}`,
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
      lastUpdatedAt: consent.lastUpdatedAt || new Date("2026-05-04T12:00:00.000Z"),
      createdAt: consent.createdAt || new Date("2026-05-04T12:00:00.000Z"),
      updatedAt: consent.updatedAt || new Date("2026-05-04T12:00:00.000Z"),
      metadataJson: consent.metadataJson || null,
    });
  }

  return {
    smsConsent: {
      async findUnique(args) {
        const lookup = args.where.orgId_phoneE164;
        return clone(consentRecords.get(consentKey(lookup.orgId, lookup.phoneE164)) || null);
      },
    },
    lead: {
      async findFirst(args) {
        return (
          leads.find((lead) => {
            const where = args.where || {};
            if (where.id && lead.id !== where.id) return false;
            if (where.orgId && lead.orgId !== where.orgId) return false;
            if (where.phoneE164 && lead.phoneE164 !== where.phoneE164) return false;
            if (where.status && lead.status !== where.status) return false;
            return true;
          }) || null
        );
      },
    },
  };
}

test("customer SMS is blocked until explicit opt-in exists", async () => {
  const decision = await canSendSms({
    client: makeComplianceClient(),
    orgId: "org_1",
    toNumberE164: "+12533300042",
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "MISSING_EXPLICIT_OPT_IN");
});

test("customer SMS is allowed with accepted explicit opt-in source", async () => {
  const decision = await canSendSms({
    client: makeComplianceClient({
      consents: [
        {
          orgId: "org_1",
          phoneE164: "+12533300042",
          status: "OPTED_IN",
          source: "TWILIO_START",
        },
      ],
    }),
    orgId: "org_1",
    toNumberE164: "+12533300042",
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.code, "CUSTOMER_EXPLICITLY_OPTED_IN");
});

test("customer SMS blocks unsupported system-created opt-in records", async () => {
  const decision = await canSendSms({
    client: makeComplianceClient({
      consents: [
        {
          orgId: "org_1",
          phoneE164: "+12533300042",
          status: "OPTED_IN",
          source: "SYSTEM",
        },
      ],
    }),
    orgId: "org_1",
    toNumberE164: "+12533300042",
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "UNSUPPORTED_OPT_IN_SOURCE");
});

test("explicit opt-in restores sends when a legacy lead is DNC", async () => {
  const decision = await canSendSms({
    client: makeComplianceClient({
      consents: [
        {
          orgId: "org_1",
          phoneE164: "+12533300042",
          status: "OPTED_IN",
          source: "MANUAL",
        },
      ],
      leads: [
        {
          id: "lead_1",
          orgId: "org_1",
          phoneE164: "+12533300042",
          status: "DNC",
        },
      ],
    }),
    orgId: "org_1",
    toNumberE164: "+12533300042",
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.code, "CUSTOMER_EXPLICITLY_OPTED_IN");
});

test("legacy DNC still blocks without explicit opt-in", async () => {
  const decision = await canSendSms({
    client: makeComplianceClient({
      leads: [
        {
          id: "lead_1",
          orgId: "org_1",
          phoneE164: "+12533300042",
          status: "DNC",
        },
      ],
    }),
    orgId: "org_1",
    toNumberE164: "+12533300042",
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "LEGACY_LEAD_DNC");
});

test("marketing SMS is blocked until written promotional consent is modeled", async () => {
  const decision = await canSendSms({
    client: makeComplianceClient({
      consents: [
        {
          orgId: "org_1",
          phoneE164: "+12533300042",
          status: "OPTED_IN",
          source: "TWILIO_START",
        },
      ],
    }),
    orgId: "org_1",
    toNumberE164: "+12533300042",
    useCase: "MARKETING",
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "MARKETING_REQUIRES_WRITTEN_CONSENT");
});

test("internal org alerts and test messages do not require customer SMS consent", async () => {
  const internalAlert = await canSendSms({
    client: makeComplianceClient(),
    orgId: "org_1",
    toNumberE164: "+12533300042",
    audience: "INTERNAL_ORG",
    useCase: "INTERNAL_ALERT",
  });
  const testMessage = await canSendSms({
    client: makeComplianceClient(),
    orgId: "org_1",
    toNumberE164: "+12533300042",
    audience: "INTERNAL_TEST",
    useCase: "TEST",
  });

  assert.equal(internalAlert.allowed, true);
  assert.equal(internalAlert.code, "INTERNAL_ORG_MESSAGE");
  assert.equal(testMessage.allowed, true);
  assert.equal(testMessage.code, "INTERNAL_TEST_MESSAGE");
});
