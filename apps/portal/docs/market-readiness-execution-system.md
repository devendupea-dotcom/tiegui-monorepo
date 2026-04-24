# TieGui Portal Market Readiness Execution System

## Objective

Ship an honest, sellable `portal` V1 that can support paying customers without founder-only explanations for the core workflow.

This plan is not about building every feature in the repo. It is about:

- removing misleading product claims
- making one core contractor workflow clean and reliable
- exposing hidden setup dependencies
- deferring expansion work until the sellable core is trustworthy

## Launch SKU

### What we can sell in the first honest release

- Leads / CRM pipeline
- Shared inbox for calls and SMS
- Scheduling / calendar
- Estimates with approval links
- Dispatch + job tracking links
- Invoices with manual payment logging
- Google Calendar sync
- Outlook-based outbound email sends
- AI field notes as a beta add-on

### What we should not promise in the first paid release

- Full customer portal
- Online payments
- Self-serve Twilio automations
- Deep live Jobber / QuickBooks sync
- AI automation as a core workflow promise

## Non-Negotiable Rules

1. Truth before polish.
   If the UI implies a capability that is not operationally live, the UI is wrong.

2. Naming before expansion.
   If users cannot tell the difference between leads, jobs, dispatch, and invoices, adding features makes the product worse.

3. One golden path before side quests.
   We will first make one end-to-end contractor workflow great before expanding portal surface area.

4. No hidden setup dependencies.
   Customer-facing settings must not look active unless required HQ config, env vars, webhooks, cron jobs, and provider state are all ready.

5. Every task needs proof.
   A task is not done when code exists. It is done when the workflow is verified and the product tells the truth.

6. Beta is allowed. Ambiguity is not.
   A feature can be marked beta. It cannot silently half-work.

## Board System

### Priority levels

- `P0`: must fix before charging real customers
- `P1`: should fix for a clean sellable V1
- `P2`: expansion work after V1 is stable

### Status columns

- `Audit`
- `Ready`
- `In Build`
- `In Verify`
- `Shipped`
- `Deferred`

### Task template

Every task should answer these:

- `Problem`: what is wrong
- `Customer impact`: what a user sees or misunderstands
- `Surfaces`: routes and pages affected
- `Backend`: modules and APIs affected
- `Dependencies`: what must be live for this to work
- `Acceptance`: exact behavior that must be true
- `Proof`: test coverage, manual QA path, and screenshots or notes

## Milestones

## M0: Honest Beta

Goal: stop overselling and remove product confusion.

Exit criteria:

- `/app/jobs` is clearly positioned as leads / pipeline
- structured jobs are clearly separated from CRM leads
- "customer portal" language is removed or narrowed to public links
- invoice/payment language clearly states manual payment logging
- Twilio automation controls are gated by readiness
- the launch SKU is reflected in product copy and internal positioning

## M1: Sellable V1

Goal: the main contractor workflow is clean, reliable, and demo-safe.

Golden path:

1. create lead
2. respond from inbox
3. create estimate
4. send or share estimate
5. customer approves
6. schedule work
7. send dispatch update / tracking link
8. send invoice
9. record payment

Exit criteria:

- every step has a clear entry point in the UI
- every state transition is reflected consistently across CRM, calendar, dispatch, and invoices
- dependencies are surfaced before a user hits a dead end
- core errors are actionable instead of generic
- the path is manually verified end-to-end

## M2: Expansion

Goal: turn the solid core into a more complete platform.

Candidate scope:

- online payments
- real customer accounts
- self-serve team admin
- deeper Jobber / QuickBooks workflows
- AI-assisted automation productization

## Workstreams

## 1. Product Truth + Information Architecture

Outcome:

- the app names things the way users think about them
- the nav matches the actual workflow
- the product only claims what it can really do

Primary files:

- `apps/portal/app/app/client-portal-nav.tsx`
- `apps/portal/app/app/layout.tsx`
- `apps/portal/app/app/jobs/page.tsx`
- `apps/portal/app/app/jobs/records/page.tsx`
- `apps/portal/app/app/leads/[leadId]/page.tsx`
- `apps/portal/app/app/messages/page.tsx`
- `apps/portal/README.md`

P0 tasks:

- rename or relabel the CRM "Jobs" surface as leads / pipeline
- make structured jobs clearly operational jobs
- remove broad "customer portal" language from public-link features
- mark payments as manual everywhere relevant
- hide or relabel any self-serve integration claims that are no longer true

## 2. Golden Path UX

Outcome:

- one clean contractor workflow from lead to payment

Primary files:

- `apps/portal/app/app/inbox/unified-inbox.tsx`
- `apps/portal/app/app/jobs/[jobId]/page.tsx`
- `apps/portal/app/app/estimates/estimate-manager.tsx`
- `apps/portal/app/api/estimates/[estimateId]/send/route.ts`
- `apps/portal/app/estimate/[token]/customer-estimate-view.tsx`
- `apps/portal/app/app/calendar/premium-job-calendar.tsx`
- `apps/portal/app/app/dispatch/dispatch-manager.tsx`
- `apps/portal/app/app/invoices/[invoiceId]/page.tsx`
- `apps/portal/app/api/invoices/[invoiceId]/send/route.ts`

P0 tasks:

- remove dead-end states across the lead -> estimate -> schedule -> invoice path
- make send/share/approve/schedule transitions obvious in the UI
- ensure invoice status and payment state are explained clearly
- add product-level empty states and next actions for each step

## 3. Messaging + Twilio Activation

Outcome:

- messaging behaves truthfully and reliably
- automation only appears active when it is actually live

Primary files:

- `apps/portal/lib/sms.ts`
- `apps/portal/app/api/inbox/send/route.ts`
- `apps/portal/app/api/leads/[leadId]/messages/route.ts`
- `apps/portal/app/api/twilio/sms/inbound/route.ts`
- `apps/portal/app/api/twilio/voice/route.ts`
- `apps/portal/app/api/webhooks/twilio/after-call/route.ts`
- `apps/portal/app/api/cron/intake/route.ts`
- `apps/portal/app/api/cron/ghost-buster/route.ts`
- `apps/portal/app/app/settings/page.tsx`
- `apps/portal/app/hq/orgs/[orgId]/twilio/page.tsx`

P0 tasks:

- define one truthful outbound SMS behavior
- surface Twilio readiness in the customer-facing app
- block or warn on automation settings when HQ config is incomplete
- surface cron / webhook / provider health in a way operators can understand
- remove any "looks live but is not live" states

## 4. Team Admin + Permissions Productization

Outcome:

- the existing permission model is manageable by real customers

Primary files:

- `apps/portal/lib/app-api-permissions.ts`
- `apps/portal/lib/app-api-org-access.ts`
- `apps/portal/lib/user-provisioning.ts`
- `apps/portal/lib/workspace-users.ts`
- `apps/portal/app/app/onboarding/page.tsx`
- `apps/portal/app/app/onboarding/onboarding-team-builder.tsx`
- `apps/portal/app/app/settings/page.tsx`

P0 tasks:

- build a real Settings -> Team page
- support invite, role change, deactivate, and roster visibility
- align onboarding promises with the post-onboarding product

## 5. Payments + Customer Experience

Outcome:

- invoicing is clearly shippable now
- payments are either implemented for real or deliberately framed as manual

Primary files:

- `apps/portal/app/app/invoices/page.tsx`
- `apps/portal/app/app/invoices/[invoiceId]/page.tsx`
- `apps/portal/app/api/invoices/[invoiceId]/pdf/route.ts`
- `apps/portal/app/api/invoices/[invoiceId]/send/route.ts`
- `apps/portal/app/track/[token]/page.tsx`

P0 tasks:

- make manual payment handling explicit in copy
- tighten invoice send prerequisites and operator feedback
- decide whether online payments are a V1 blocker or a V2 milestone

P1 tasks:

- add real online payment collection
- extend the public customer experience beyond links

## 6. Reporting + Operational Health

Outcome:

- the dashboard is useful for operators and honest about system readiness

Primary files:

- `apps/portal/app/app/page.tsx`
- `apps/portal/app/app/owner-command-center.tsx`
- `apps/portal/app/app/worker-ops-dashboard.tsx`
- `apps/portal/app/app/today/page.tsx`
- `apps/portal/app/api/analytics/summary/route.ts`
- `apps/portal/app/app/analytics/ads/page.tsx`
- `apps/portal/app/app/settings/integrations/page.tsx`

P1 tasks:

- add clearer readiness and exception reporting
- keep dashboard metrics tied to real operational actions
- add deeper financial and team reporting only after M1 is stable

## 7. AI + Integration Cleanup

Outcome:

- AI and integrations support the product without overpromising

Primary files:

- `apps/portal/app/app/field-notes/field-notes-scanner.tsx`
- `apps/portal/app/api/ai/parse-field-notes/route.ts`
- `apps/portal/app/api/ai/field-notes/save/route.ts`
- `apps/portal/app/api/transcribe/route.ts`
- `apps/portal/lib/conversational-sms.ts`
- `apps/portal/lib/conversational-sms-llm.ts`
- `apps/portal/app/app/settings/integrations/page.tsx`
- `apps/portal/app/api/integrations/import/route.ts`
- `apps/portal/app/api/integrations/sync/route.ts`

P1 tasks:

- make AI field notes save paths align with real product entities
- clean up the lead/job terminology in voice-note transcription
- keep Jobber / QBO honest: either productize them or keep them explicitly secondary to CSV import

## First Execution Tranche

These are the first tasks to build in order.

### Tranche 1: Product truth cleanup

- `P0` relabel CRM surfaces so users understand leads vs jobs
- `P0` relabel customer-facing public links so they are not sold as a full portal
- `P0` relabel invoice/payment copy as manual where appropriate
- `P0` remove misleading integration and automation claims from visible UI

### Tranche 2: Readiness gating

- `P0` add a single readiness model for Twilio automation
- `P0` surface readiness banners in settings, inbox, and dispatch
- `P0` unify SMS send behavior so operators get one truth

### Tranche 3: Golden path cleanup

- `P0` tighten lead detail next actions
- `P0` tighten estimate send / approval / convert flow
- `P0` tighten schedule -> dispatch -> tracking flow
- `P0` tighten invoice send -> payment logging flow

### Tranche 4: Team admin

- `P0` create a real Team settings surface
- `P0` align onboarding and post-onboarding user management

## Release Gates

We do not call the app market-ready until all of these are true.

### Gate A: Product truth

- no misleading nav labels
- no misleading payment claims
- no misleading customer-portal claims
- no self-serve implication where setup is internal-only

### Gate B: Workflow reliability

- golden path verified manually
- no silent dead ends
- all major failure states have actionable copy

### Gate C: Operational readiness

- Twilio, cron, and provider dependencies are visible
- operators can tell whether automation is live
- integration failures surface clearly

### Gate D: Team usability

- a customer admin can manage their own team

## Weekly Rhythm

### Monday

- choose one tranche
- define exact acceptance criteria
- confirm dependencies and file scope

### During build

- keep work inside the tranche
- update or add tests for behavioral changes
- verify copy and logic together

### Friday

- run lint, tests, and targeted manual QA
- compare shipped behavior to launch SKU
- move anything ambiguous back out of the release

## Definition of Done

A task is done only when:

- the code path works
- the UI tells the truth
- tests cover the behavior when practical
- manual QA confirms the visible workflow
- no contradictory copy remains elsewhere in the app

## Immediate Recommendation

Start with `M0 Honest Beta`, not online payments or customer accounts.

The first real implementation batch should be:

1. product truth + IA cleanup
2. Twilio readiness gating
3. golden path cleanup
4. real Team management

That sequence gets the app from "impressive but uneven" to "honest and sellable" fastest.
