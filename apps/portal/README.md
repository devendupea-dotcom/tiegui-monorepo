This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load Inter, a custom Google Font.

## Twilio SMS/Voice Setup

The portal is ready for per-client texting and missed-call auto-replies.

Required env vars in `apps/portal/.env.local`:

```bash
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_SEND_ENABLED=false
TWILIO_VALIDATE_SIGNATURE=false
DEFAULT_OUTBOUND_FROM_E164=+12065550100
CRON_SECRET=...
```

Behavior:

- `TWILIO_SEND_ENABLED=false`: outbound messages are saved in CRM and marked `QUEUED`.
- `TWILIO_SEND_ENABLED=true`: outbound messages are sent to Twilio and message status/SID are stored.
- `TWILIO_VALIDATE_SIGNATURE=true`: inbound webhooks require a valid `X-Twilio-Signature`.
- `CRON_SECRET`: protects internal cron endpoints (use `Authorization: Bearer <CRON_SECRET>` or `x-cron-secret`).

Twilio webhook URLs:

- Inbound SMS: `/api/twilio/sms/inbound`
- Voice status callbacks: `/api/twilio/voice/status`
- Intake backfill cron: `POST /api/cron/intake`

Per-client setup is in HQ:

- Go to `/hq/businesses/:orgId?tab=messages`
- Set `Sender Number (E.164)`
- Enable/edit missed-call auto-reply message
- Enable `automated intake prompts` and customize location/work-type/callback/completion prompts
- Add reusable SMS templates

Automated intake flow:

1. Missed inbound call sends intro SMS (and first location question if intake automation is enabled).
2. Replies are captured in the lead's own message thread.
3. Flow collects location, work type, callback time.
4. Callback time writes to `Lead.nextFollowUpAt` and creates a `FOLLOW_UP` event for HQ calendar/project folder.

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
```

OAuth + integration routes:

- `GET /api/integrations/jobber/connect`
- `GET /api/integrations/jobber/callback`
- `GET /api/integrations/qbo/connect`
- `GET /api/integrations/qbo/callback`
- `GET /api/integrations/google/connect` (per-user connect; use `?mode=read` or `?mode=write`)
- `GET /api/integrations/google/callback`
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
