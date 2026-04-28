# TieGui Portal 5.5 Handoff

## Purpose

This is the safe handoff document for moving the current market-readiness work into a new chat or model session without depending on raw chat history.

Use this together with the saved Cards entries in `TieGui Solutions`.

## Current Product Position

The app is materially ahead of the original `M0 Honest Beta` plan.

These are now real in the product:

- product truth cleanup across leads vs jobs and manual payment language
- Twilio readiness gating and honest messaging states
- messaging health surfacing
- spam review lane for likely junk leads
- slower follow-up cadence
- real team management in Settings
- Stripe Connect per org
- recurring billing foundation
- one-time Stripe invoice pay links
- invoice reminder workflow
- invoice collections rules, queue, automation, audit, escalation, aging, recovery, export, and activity drill-down

What is still not a finished sellable promise:

- full customer portal with customer accounts
- deeper owner-facing reporting and collections analytics
- full self-serve Twilio activation
- AI productization beyond assisted features
- deeper Jobber / QuickBooks productization

## What Has Been Shipped

### 1. Product Truth + IA

- `/app/jobs` was clarified to behave as leads / pipeline.
- structured operational jobs were separated more clearly.
- invoice/payment copy was made honest before online payments existed.
- customer portal language was narrowed away from implying full authenticated accounts.

### 2. Messaging + Twilio

- added one readiness model for Twilio activation
- unified live send behavior across inbox and lead detail
- blocked fake-live states
- added messaging automation health
- added spam review lane to keep failed-send junk out of the real pipeline
- slowed automated follow-up cadence

### 3. Team Admin

- `Settings -> Team` is now a real surface
- add member
- role changes
- suspend / reactivate
- pending setup visibility
- fallback setup-link behavior
- last-owner protection

### 4. Stripe + Billing Foundation

- Stripe Connect per org
- recurring service plans
- Stripe-hosted recurring checkout
- Stripe webhook sync
- one-time invoice pay links
- invoice email includes hosted pay link when Stripe is ready
- failed-payment recovery behavior

### 5. Billing + Collections

- reminder workflow from invoice detail
- reminder actions from invoice list
- collections summary in invoice list
- org-level collections cadence settings
- collections queue states
- collections automation cron
- collections audit trail
- escalation thresholds
- aging buckets
- filtered collections CSV export
- one-click fresh-link recovery from invoice queue
- per-invoice collections activity drill-down

## Saved Cards Trail

These are already saved in `TieGui Solutions -> Finance & Admin -> Billing & Collections`:

- `2026-04-23 Billing & Collections Tranche`
- `2026-04-23 Invoice Collections Recovery Tranche`
- `2026-04-23 Collections Rules & Queue Tranche`
- `2026-04-23 Collections Automation & Audit Tranche`
- `2026-04-23 Collections Escalation & Aging Tranche`
- `2026-04-23 Collections Recovery & Export Tranche`
- `2026-04-23 Collections Activity Drill-Down Tranche`

The original execution plan also exists at:

- [market-readiness-execution-system.md](/Users/devendupea/Documents/Coding/tiegui-monorepo/apps/portal/docs/market-readiness-execution-system.md)

## Best Next Moves

### Immediate next tranche

Build owner-facing collections reporting.

That should include:

- aging value by escalation stage
- recent failed collections attempts
- manual vs automation performance
- totals for recovered vs still-at-risk balances
- reporting surfaces that help an owner manage collections, not just operate reminders

### After that

- end-to-end golden-path manual QA from lead -> estimate -> approval -> schedule -> dispatch -> invoice -> payment
- customer portal / account strategy decision
- AI field-notes and transcription entity cleanup
- integration strategy cleanup for Jobber / QuickBooks

## Deployment / Environment Notes

### Stripe

Required for live billing:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- optional `STRIPE_REDIRECT_URI`

Stripe webhook should include:

- `account.updated`
- `checkout.session.completed`
- `invoice.paid`
- `invoice.payment_failed`
- `payment_intent.payment_failed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

### Collections automation

Required for automated collections sends:

- scheduler hitting `/api/cron/invoice-collections`
- `Authorization: Bearer CRON_SECRET`

### Twilio

Customer-facing messaging truth is now much better, but live behavior still depends on real Twilio setup, webhook readiness, and deployment env.

## Verification Baseline

Latest verified state when this handoff was written:

- `npm run check-types --workspace=portal`
- `npm run test --workspace=portal`
- `314/314` passing
- `npm run build --workspace=portal`

Known existing warning:

- Sentry / OpenTelemetry `require-in-the-middle` build warning
- this was not introduced by the recent market-readiness work

## Safe Transfer Protocol

Do not rely on moving the raw chat alone.

The safest move is:

1. Start the new 5.5 chat.
2. Give it this doc first.
3. Point it at the execution-system doc.
4. Tell it to treat the saved Cards as the billing implementation log.
5. Tell it the next tranche is owner-facing collections reporting unless you want to reprioritize.

## Bootstrap Prompt For The New Chat

Paste this into the new chat:

```text
Work from these two docs first:

- apps/portal/docs/market-readiness-handoff-2026-04-23.md
- apps/portal/docs/market-readiness-execution-system.md

Also treat the saved Cards in TieGui Solutions -> Finance & Admin -> Billing & Collections as the billing implementation log for 2026-04-23.

Current state:
- Product truth cleanup is done
- Twilio readiness gating and messaging truth work are done
- Team management is real
- Stripe Connect, recurring billing, one-time pay links, and collections workflows are real
- The latest completed tranche is collections activity drill-down on invoice detail plus richer collections export context

Next best move unless I override it:
- build owner-facing collections reporting on top of the new collections activity and export data

Before changing direction, summarize:
1. what is already shipped
2. what is still open
3. the exact next tranche you recommend
```

## If You Want Zero-Risk Transfer

Use all three:

- this repo doc
- the Cards entries
- the bootstrap prompt above

That is much safer than trusting a long chat window to carry all implementation detail forward.
