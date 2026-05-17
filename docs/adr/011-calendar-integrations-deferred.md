# ADR 011 — Calendar integrations (Google / Outlook two-way sync) deferred

## Status

Accepted — 2026-05-02. Implementation deferred; this ADR fixes the design so
the work is not re-litigated later.

## Context

`platform/resources` exposes practitioners + work hours + exceptions. Today a
practitioner's calendar is a self-contained AppHub record. The TODO line
"Calendar integrations (Google Calendar / Outlook two-way sync)" asks for the
classic SaaS feature: bookings created in AppHub appear in the practitioner's
personal calendar, and busy events on the personal calendar block AppHub
slots.

Two-way sync is **deceptively complex**:

1. **OAuth2 dance per practitioner** — Google Workspace + Microsoft Graph
   each have their own consent flow, refresh-token storage, scope set
   (`calendar.events`, `calendar.calendarlist`), and revocation handling.
2. **Webhook + polling hybrid** — Google sends `push notifications` over
   HTTPS (X-Goog-* headers) but they expire every 7 days and need re-renewal;
   Microsoft sends webhooks but recommends fallback polling. Both require a
   public HTTPS endpoint with signature validation.
3. **Conflict resolution** — what if AppHub creates a booking and a Google
   event lands on the same slot 200ms later? Last-write-wins is unsafe
   (overbooking); first-write-wins requires distributed locks across two
   systems neither of which we control.
4. **Identity mapping** — a Google event has no `bookingId`. Storing
   `extended_properties.private.bookingId` works for events we created, but
   external events (the practitioner blocking 9-10 for "doctor's appointment")
   need their own representation as `platform_resources.exceptions` rows we
   shadow-create.
5. **Quotas** — Google: 1M reads/day per project, but per-user quotas
   (queries × seconds) are tighter. Outlook is similar. A naive sync of
   N=500 practitioners polling every 5 minutes blows past the free tier
   immediately.
6. **Privacy / GDPR** — practitioner personal events that shouldn't show on
   AppHub (medical appointments, family events). Need a "show as busy without
   subject" mode and explicit opt-in scopes.
7. **Token security** — refresh tokens for Google live ~6 months; Microsoft's
   live 14 days. Both need encrypted storage (we have `@apphub/platform-sdk/
   crypto` for that), key rotation, and revocation hooks.

None of those problems are unsolvable. Together they constitute a small
sub-platform: **OAuth handler + webhook receiver + sync engine + token
store + queue for the pull/push reconciliation**. That's a multi-week effort
and a long-running operational concern (every Google API change is your
problem).

We have other priorities to ship first; AppHub's internal calendar already
works for booking management today.

## Decision

**Keep `resources` AppHub-internal for now.** Pin the design for the eventual
upgrade so re-entry is the cost of writing code, not the cost of re-deciding
the architecture.

When we do implement it:

- **Module shape:** new `platform/calendar-sync/` module inside
  `platform-appointments` (port 3300). Owns its own schema
  `platform_calendar_sync` with tables `connections`, `sync_state`,
  `external_events`. Tests, OpenAPI, settings table same pattern as
  `platform/notifications`.
- **Per-provider config keys** in console (encrypted): Google client
  id/secret/redirect uri, Microsoft client id/secret/redirect uri.
- **OAuth flow** lives at `GET /v1/calendar-sync/connect/:provider` (issues
  state, redirects to provider) + `GET /v1/calendar-sync/callback/:provider`
  (exchanges code, persists encrypted refresh token in
  `connections`).
- **Inbound (provider → AppHub)**: provider pushes to
  `POST /v1/calendar-sync/webhook/:provider`. Signature validated
  (Google: `X-Goog-Channel-Token`; Microsoft: `validationToken` echo on
  registration, `clientState` match per notification). External events become
  shadow rows in `platform_resources.exceptions` with `metadata.source =
  'google'|'outlook'` and `metadata.external_id`.
- **Outbound (AppHub → provider)**: subscribe to `booking.confirmed`,
  `booking.cancelled`, `booking.rescheduled`. The sync engine queues a job
  per change in Redis (`calsync:queue:<connectionId>`); a worker consumes
  with exponential backoff on 429s and 5xxs. Bookings created by AppHub get
  their event id stored in `bookings.metadata.calendar_event_id` so updates
  and deletes are O(1).
- **Sticky sessions / rate limit**: not needed — each connection runs its
  own queue and we throttle per-connection, not per-instance.
- **Stale tokens**: `connections.expires_at`. Periodic refresher runs every
  hour from `platform-scheduler` and renews tokens that expire in <24h.
- **Webhook channel renewal**: same scheduler — Google channels every 6 days
  (one day before the 7-day expiry), Microsoft subscriptions every 2 days.
- **Frontend**: new "Connect calendar" button in each practitioner's
  settings → opens the OAuth flow, shows current connection status + a
  "Disconnect" button. Conflict resolution surfaced as a banner on the
  affected booking ("This slot conflicts with an event on your Google
  calendar — review").

## Why this design now

Pinning the design means the next person doesn't have to redo the analysis.
The decisions above are what every well-running SaaS calendar (Cal.com,
Calendly, SimplyBook.me) has converged on; deviating without reason just
means rediscovering their constraints.

## Consequences

**Positive**
- AppHub stays operationally simple. No third-party API quotas to babysit, no
  refresh-token storage to encrypt + rotate, no webhook signature surface, no
  on-call for "Google webhook renewal failed".
- Migrating later is purely additive: a new module + per-tenant opt-in.
  Existing bookings, work hours, exceptions stay valid.

**Negative**
- Practitioners using Google/Outlook personal calendars have to maintain a
  manual exception in AppHub when they block private time — same UX as today.
- Cal.com / Calendly are SaaS competitors that ship this; clients comparing
  side by side will notice the gap. Mitigation: position AppHub as a tenant
  ops platform, not a personal-calendar app.

**Reversible?** Yes. Adding the `platform/calendar-sync` module doesn't break
anything in `resources` or `bookings`. The per-tenant feature flag (in
`tenants.default_locale`'s neighbour spot) lets us roll it out gradually.

## Implementation TODO when revisited

1. `infra/postgres/init/01_platform_schemas.sql` — schema
   `platform_calendar_sync`, role `svc_platform_calendar_sync`.
2. `platform/calendar-sync/` — module scaffold (package.json, src/index.js
   exporting register + runMigrations).
3. Migrations: `connections`, `sync_state`, `external_events` tables (RLS,
   encrypted refresh_token column).
4. `services/google-client.js` + `services/outlook-client.js` — fetch-based
   wrappers using the same dev-stub pattern as Resend/Twilio/FCM.
5. OAuth routes: `GET /connect/:provider`, `GET /callback/:provider`,
   `POST /disconnect/:connectionId`.
6. Webhook routes: `POST /webhook/:provider` with provider-specific signature
   verification.
7. Sync engine: a worker that consumes `calsync:queue:<connectionId>` Redis
   lists; one job per booking change.
8. Two new platform-scheduler jobs:
   - `calendar-token-refresh` (cron `0 */1 * * *`) renews tokens expiring
     in <24h.
   - `calendar-channel-renew` (cron `0 3 * * *`) re-subscribes Google /
     Outlook webhook channels before their TTL.
9. console: Google + Outlook config (client id/secret) under
   Configuración. Per-tenant feature flag.
10. Practitioner UI: "Connect calendar" button in their settings panel.

Each of those is well-defined; the ADR removes the design uncertainty so
the implementation is a focused 1–2 weeks of work when prioritised.
