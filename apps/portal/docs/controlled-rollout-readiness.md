# Controlled Rollout Readiness

This checklist is for adding customers #2 through #5 to the controlled TieGui pilot. It is not a self-serve launch process.

## Scope

- Controlled customers only.
- One named owner/admin per org before launch.
- Live SMS only after Twilio config, A2P, consent, inbound, outbound, and callback smoke pass.
- Website lead intake only when the customer website is connected and a signed WebsiteLeadSource exists.
- Stripe/billing remains manual or limited unless the org has a complete Stripe connection.
- No Meta or Instagram work is included in this rollout.

## HQ Readiness View

Use `/hq/businesses/[orgId]` and review the Controlled Rollout Readiness card.

The card must show:

- zero blocking items before launch
- active owner/admin membership
- worker/read-only roles scoped to the org
- Twilio config ACTIVE with sender, account, and Messaging Service masked
- runtime SMS gates enabled
- manual outbound smoke within the launch window
- inbound reply smoke within the launch window
- delivery callback smoke within the launch window
- STOP and START/UNSTOP smoke within the launch window
- no failed SMS, unmatched callbacks, or overdue queued SMS unless explicitly accepted
- SMS debug link available after smoke traffic exists
- billing mode documented as Stripe-connected or manual/limited

For a CLI-safe report:

```bash
npm run report:rollout-readiness --workspace=portal -- --org-id <org-id>
```

For a deployed database:

```bash
PRISMA_ENV_FILE=/secure/path/portal-target.env npm run report:rollout-readiness --workspace=portal -- --org-id <org-id>
```

Do not paste secrets, auth tokens, reset tokens, or full customer SMS bodies into support notes.

## Per-Customer Onboarding Checklist

Run this checklist for each controlled customer.

1. Create or confirm the org.
   - Confirm legal/customer name, portal vertical, timezone, owner email, customer phone, and launch scope.
   - Confirm the org appears in `/hq/businesses`.

2. Create owner/admin access.
   - Ensure at least one active OWNER or ADMIN organization membership.
   - Use normal reset/access flow.
   - Do not share reset tokens in logs or tickets.

3. Scope worker/read-only users.
   - Workers should be WORKER.
   - Observers should be READ_ONLY.
   - Customer staff should not receive broad internal/HQ access.

4. Configure Twilio only after A2P is ready.
   - Confirm org Twilio config is ACTIVE.
   - Confirm sender number and Messaging Service are correct.
   - Confirm `TWILIO_TOKEN_ENCRYPTION_KEY`, `TWILIO_SEND_ENABLED=true`, and `TWILIO_VALIDATE_SIGNATURE=true` in the target deployment.
   - Do not rotate the token encryption key during onboarding.

5. Configure website lead source only when website intake is connected.
   - Create an active WebsiteLeadSource.
   - Set the one-time plaintext secret only in the customer website server env.
   - Smoke a signed website lead submission.

6. Verify SMS consent.
   - Confirm legacy DNC backfill has run for the target DB.
   - Send/simulate STOP and verify `SmsConsent` becomes `OPTED_OUT`.
   - Confirm outbound send is blocked.
   - Send/simulate START or UNSTOP and verify `SmsConsent` becomes `OPTED_IN`.
   - Confirm explicit opt-in override behaves as intended.

7. Run SMS smoke.
   - Manual outbound SMS: one send, one Message, one CommunicationEvent, no duplicate.
   - Inbound reply: lands in correct org/thread.
   - Delivery callback: reconciles to the known provider SID.
   - Forged unsigned callback: rejects.
   - DNC/STOP blocked send: clear block, no Twilio send.

8. Review HQ diagnostics.
   - `/hq/messaging` shows no blockers.
   - `/hq/leads/[leadId]/sms-debug` loads for the smoke lead.
   - Phone numbers and provider SIDs are masked.
   - No raw webhook payloads, auth tokens, encrypted tokens, cookies, or full SMS bodies are displayed.

9. Document billing scope.
   - If Stripe is not fully enabled, tell the customer billing is manual/limited.
   - Do not present broad self-serve billing until Stripe is ready.

10. Monitor the first 3 business days.
    - Check failed SMS.
    - Check unmatched and recovered callbacks.
    - Check STOP/START and DNC events.
    - Record any Twilio 30006 or 30007 failures.
    - Do not retry DNC/STOP recipients.

## Customer #2 Checklist

- Assign internal owner.
- Complete the per-customer onboarding checklist.
- Run `report:rollout-readiness` and save the safe summary.
- Run one live SMS smoke with consent.
- Monitor for 3 business days before adding customer #3.

## Customer #3 Checklist

- Confirm customer #2 had no unresolved failed SMS or unmatched callback blockers.
- Complete the per-customer onboarding checklist.
- Run `report:rollout-readiness` and save the safe summary.
- Run one live SMS smoke with consent.
- Monitor customer #2 and #3 together for 3 business days.

## Customer #4 Checklist

- Confirm customer #2 and #3 are stable under daily `/hq/messaging` review.
- Complete the per-customer onboarding checklist.
- Run `report:rollout-readiness` and save the safe summary.
- Run one live SMS smoke with consent.
- Monitor all controlled customers daily for 3 business days.

## Customer #5 Checklist

- Confirm no open production SMS compliance blockers across customers #2 through #4.
- Complete the per-customer onboarding checklist.
- Run `report:rollout-readiness` and save the safe summary.
- Run one live SMS smoke with consent.
- Review whether support load is acceptable before any broader launch discussion.

## Stop Conditions

Stop adding customers if any of these happen:

- token encryption key missing
- Twilio send disabled in a target environment expected to send live SMS
- signature validation disabled
- org Twilio config not ACTIVE
- no active owner/admin
- STOP does not block outbound
- START/UNSTOP does not restore explicit consent as intended
- delivery callbacks do not reconcile
- unmatched callbacks appear for a known smoke SID
- failed SMS count grows without classification
- support/debug pages expose unmasked PII or secrets

## Final Launch Note

Passing this checklist means TieGui is ready for a controlled 3-5 customer rollout. It does not approve broad self-serve production, Meta/Instagram launch, or automated resend/retry behavior.
