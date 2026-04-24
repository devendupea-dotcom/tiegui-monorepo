# Golden Path Revenue QA

## Scope

This QA path verifies the sellable revenue loop:

1. owner creates a lead
2. owner creates and shares a customer-facing estimate
3. customer approves the estimate from the public link
4. owner schedules the job
5. owner converts the approved estimate into an invoice tied to the scheduled operational job
6. payment is recorded
7. lead, invoice, and collections reporting surfaces reflect the paid state

## Automated Smoke Coverage

`apps/portal/scripts/smoke-portal.ts` now includes:

- authenticated owner/client session
- created lead
- sent estimate with a line item
- generated public estimate share link
- public estimate page render check
- public approval API check
- calendar scheduling check
- approved estimate to invoice conversion check
- paid invoice recomputation check
- lead workspace paid-state check
- invoice detail paid-state check
- invoices workspace owner collections report check
- cleanup for created lead, estimate, job, event, invoice, customer, photos, worker, and Twilio smoke data

Run it only against a staging or disposable environment:

```bash
BASE_URL=https://staging-app.example.com npm run smoke:portal --workspace=portal
```

The script mutates data while it runs. It is designed to clean up after itself, but it should not be pointed at production without an explicit release decision.

## Manual Demo Pass

Use this as the human demo check after the automated smoke passes:

1. Open `/app` as an owner and confirm the command center loads.
2. Create a lead from the owner workflow.
3. Create an estimate for that lead with at least one line item and a positive total.
4. Generate/open the customer estimate link and approve it as the customer.
5. Confirm the owner app now presents the estimate as approved and ready to schedule.
6. Schedule the job from calendar.
7. Convert the approved estimate into an invoice.
8. Open the invoice and verify payment status, pay-link readiness, and manual payment fallback copy.
9. Record a payment or complete a staging Stripe payment.
10. Confirm `/app/jobs/[leadId]`, `/app/invoices/[invoiceId]`, and `/app/invoices` all show the paid/recovered state clearly.

## Go/No-Go

Go:

- smoke script passes against staging
- customer estimate approval works from the public link
- scheduled job and converted invoice link to the same lead/job context
- paid invoice has zero balance due
- collections report shows recovered activity without claiming automation caused payment

No-go:

- estimate link cannot be opened publicly
- approval does not update owner workflow state
- conversion creates an invoice detached from the scheduled operational job
- paid invoice still appears as open or at risk
- owner collections reporting is missing or misleading
