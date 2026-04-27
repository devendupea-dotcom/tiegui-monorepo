# TieGui Portal

The portal is TieGui's internal operations app for leads, jobs, estimates, purchase orders, expenses, messaging, and integrations. It is built with Next.js App Router, Prisma, NextAuth, and a mix of Twilio, calendar, and storage integrations.

## Local Development

From the monorepo root:

```
npm run dev --workspace=portal
```

Open [http://localhost:3001](http://localhost:3001).

Useful commands:

```bash
npm run lint --workspace=portal
npm run check-types --workspace=portal
npm run test --workspace=portal
npm run build --workspace=portal
```

## Release Tooling

Run these before staging or production deploys:

```bash
npm run lint
npm run test
npm run build
npm run db:validate
```

Notes:

- `npm run lint` is the portal ship gate. It ignores generated files like `public/sw.js` and reports only blocking issues.
- `npm run lint:warnings` is the broader warning sweep when you want to pay down lint debt without blocking a release.
- Prisma tooling requires `DIRECT_URL` because the schema declares `directUrl = env("DIRECT_URL")`.
  - If you do not use a separate direct connection, set `DIRECT_URL` equal to `DATABASE_URL`.
  - Portal Prisma helper scripts now do this fallback automatically for local tooling.
- The build uses `NEXT_IGNORE_INCORRECT_LOCKFILE=1` intentionally.
  - The workspace lockfile already includes the portal SWC optional packages.
  - This suppresses a noisy Next.js workspace patch attempt instead of mutating `package-lock.json` during builds.

## Release Phases

Phase 1 ship target:

- Owner dashboard: `/app`
- Worker dashboard: `/app`
- Unified inbox: `/app/inbox`
- Settings + branding: `/app/settings`, `/app/settings/branding`, `/app/settings/integrations`
- Branded invoice PDFs: `/app/invoices/[invoiceId]`, `/api/invoices/[invoiceId]/pdf`
- Photo uploads: `/api/jobs/[jobId]/photos`, `/api/photos/[photoId]/signed-url`
- Integration readiness UI: `/app/settings/integrations`

Phase 2 reserved features:

- Twilio voice forwarding: `/api/webhooks/twilio/voice`
- After-call missed-call recovery: `/api/webhooks/twilio/after-call`
- Conversational SMS automation
- Cron-driven follow-ups: `POST /api/cron/intake`

Phase 1 note:

- `/app/settings` already exposes messaging copy, hours, quiet-hours, and template controls.
- Those settings are safe to ship in Phase 1, but live Twilio voice/SMS automation should stay off until the Phase 2 webhook + cron checklist below is completed.

## Estimates Module

The contractor estimates workflow is now centered on the `Estimate` data model and the `/app/estimates` portal surface.

Core models in [`prisma/schema.prisma`](./prisma/schema.prisma):

- `Estimate`
- `EstimateLineItem`
- `EstimateActivity`
- supporting linkage fields:
  - `Lead.latestEstimateId`
  - `Lead.estimateCount`
  - `Job.sourceEstimateId`
  - `Invoice.sourceEstimateId`
  - `Organization.estimatePrefix`
  - `Organization.estimateNextNumber`

Main API routes:

- `GET /api/estimates`
- `POST /api/estimates`
- `GET /api/estimates/[estimateId]`
- `PATCH /api/estimates/[estimateId]`
- `DELETE /api/estimates/[estimateId]`
- `POST /api/estimates/[estimateId]/items`
- `POST /api/estimates/[estimateId]/send`
- `POST /api/estimates/[estimateId]/convert`

Main UI entry points:

- `/app/estimates`
- `/app/estimates/[estimateId]`
- legacy redirects:
  - `/app/estimates/new`
  - `/portal/estimates`
  - `/portal/estimates/new`

Conversion flow:

1. Create or edit an estimate in `DRAFT`
2. Attach a lead when customer/job lineage should be preserved
3. Add material, custom material, and labor line items
4. Mark as `SENT` through the internal/manual share flow
5. Move to `APPROVED` once accepted
6. Convert the approved estimate into:
   - a structured job
   - a structured job plus invoice draft

Conversion guarantees:

- estimate totals are recomputed server-side before persistence
- only approved estimates can be converted
- converted jobs keep `Job.sourceEstimateId`
- converted invoice drafts keep `Invoice.sourceEstimateId`
- legacy `EstimateDraft` records are backfilled into `Estimate` so older draft links can redirect forward cleanly

## Customer Estimate Approval Module

Customer approval stays attached to the main Estimates module. `Estimate` remains the source of truth, and public access is granted only through tokenized share links.

Public customer route:

- `/estimate/[token]`

Internal share management routes:

- `POST /api/estimates/[estimateId]/share`
- `POST /api/estimates/[estimateId]/revoke-share`

Public token routes:

- `GET /api/estimate-share/[token]`
- `POST /api/estimate-share/[token]/view`
- `POST /api/estimate-share/[token]/approve`
- `POST /api/estimate-share/[token]/decline`

Schema additions:

- `Estimate.sharedAt`
- `Estimate.shareExpiresAt`
- `Estimate.customerViewedAt`
- `Estimate.customerDecisionAt`
- `Estimate.customerDecisionName`
- `Estimate.customerDecisionNote`
- `EstimateShareLink`

Token handling:

- raw share tokens are generated once and returned only at creation time
- storage uses `EstimateShareLink.tokenHash`, never the raw token
- public lookups hash the presented token and resolve against the stored hash
- revoked or expired links return public errors instead of silently exposing estimate data

Approval / decline behavior:

- customer views write `EstimateActivity`
- customer approval updates the existing `Estimate` to `APPROVED`
- customer decline updates the existing `Estimate` to `DECLINED`
- decision metadata stays on `Estimate` and `EstimateShareLink`
- guarded transaction updates prevent concurrent approve/decline requests from overwriting each other

Known v1 limitations:

- no customer login or customer account area
- no signatures, contracts, or payment flow
- no automatic email or SMS delivery; staff manually shares the generated link
- no auto-convert on approval
- internal staging smoke should still verify authenticated generate/revoke actions in `/app/estimates/[estimateId]`

## Job Costing Module

Job Costing is attached to structured jobs and does not create a second job system.

Main UI routes:

- `/app/jobs/records/costing`
- `/app/jobs/records/[jobId]/costing`

Main API routes:

- `GET /api/jobs/costing`
- `GET /api/jobs/[jobId]/costing`
- `PATCH /api/jobs/[jobId]/costing`
- `POST /api/jobs/[jobId]/costing/materials`
- `PATCH /api/jobs/[jobId]/costing/materials/[itemId]`
- `DELETE /api/jobs/[jobId]/costing/materials/[itemId]`
- `POST /api/jobs/[jobId]/costing/labor`
- `PATCH /api/jobs/[jobId]/costing/labor/[itemId]`
- `DELETE /api/jobs/[jobId]/costing/labor/[itemId]`

Schema additions:

- `Job.costingNotes`
- `JobMaterial.actualQuantity`
- `JobMaterial.actualUnitCost`
- `JobMaterial.actualTotal`
- `JobMaterial.varianceNotes`
- `JobLabor.actualHours`
- `JobLabor.actualHourlyCost`
- `JobLabor.actualTotal`
- `JobLabor.varianceNotes`
- `Invoice.sourceJobId`

Profitability calculation sources:

- quoted revenue comes from the job's linked source estimate when present
- invoiced revenue comes from invoices linked by `Invoice.sourceJobId`
- planned material cost comes from `JobMaterial.quantity * JobMaterial.cost`
- actual material cost comes from `JobMaterial.actualQuantity * JobMaterial.actualUnitCost`
- planned labor cost comes from `JobLabor.quantity * JobLabor.cost`
- actual labor cost comes from `JobLabor.actualHours * JobLabor.actualHourlyCost`
- gross profit and gross margin are computed server-side from those revenue and cost inputs

`Invoice.sourceJobId` usage:

- new invoice drafts created from approved estimates now store both `Invoice.sourceEstimateId` and `Invoice.sourceJobId`
- Job Costing uses `sourceJobId` to show invoiced revenue and linked invoice records without reinterpreting the older lead-oriented `Invoice.jobId`
- the migration backfills `sourceJobId` from existing `sourceEstimateId -> Estimate.jobId` links where possible

Current limitations / risk notes:

- Job Costing is job-level profitability only; it does not include payroll, scheduling, purchase orders, accounting sync, or full reporting
- profitability quality depends on users entering actual quantities, hours, and unit costs
- older invoices only appear automatically if they are linked through `sourceJobId` or can be backfilled from `sourceEstimateId`
- normal structured job edits now preserve actual costing data for retained rows, but deleting and recreating rows still loses that row-level actual history

## Phase 1 Staging Runbook

### Required env vars

Phase 1 baseline:

- `DATABASE_URL`
- `DIRECT_URL`
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `EMAIL_FROM`
- `SMTP_URL` or `EMAIL_SERVER`

Phase 1 storage, if object storage is enabled:

- `R2_ACCOUNT_ID` or `R2_ENDPOINT`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`

Phase 1 integrations readiness UI, only if those providers should connect in staging:

- `INTEGRATIONS_ENCRYPTION_KEY`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`, `MICROSOFT_REDIRECT_URI`
- `JOBBER_CLIENT_ID`, `JOBBER_CLIENT_SECRET`, `JOBBER_REDIRECT_URI`
- `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`

Billing + collections readiness, if Stripe pay links or recurring billing should work in staging:

- `STRIPE_SECRET_KEY`
- `STRIPE_CONNECT_CLIENT_ID`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_REDIRECT_URI` optional

Production rate limiting:

- Use either native Upstash REST env names:
  - `UPSTASH_REDIS_REST_URL`
  - `UPSTASH_REDIS_REST_TOKEN`
- Or Vercel KV REST env names:
  - `KV_REST_API_URL`
  - `KV_REST_API_TOKEN`
- Preview/production release preflight accepts either complete pair and fails if neither pair, or only a partial pair, is present. Vercel KV integrations may inject the `KV_REST_API_*` names automatically.

Phase 1 core-only release did not require Twilio activation. For the current customer go-live path,
run `npm run check:release-env --workspace=portal` and treat billing, collections cron, and Twilio
live-mode failures as release blockers.

Twilio and collections activation:

- `TWILIO_TOKEN_ENCRYPTION_KEY`
- `TWILIO_SEND_ENABLED`
- `TWILIO_VALIDATE_SIGNATURE`
- `TWILIO_SMS_COST_ESTIMATE_CENTS`
- `TWILIO_VOICE_AFTER_CALL_URL` optional
- `CRON_SECRET`

### Required migrations

1. `cd apps/portal`
2. Set `DIRECT_URL` to a direct DB connection. If no separate direct connection exists, set it equal to `DATABASE_URL`.
3. Run `npm run db:validate`
4. Run `npm run db:migrate:deploy`
5. Confirm the latest portal migrations are applied, especially for:
   - org messaging settings
   - invoice branding and invoice terms
   - inline photo fallback
   - analytics and marketing spend
   - Twilio voice config tables

### Required webhook setup

Phase 1 core release does not require production webhooks for dashboards, inbox manual reply, branding, invoice PDFs, photo uploads, or integrations readiness.

If you want Phase 2 endpoints pre-provisioned in staging before activation, set:

- Inbound SMS: `/api/webhooks/twilio/sms`
- Inbound voice: `/api/webhooks/twilio/voice`
- Voice dial status callback: `/api/webhooks/twilio/after-call`

Alias routes also exist:

- `/api/twilio/sms`
- `/api/twilio/sms/inbound`
- `/api/twilio/voice`
- `/api/twilio/voice/status`
- `/api/webhooks/twilio/voice/after-dial`

### Required cron setup

Phase 1 core release does not require cron.

For Phase 2 staging and later production activation, install a secured job that sends:

- `POST /api/cron/intake`
- `POST /api/cron/invoice-collections`
- Header: `Authorization: Bearer <CRON_SECRET>`

Do not rely on cron-driven missed-call intros or follow-ups until Twilio staging tests pass.

If the portal is deployed on a Vercel Hobby plan, Vercel's built-in cron limits are not sufficient for these frequent workers. Use an external scheduler instead. A production-safe default is Google Apps Script with Script Properties for `TIEGUI_CRON_SECRET` and these trigger cadences:

- every 5 minutes: `/api/cron/intake`, `/api/cron/integrations/refresh`, `/api/cron/google/sync`
- every 30 minutes: `/api/cron/ghost-buster`
- daily at 06:00: `/api/cron/invoice-assist`, `/api/cron/invoice-collections`

A ready-to-paste Apps Script template lives at `apps/portal/ops/google-apps-script/production-cron-scheduler.gs`.

### Manual staging checklist

1. Run migrations and confirm `npm run lint`, `npm run build`, and `npm run db:validate` pass in `apps/portal`.
2. Sign in as an owner/admin and open `/app`. Confirm the owner dashboard renders with KPI cards, lead lists, and upcoming work.
3. Sign in as a worker and open `/app`. Confirm the worker dashboard renders instead of the owner dashboard.
4. Open `/app/inbox`, load at least one conversation, and send a manual reply. Confirm the thread refreshes and the reply lands in the correct lead thread.
5. Open `/app/settings` and `/app/settings/branding`. Save business identity fields and upload a logo. Refresh and confirm the values persist.
6. Open a real invoice at `/app/invoices/[invoiceId]`. Test `Open PDF` and `Download PDF`, and confirm branding, totals, terms, and payment instructions render correctly.
7. Open `/app/jobs/[jobId]?tab=photos`, upload a real image, refresh, and confirm the image resolves correctly from R2 or inline fallback.
8. Open `/app/settings/integrations` and verify the readiness panel shows the correct configured/not-configured state for Google, Jobber, and QBO.
9. If staging Phase 2 setup, validate the Twilio webhook paths and run the missed-call and SMS automation tests listed below before enabling any live Twilio sends.

### Phase 1 go/no-go criteria

Go:

- `npm run lint`, `npm run build`, and `npm run db:validate` pass
- all required portal migrations are applied
- owner dashboard, worker dashboard, inbox manual reply, branding save, logo upload, invoice PDF, and photo upload all pass on staging
- integrations readiness UI accurately reflects env state
- no blocking 500s or auth regressions appear in the tested Phase 1 routes

No-go:

- Prisma migrations are missing or partial
- invoice PDF rendering fails
- photo upload fails in both R2 and inline fallback modes
- `/app` role routing is incorrect for owner vs worker
- `/app/inbox` cannot load or send manual replies
- settings and branding changes do not persist

### Phase 2 activation notes

Phase 2 should stay off until all of the following are complete:

1. Save per-org Twilio credentials in `/hq/orgs/:orgId/twilio`
2. Configure Twilio webhooks for SMS and voice
3. Confirm the `<Dial action>` callback reaches `/api/webhooks/twilio/after-call`
4. Install cron for `POST /api/cron/intake`
5. Keep `TWILIO_SEND_ENABLED=false` until end-to-end staging tests pass
6. Validate:
   - missed inbound call creates or updates the correct lead
   - after-call webhook records the missed call outcome
   - inbound SMS updates the correct conversation
   - STOP/START handling works
   - quiet-hours messages queue and release correctly
   - follow-up timing behaves as expected

## Twilio SMS/Voice Setup

The portal is ready for per-client texting and missed-call auto-replies.

Required env vars in `apps/portal/.env.local`:

```bash
TWILIO_TOKEN_ENCRYPTION_KEY=... # base64-encoded 32-byte key
TWILIO_SEND_ENABLED=false
TWILIO_VALIDATE_SIGNATURE=false
TWILIO_SMS_COST_ESTIMATE_CENTS=1
CRON_SECRET=...
TWILIO_VOICE_AFTER_CALL_URL=... # optional override; defaults to /api/webhooks/twilio/after-call
# optional send window defaults if you want to override in seed/migrations
# (stored per-org in Settings after onboarding)
# smsQuietHoursStartMinute=480   # 08:00
# smsQuietHoursEndMinute=1200    # 20:00
```

Behavior:

- Each organization stores its own Twilio Subaccount SID, Auth Token, Messaging Service SID, and sender number.
- Outbound sends use that org's Twilio subaccount credentials + messaging service (no env-per-client redeploys).
- `TWILIO_SEND_ENABLED=false`: outbound messages are saved in CRM and marked `QUEUED`.
- `TWILIO_SEND_ENABLED=true`: outbound messages are sent to Twilio and message status/SID are stored.
- `TWILIO_VALIDATE_SIGNATURE=true`: inbound webhooks require a valid `X-Twilio-Signature` using the org's token.
- `CRON_SECRET`: protects internal cron endpoints (use `Authorization: Bearer <CRON_SECRET>` or `x-cron-secret`).

Twilio webhook URLs:

- Inbound SMS: `/api/webhooks/twilio/sms` (aliases: `/api/twilio/sms`, `/api/twilio/sms/inbound`)
- Inbound voice: `/api/webhooks/twilio/voice` (alias: `/api/twilio/voice`)
- Voice dial status callback: `/api/webhooks/twilio/after-call` (aliases: `/api/webhooks/twilio/voice/after-dial`, `/api/twilio/voice/status`)
- Intake backfill cron: `POST /api/cron/intake`

Phase 2 activation checklist:

1. In HQ, open `/hq/orgs/:orgId/twilio` and save the org's `Subaccount SID`, `Auth Token`, `Messaging Service SID`, `Phone Number`, optional `Voice Forwarding Number`, and `Status`.
2. In Twilio Console, point incoming SMS for that number or Messaging Service to `/api/webhooks/twilio/sms`.
3. In Twilio Console, point the voice webhook for that number to `/api/webhooks/twilio/voice`.
4. Leave the after-call status callback on the TwiML `<Dial action>` path. The app generates `/api/webhooks/twilio/after-call` automatically, or `TWILIO_VOICE_AFTER_CALL_URL` if you override it.
5. Create a cron job that sends `POST /api/cron/intake` with `Authorization: Bearer <CRON_SECRET>` on a frequent interval.
6. Run end-to-end staging tests for missed calls, inbound SMS, STOP/START handling, queued quiet-hours sends, and follow-up release timing before turning `TWILIO_SEND_ENABLED=true` in production.

Per-client setup is in HQ:

- Go to `/hq/orgs/:orgId/twilio`
- Enter `Subaccount SID`, `Auth Token`, `Messaging Service SID`, `Phone Number`, optional `Voice Forwarding Number`, and `Status`
- Click `Validate` to verify messaging service + sender assignment
- Click `Send Test SMS` to confirm outbound routing

Automated intake flow:

1. Missed inbound call sends intro SMS (and first location question if intake automation is enabled).
2. Replies are captured in the lead's own message thread.
3. Flow collects location, work type, callback time.
4. Callback time writes to `Lead.nextFollowUpAt` and creates a `FOLLOW_UP` event for HQ calendar/project folder.

STOP/quiet-hours behavior:

- Inbound `STOP`, `STOPALL`, `UNSUBSCRIBE`, `CANCEL`, `END`, `QUIT` marks lead as `DNC` and suppresses future outbound automation.
- Inbound `START` or `UNSTOP` resumes by moving DNC leads back to `FOLLOW_UP`.
- Missed-call auto-replies obey org quiet hours (default send window `08:00`-`20:00` local org timezone).
- Outside quiet hours, auto-replies are queued and sent by `POST /api/cron/intake` once the next allowed window opens.

Local testing notes:

1. Set `TWILIO_VALIDATE_SIGNATURE=false` for local webhook testing.
2. Run portal and post form-data test payloads:
   - `curl -X POST http://localhost:3001/api/webhooks/twilio/voice -d "AccountSid=ACsubaccount123&CallSid=CA123&From=+12065550199&To=+12065550100&Direction=inbound&CallStatus=ringing"`
   - `curl -X POST http://localhost:3001/api/webhooks/twilio/after-call -d "AccountSid=ACsubaccount123&CallSid=CA123&From=+12065550199&To=+12065550100&Direction=inbound&DialCallStatus=no-answer&CallStatus=completed"`
   - `curl -X POST http://localhost:3001/api/webhooks/twilio/sms -d "AccountSid=ACsubaccount123&MessageSid=SM123&From=+12065550199&To=+12065550100&Body=STOP"`
3. Trigger cron intake manually:
   - `curl -X POST http://localhost:3001/api/cron/intake -H "Authorization: Bearer $CRON_SECRET"`

### Internal Deployment Checklist (Twilio Multi-Tenant + Mobile)

Use this checklist every time portal Twilio routing or mobile shell changes are released.

1. Set required env vars in Vercel (`tiegui-monorepo-portal`):
   - `TWILIO_TOKEN_ENCRYPTION_KEY` (base64 32-byte key)
   - `TWILIO_SEND_ENABLED`
   - `TWILIO_VALIDATE_SIGNATURE`
   - `CRON_SECRET`
2. Apply database migrations:
   - `cd apps/portal`
   - ensure `DIRECT_URL` is set (use the same value as `DATABASE_URL` if needed)
   - `npm run db:validate`
   - `npm run db:migrate:deploy`
3. Deploy portal:
   - push/merge to production branch and let Vercel build
   - confirm build includes:
     - `/hq/orgs/[orgId]/twilio`
     - `/api/webhooks/twilio/sms`
     - `/api/webhooks/twilio/voice`
4. Validate HQ route access:
   - INTERNAL user opens `/hq/orgs`
   - INTERNAL user opens `/hq/orgs/<orgId>/twilio`
   - legacy link `/hq/businesses/<orgId>/twilio` redirects to `/hq/orgs/<orgId>/twilio`
5. Validate Velocity organization setup:
   - Open `/hq/orgs/1b328092-64d8-4b38-9ce2-25c39d8edf34/twilio`
   - Save Subaccount SID/Auth Token/Messaging Service/Phone/Voice Forwarding Number/Status
   - Click `Validate`
   - Click `Send Test SMS`
6. Validate inbound/outbound messaging:
   - post Twilio SMS webhook payload to `/api/webhooks/twilio/sms` and expect `200`
   - post Twilio inbound voice webhook payload to `/api/webhooks/twilio/voice` and expect TwiML with `<Dial>`
   - post Twilio voice dial status payload to `/api/webhooks/twilio/after-call` and expect `200`
   - confirm lead/message/call records land in the correct org
7. Validate cron-driven follow-ups:
   - trigger `POST /api/cron/intake` with `Authorization: Bearer <CRON_SECRET>`
   - confirm queued missed-call intros and conversational follow-ups advance as expected
8. Validate mobile app packaging:
   - `cd apps/mobile`
   - `npm run check-types`
   - `npm run dev` (Expo starts and tabs load `/app/*?mobile=1`)

## Jobber + QuickBooks Integration Setup

MVP routes are available at `Settings -> Integrations` (`/app/settings/integrations`).

Required env vars in `apps/portal/.env.local`:

```bash
# Encryption for stored OAuth tokens (falls back to NEXTAUTH_SECRET if omitted)
INTEGRATIONS_ENCRYPTION_KEY=...

# Jobber OAuth
JOBBER_CLIENT_ID=...
JOBBER_CLIENT_SECRET=...
JOBBER_REDIRECT_URI=http://localhost:3001/api/integrations/jobber/callback
JOBBER_SCOPES=read_clients read_jobs read_invoices

# QuickBooks OAuth
QBO_CLIENT_ID=...
QBO_CLIENT_SECRET=...
QBO_REDIRECT_URI=http://localhost:3001/api/integrations/qbo/callback
QBO_SCOPES=com.intuit.quickbooks.accounting

# Google Calendar OAuth (per user)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3001/api/integrations/google/callback

# Microsoft Outlook OAuth
MICROSOFT_CLIENT_ID=...
MICROSOFT_CLIENT_SECRET=...
MICROSOFT_TENANT_ID=...
MICROSOFT_REDIRECT_URI=http://localhost:3001/api/integrations/outlook/callback
MICROSOFT_SCOPES=offline_access openid profile email User.Read Mail.Send
```

OAuth + integration routes:

- `GET /api/integrations/jobber/connect`
- `GET /api/integrations/jobber/callback`
- `GET /api/integrations/qbo/connect`
- `GET /api/integrations/qbo/callback`
- `GET /api/integrations/google/connect` (per-user connect; use `?mode=read` or `?mode=write`)
- `GET /api/integrations/google/callback`
- `GET /api/integrations/outlook/connect`
- `GET /api/integrations/outlook/callback`
- `POST /api/integrations/google/sync` (sync current user's Google -> TieGui busy blocks now)
- `POST /api/integrations/google/disconnect`
- `POST /api/integrations/import` (bulk import trigger)
- `POST /api/integrations/disconnect`
- `POST /api/integrations/sync` (toggle ongoing sync flag)
- `POST /api/cron/integrations/refresh` (refresh expiring tokens; protected by `CRON_SECRET`)
- `POST /api/cron/google/sync` (process Google write queue + periodic Google read sync; protected by `CRON_SECRET`)
- `GET /api/export` (CSV + JSON zip export)

Data portability files in export zip:

- `customers.csv/json`
- `jobs.csv/json`
- `invoices.csv/json`
- `invoice_line_items.csv/json`
- `payments.csv/json`
- `notes.csv/json`
- `org_snapshot.json` (full org-owned records snapshot)

Manual provider export fallback guidance is included in the Integrations UI.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
