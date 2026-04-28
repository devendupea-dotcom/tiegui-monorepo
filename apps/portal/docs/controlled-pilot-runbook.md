# Controlled Production Pilot Runbook

## Pilot Scope

- Customer: Velocity Landscapes LLC.
- Pilot operator: Cesar / Velocity team only.
- Production portal: `https://app.tieguisolutions.com`.
- Internal monitor: `/hq/messaging`.
- This pilot covers manual SMS reliability, inbound SMS routing, delivery status callbacks, DNC/STOP handling, and HQ monitoring.
- No Meta, Instagram, website lead intake changes, self-serve signup, or broad customer rollout are included in this pilot.

## What Is Live

- Manual outbound SMS from Velocity lead/inbox threads.
- Client mutation idempotency on manual SMS sends.
- Inbound SMS webhook handling for Velocity's configured Twilio subaccount.
- Delivery status callback reconciliation.
- DNC/STOP blocked-send protection.
- HQ Messaging Command Center monitoring.

## What Is Not Live

- Broad self-serve production onboarding.
- Meta or Instagram messaging.
- Stripe/payment workflows unless separately approved.
- New organizations using live SMS without their own readiness gate.
- Twilio/A2P changes outside the already active Velocity config.

Customers that do not want Twilio can still use TieGui for leads, jobs, scheduling, estimates, invoices, files, website intake, and internal notes, but they are outside this SMS-controlled rollout readiness gate. Do not include SMS, missed-call recovery, text intake, or delivery receipts in that customer's launch scope until Twilio/A2P is intentionally approved and smoked.

## Preflight Checklist

Complete this before each pilot day:

- Confirm production deploy is `READY`.
- Confirm `/hq` loads as an INTERNAL user.
- Confirm `/hq/messaging` loads without 500.
- Confirm runtime SMS gates are green:
  - token encryption key present
  - send enabled
  - signature validation enabled
- Confirm Velocity Twilio config is `ACTIVE`.
- Confirm Velocity sender and messaging service are present and masked in HQ.
- Confirm production rate limit backend is present.
- Confirm `CRON_SECRET` is present.
- Confirm DB migrations are current.
- Confirm no Twilio auth token, encryption key, auth cookie, or webhook secret is visible in the UI or logs.

## Daily Monitoring Checklist

Check `/hq/messaging` at the start, middle, and end of each pilot day:

- Runtime gates stay green.
- Failed SMS rows have an understood failure label and operator action.
- Latest outbound SMS appears for Velocity.
- Latest inbound SMS appears for Velocity after replies.
- Status callback activity is current.
- Failed SMS count is understood and triaged.
- Unmatched callback count is not increasing.
- Recovered callback count is stable or explained.
- DNC count changes are expected.
- DNC/STOP leads are not retried.
- Overdue queue does not grow unexpectedly.
- Twilio 30006 and 30007 failures are recorded with the lead id and masked SID.
- Carrier filtering is escalated separately from bad or unreachable numbers.
- Cesar can send and receive normally.
- No secret material is displayed.

## Manual Outbound Verification

Use a consented test mobile number or a real Velocity customer thread approved by Cesar.

1. Open the Velocity lead or inbox conversation.
2. Send one short manual SMS.
3. Refresh the thread.
4. Confirm the UI shows the outbound message once.
5. Confirm the DB has exactly one `Message` row for the send.
6. Confirm the DB has exactly one matching `CommunicationEvent`.
7. Confirm the provider SID is recorded if Twilio accepted the send.
8. Confirm `/hq/messaging` reflects the outbound activity.

Record:

- lead id
- message id
- communication event id
- masked provider SID
- operator who sent it
- timestamp

## Idempotency Verification

Use the same send endpoint and same `Idempotency-Key`.

Expected result:

- the replay returns the stored response
- no 500
- no second Twilio send
- no duplicate `Message`
- no duplicate `CommunicationEvent`
- one `ClientMutationReceipt` with a stored response

If idempotency replay fails, stop live sending and classify as a code blocker. Collect the request route, idempotency key, message id, receipt id, response status, and server error reference before calling the issue fixed.

## Inbound Reply Verification

1. Reply from the test mobile number to Velocity's Twilio number.
2. Confirm webhook signature validation passes.
3. Confirm the inbound message appears in the correct Velocity inbox thread.
4. Confirm the message links to the expected lead, contact, organization, and conversation.
5. Confirm no duplicate or wrong-org conversation is created.
6. Confirm `/hq/messaging` shows latest inbound activity.

If a physical reply is not practical, use a signed Twilio webhook simulation with Velocity's org-specific Twilio token. Never print the token.

## Delivery Callback Verification

1. Wait for Twilio status callback after outbound send.
2. Confirm the callback reaches `/api/webhooks/twilio/sms/status`.
3. Confirm message status advances to the strongest provider state seen: `QUEUED`, `SENT`, `DELIVERED`, or `FAILED`.
4. Confirm `CommunicationEvent.providerStatus` is updated.
5. Confirm no unmatched callback remains for the known provider SID.

Record:

- provider SID, masked
- callback status
- message status
- communication event id
- unmatched callback ids, if any

## DNC/STOP Handling

Expected blocked-send behavior:

- manual send to a DNC/STOP lead returns clear 403 copy
- no Twilio send occurs
- no fake sent/delivered message is created
- no fake sent/delivered communication event is created
- queued automation for that lead remains blocked or canceled

If a customer replies `STOP`, verify SMS consent moves to `OPTED_OUT` and future outbound SMS is blocked until a valid opt-in path is completed.

## SMS Consent Model

SMS consent is tracked by organization and phone number in `SmsConsent`. This is separate from sales pipeline status so a lead can stay qualified, booked, or active while SMS consent is opted out.

Expected behavior:

- `STOP` records `SmsConsent.status = OPTED_OUT`, source `TWILIO_STOP`, the keyword, and a safe short body preview.
- `START` or `UNSTOP` records `SmsConsent.status = OPTED_IN`, source `TWILIO_START`, and does not force the lead into a sales pipeline stage.
- `HELP` does not change consent.
- Outbound manual and automated SMS checks `SmsConsent` first.
- Existing `Lead.status = DNC` still blocks outbound SMS as a legacy fallback unless the phone has an explicit `OPTED_IN` consent record.
- Consent is scoped to `orgId + phoneE164`, so the same phone number can have different consent state in different organizations.

Before texting, operators should check the lead SMS debug page for:

- SMS consent status
- consent source
- last STOP/START keyword
- last updated time
- whether the legacy DNC fallback is still active

To backfill existing legacy DNC leads after the migration:

1. Preview the work:
   `npm run backfill:sms-consent --workspace=portal -- --dry-run`
2. Apply the backfill:
   `npm run backfill:sms-consent --workspace=portal`

The backfill is idempotent and creates at most one consent record per organization and phone number. It skips explicit `OPTED_IN` records.

## Twilio 30006 / Unreachable Number

Twilio 30006 means the destination is unreachable or not a usable mobile route.

Operator action:

- Do not blindly retry SMS.
- Mark the number as unreliable for SMS.
- Call the customer or ask Cesar for a corrected mobile number.
- Keep the failure evidence in the lead timeline.
- Confirm automation retry is blocked for permanent failures.

Evidence to collect:

- lead id
- message id
- masked provider SID
- provider status
- provider error code
- operator-facing failure label
- automation retry decision

## Unmatched Callback Handling

Unmatched callbacks can happen if Twilio posts a status before the local message transaction commits.

Expected behavior:

- the callback is logged as unmatched only temporarily
- once the matching message exists, reconciliation links it to the message, lead, contact, and conversation
- the diagnostic is reclassified as recovered

If unmatched count increases and does not recover:

1. Search by masked provider SID.
2. Confirm whether a `Message` exists for that SID.
3. Confirm `sms-status-reconciliation` ran after the message commit.
4. Collect unmatched callback ids.
5. Stop calling the issue fixed until the unmatched count is stable or recovered.

## Token Encryption Key Missing

If the UI or API reports that the Twilio token encryption key is missing:

- Stop live SMS validation immediately.
- Do not generate a new key.
- Confirm `TWILIO_TOKEN_ENCRYPTION_KEY` is present in the target Vercel environment.
- Confirm the key can decrypt the existing `OrganizationTwilioConfig`.
- If the key cannot decrypt the stored config, treat it as an environment/configuration blocker.

Owner to fix: Vercel env owner, with the original encryption key lineage.

## Forged Webhook Check

Before launch and after any Twilio env change:

- Send an unsigned Twilio-style status callback to production.
- Expected response: rejected with 403 or fail-closed error.
- Expected DB change: zero messages and zero communication events for that fake SID.

If unsigned traffic is accepted in production, stop launch and classify as a code/security blocker.

## Rollback Plan

Use rollback if duplicates, forged webhook acceptance, wrong-org inbound routing, or unrecovered callback growth appears in production.

1. Pause pilot communication with Cesar.
2. Disable live outbound sends for the affected environment or org using the approved env/config path.
3. Preserve evidence before cleanup.
4. Revert the production deployment to the last known-good portal deployment if the issue is code-related.
5. Keep Velocity Twilio config intact unless the failure is proven to be config-specific.
6. Do not rotate `TWILIO_TOKEN_ENCRYPTION_KEY` unless explicitly approved with a re-encryption plan.
7. Re-run staging gate before re-enabling production pilot.

## Evidence Required Before Calling A Failure Fixed

Collect all applicable evidence:

- production deployment URL and commit
- org id
- lead id
- message id
- communication event id
- client mutation receipt id
- masked provider SID
- provider status and error code
- unmatched callback ids
- HTTP status and response summary
- screenshot or copied text from `/hq/messaging`
- timestamp and operator

Do not include auth cookies, Twilio auth tokens, source secrets, Vercel env values, reset tokens, or full customer phone numbers in reports.

## Expanding To 3-5 Controlled Customers

Before adding customer #2, #3, #4, or #5, use the controlled rollout readiness pass in `apps/portal/docs/controlled-rollout-readiness.md`.

Required operator steps:

- open `/hq/businesses/[orgId]` and confirm the Controlled Rollout Readiness card has zero blockers
- run `npm run report:rollout-readiness --workspace=portal -- --org-id <org-id>` against the target DB
- complete one manual outbound, inbound reply, delivery callback, STOP, and START/UNSTOP smoke
- confirm `/hq/messaging` has no unresolved failed SMS, unmatched callbacks, or overdue queue blockers
- confirm `/hq/leads/[leadId]/sms-debug` is safe and masked for the smoke lead
- document Stripe/billing as manual/limited unless the org has a complete Stripe connection

This readiness pass does not approve broad self-serve production, Meta/Instagram, or automated resend/retry behavior.
