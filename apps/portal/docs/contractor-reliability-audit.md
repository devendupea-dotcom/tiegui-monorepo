# TieGui Contractor Reliability Audit

## Current shape

- `apps/portal/lib/twilio-voice-webhook.ts`, `apps/portal/app/api/twilio/voice/route.ts`, and `apps/portal/app/api/webhooks/twilio/after-call/route.ts` already own the live Twilio voice path.
- `apps/portal/app/api/twilio/sms/inbound/route.ts`, `apps/portal/lib/conversational-sms.ts`, and `apps/portal/lib/sms-dispatch-queue.ts` drive missed-call recovery and SMS follow-up.
- The portal still centers most workflow on `Lead`, with `Call[]`, `Message[]`, `Event[]`, and notes stitched together at read time in `apps/portal/app/api/inbox/conversations/[leadId]/events/route.ts` and `apps/portal/app/app/jobs/[jobId]/page.tsx`.

## Gap analysis

### Phase 1: Stability

- Twilio voice reliability is partially built, but not auditable end-to-end.
  `apps/portal/lib/twilio-voice-webhook.ts`
  Gap: call outcomes are flattened to `RINGING` / `ANSWERED` / `MISSED` / `VOICEMAIL`, so `busy`, `no-answer`, and other carrier-level results are not first-class portal states.
- Voicemail handling is present, but storage is incomplete.
  `apps/portal/app/api/webhooks/twilio/after-call/route.ts`
  Gap: voicemail recordings are detected but not stored as dedicated artifacts or attached to a unified communication timeline.
- Missed-call SMS logic is duplicated across realtime and cron paths.
  `apps/portal/lib/twilio-voice-webhook.ts`
  `apps/portal/app/api/cron/intake/route.ts`
  Gap: cron re-scans missed calls after the realtime webhook already queues or sends recovery flows, which increases complexity and makes diagnostics harder.
- Structured observability is thin.
  `apps/portal/app/api/webhooks/twilio/after-call/route.ts`
  `apps/portal/app/api/twilio/sms/inbound/route.ts`
  Gap: logs are string-based, there is no per-account webhook log table, and there is no communication diagnostics page.

### Phase 2: Simplicity

- The owner dashboard is still a mixed command center rather than an ROI-first contractor board.
  `apps/portal/app/app/owner-command-center.tsx`
  Gap: revenue, marketing, and jobs are blended together, while missed calls, reply-needed, and estimates/jobs won are not the top-level focus.
- The inbox is closer to the target than the rest of the app, but it is still lead-thread centric rather than event-model centric.
  `apps/portal/app/app/inbox/unified-inbox.tsx`
  `apps/portal/app/api/inbox/conversations/route.ts`
  Gap: rows are synthesized from latest `Message` and `Call` rather than from a durable conversation/event model.
- The lead detail page still resolves to the job folder.
  `apps/portal/app/app/leads/[leadId]/page.tsx`
  `apps/portal/app/app/jobs/[jobId]/page.tsx`
  Gap: communications, notes, proof, and job execution are mixed into one folder instead of a single-source-of-truth lead view.

### Phase 3: Standardization

- Account-level config is fragmented between `Organization`, `OrganizationTwilioConfig`, `OrganizationMessagingSettings`, and dashboard settings.
  `apps/portal/prisma/schema.prisma`
  `apps/portal/app/app/settings/page.tsx`
  `apps/portal/app/hq/orgs/[orgId]/twilio/page.tsx`
  Gap: forwarding number, quiet hours, sender number, templates, onboarding, and attribution live in different places with overlapping ownership.
- Client-specific behavior still leaks into runtime code.
  `apps/portal/app/api/webhooks/twilio/after-call/route.ts`
  Gap before this patch: voicemail fallback referenced a specific person.
- Old intake flow code is still present beside the newer conversational flow.
  `apps/portal/lib/intake-automation.ts`
  `apps/portal/lib/conversational-sms.ts`
  Gap: there are two overlapping automation models, which makes future reliability work harder.

### Phase 4: Polish

- Mobile action patterns exist, but the information architecture still inherits desktop/job-folder assumptions.
  `apps/portal/app/app/inbox/unified-inbox.tsx`
  `apps/portal/app/app/jobs/[jobId]/page.tsx`
- Visual cleanup should wait until the communication and lead-state model stops leaking implementation detail into the UI.

## Prioritized implementation plan

1. Harden the communication event backbone.
   Add a durable communication-event layer or extend call/message persistence so raw Twilio outcomes, voicemail assets, actor, correlation ID, and notification attempts are queryable without reconstructing state.
2. Finish Twilio reliability work.
   Normalize inbound voice status handling, make voicemail recording/transcription first-class, and centralize missed-call recovery to one idempotent path.
3. Rebuild the lead timeline around one source of truth.
   Replace stitched read-time timelines with stored communication and lead lifecycle events.
4. Simplify the contractor portal.
   Make dashboard, inbox, and lead detail reflect response-needed, booked value, and source performance first.
5. Consolidate config and onboarding.
   Introduce a coherent account settings model and an onboarding completeness system driven by the same config.

## Exact modules to change next

- Twilio voice/webhooks:
  `apps/portal/lib/twilio-voice-webhook.ts`
  `apps/portal/app/api/twilio/voice/route.ts`
  `apps/portal/app/api/webhooks/twilio/after-call/route.ts`
- Missed-call recovery and SMS automation:
  `apps/portal/lib/conversational-sms.ts`
  `apps/portal/lib/sms-dispatch-queue.ts`
  `apps/portal/app/api/cron/intake/route.ts`
- Unified communication timeline:
  `apps/portal/app/api/inbox/conversations/[leadId]/events/route.ts`
  `apps/portal/app/app/inbox/unified-inbox.tsx`
  `apps/portal/app/app/jobs/[jobId]/page.tsx`
- Config + onboarding:
  `apps/portal/app/app/settings/page.tsx`
  `apps/portal/app/app/onboarding/page.tsx`
  `apps/portal/app/hq/orgs/[orgId]/twilio/page.tsx`
  `apps/portal/prisma/schema.prisma`
