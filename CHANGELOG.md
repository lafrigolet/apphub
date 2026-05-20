# Changelog

All notable changes to this project will be documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

## [Unreleased]

### Changed
- **ESP swap: Resend en lugar de SendGrid** — `platform/notifications` ahora
  usa la SDK de Resend para envío de email y para la API de Domain
  Authentication por tenant.
  - `email.service.js` reescrito con `import { Resend } from 'resend'`.
  - `sendgrid-domains.service.js` eliminado; `resend-domains.service.js`
    implementa create/validate/delete contra Resend's Domains API.
  - DB: clave config renombrada `sendgrid_api_key` → `resend_api_key`;
    migración 0014 borra la fila stale (la API key vieja era de SendGrid,
    inservible para Resend).
  - Env vars: `SENDGRID_API_KEY`/`SENDGRID_FROM_EMAIL` → `RESEND_API_KEY`/
    `EMAIL_FROM_ADDRESS` (más genérico, futureproof).
  - UI: Hulkstein Console > Configuración > "Resend" (era "SendGrid"),
    placeholder API key `re_…`, helper de SPF actualizado a
    `include:amazonses.com` (Resend usa AWS SES por debajo).
  - Tests: mocks `vi.mock('@sendgrid/mail')` → `vi.mock('resend')`.
  - Operador debe pegar la nueva API key de Resend desde la consola
    tras desplegar.

### Added
- **`platform/donations` module** — infraestructura completa para
  gestión de donaciones, reutilizable por cualquier app de la
  plataforma. Vive dentro de `platform-core` (puerto 3000) junto a
  `splitpay` y `notifications`.
  - Cubre **todos los tipos**: one-shot vs `recurring_monthly`,
    anónimas vs identificadas, donante registrado vs invitado, fondo
    general vs campaña/causa, fiscal completo (Ley 49/2002 + AEAT
    modelo 182).
  - **DB**: schema `platform_donations`, rol `svc_platform_donations`,
    4 tablas con RLS por `(app_id, tenant_id)` —
    `causes` (campañas con `target_cents`/`raised_cents`),
    `donations` (estado + PII donante incluyendo `donor_nif`),
    `donation_subscriptions` (recurrentes Stripe),
    `fiscal_certificates` (idempotente por
    `(app_id, tenant_id, fiscal_year, donor_nif)`).
    Lectura selectiva sobre `platform_tenants.tenants` (NIF/razón
    social/dirección — necesarios para certificado y modelo 182).
  - **Splitpay queda intacto** — `createCheckoutSession` ya aceptaba
    `price_data` ad-hoc y `mode:'subscription'` con
    `recurring.interval`. El módulo lo consume vía HTTP loopback con
    `metadata.purpose='donation'`.
  - **Eventos**: subscriber psubscribe a `*.events` filtrando por
    `metadata.purpose='donation'`. Actualiza estados, incrementa
    `raised_cents`. Emite `donation.completed`,
    `donation.recurring.{charged,failed,cancelled}`,
    `donation.refunded`, `donation.certificate.ready`.
  - **Fiscal**:
    - Certificado PDF con `@react-pdf/renderer` (sin JSX,
      `React.createElement` directo — Node 20 sin transpilador).
      Sube a `platform/storage` (MinIO).
    - Export TXT modelo 182 en ISO-8859-1, registros 600 chars
      (header tipo 1 declarante + detalle tipo 2 por donante con
      NIF). Spec base Orden HAC/665/2004.
  - **Endpoints** (montados en `/api/donations/` vía nginx →
    `platform_core/v1/donations/`):
    - Públicos: `GET /causes/?appId=&tenantId=`,
      `POST /checkout` (one-shot o recurring), `GET /health`.
    - Autenticados: `GET /me`, `GET /subscriptions/me`,
      `POST /subscriptions/:id/cancel`, `GET /:id`.
    - Admin (`owner|admin|staff|super_admin`):
      `GET/POST/PATCH/DELETE /causes/admin/*`,
      `GET /admin/`, `GET /admin/subscriptions`,
      `POST /admin/:id/refund`,
      `GET /fiscal/certificates`,
      `POST /fiscal/certificates/generate`,
      `GET /fiscal/modelo-182?year=`.
  - **Notifications** (`platform_notifications.migrations/0019`):
    6 plantillas nuevas (`donation.thank_you`,
    `donation.receipt.monthly`, `donation.payment_failed`,
    `donation.cancelled`, `donation.refunded`,
    `donation.certificate.ready`) + 6 helpers `sendDonation*` en
    `email.service.js` + 6 subscribers en `event-consumer.js` que
    mapean cada evento de donación a su email Resend.
  - **Provisión**: schema + rol en
    `infra/postgres/init/01_platform_schemas.sql` con GRANT default
    de DML; ruta `/api/donations/` en
    `infra/nginx/snippets/platform-routes.conf` (burst=20);
    `DATABASE_URL_DONATIONS` + `PLATFORM_CORE_BASE_URL` en
    `docker-compose.yml` (servicio `platform-core`);
    `SVC_PLATFORM_DONATIONS_DB_PASSWORD` en `.env.example`;
    Dockerfile platform/core actualizado (COPY package.json + src,
    en dev y prod stages).
  - **No app-side en este commit**: se construye sólo la
    infraestructura plataforma. La integración con apps específicos
    (aikikan: formulario donante en `/area-socio`, admin de causas
    en `/consola`, link "Donar" en la landing) queda como commit
    posterior.
- **`platform/leads` module** — public lead-capture endpoint for the
  Hulkstein landing's contact form. New schema `platform_leads` + role
  `svc_platform_leads`. POST `/v1/leads` is public (no auth, nginx rate
  limit burst=5); GET/PATCH `/v1/leads/admin` is staff-gated via
  `requireRole('super_admin', 'staff')`. Lead table captures
  contact_name/email/business_name/phone/industry/message/source plus
  ip/user_agent (for abuse triage) and a `status` workflow
  (new → contacted → qualified → closed) for the future CRM UI.
- **Hulkstein public landing** at `apps/portal/` (the apex
  `hulkstein.com`). Replaces the legacy Stripe-themed admin clone that
  was never wired to a real backend. Sections: Header, Hero,
  Industries (Restaurantes, Gym, Servicios, Tienda), HowItWorks,
  WhyUs, FinalCta with gradient indigo→violet, Footer. Lead-capture
  modal (`LeadModal.jsx`) POSTs to `/api/leads/v1`. Tailwind palette
  swapped to indigo/slate defaults; font swapped from DM Sans to
  Inter. "Iniciar sesión" link points to
  `console.hulkstein.com` for staff/admin entry — overridable
  via `VITE_LOGIN_URL`. Legacy `features/`, `components/layout/`,
  `components/shared/` stay on disk as dead code (unreferenced by
  routes; tree-shaken at build).

### Changed
- **TLS at the origin via Cloudflare Origin Certificate** — every per-app
  nginx server block (seeds and dynamic templates rendered into Redis by
  `platform/tenant-config`) now `include`s
  `/etc/nginx/snippets/tls-listen.conf`. In dev that file is empty
  (HTTP-only). In prod, `docker-compose.prod.yml` overlays
  `tls-listen.prod.conf` on top of it, activating
  `listen 443 ssl http2;` plus the cert at
  `/etc/cloudflare/origin/{cert,key}.pem`. Required to run Cloudflare in
  `Full (Strict)` SSL mode (the only secure option now that CF removed
  `Flexible` for new sites). The prod compose also adds `443:443` to the
  nginx ports and mounts `/etc/cloudflare/origin:ro`. Full setup is in
  `docs/runbooks/cloudflare-dns.md` (cert generation in CF UI → upload
  to host → deploy → flip SSL mode → verify).
- **Public production domain switched to `hulkstein.com`** (was placeholder
  `hulkstein.com`). Nginx seed configs in `infra/nginx/seed/*.conf` now match
  `<sub>.hulkstein.com` for prod and keep `<sub>.hulkstein.local` for dev. New
  env var `PLATFORM_PUBLIC_DOMAIN` (set on `platform-core` in
  `docker-compose.prod.yml`) drives the host suffix used by
  `platform/tenant-config/src/services/nginx-config.service.js` when it
  renders dynamic per-app / per-tenant blocks into Redis. Default remains
  `hulkstein.com` so dev stacks are untouched.
- **Cloudflare proxy support in nginx** — new
  `infra/nginx/snippets/cloudflare-real-ip.conf` declares Cloudflare's
  IPv4/IPv6 ranges as trusted via `set_real_ip_from` and points
  `real_ip_header CF-Connecting-IP`, so `$remote_addr` (and therefore the
  `limit_req` zone keyed by it, plus audit logs) reflect the real visitor
  IP instead of a CF datacenter. Included in the http block of
  `infra/nginx/nginx.conf`; in dev the ranges simply never match.
- **Runbook**: `docs/runbooks/cloudflare-dns.md` documents the Cloudflare
  DNS records (apex + wildcard, both proxied), SSL/TLS mode (Full →
  Full strict upgrade path with Origin Cert), origin firewall lockdown,
  and verification steps.

### Removed
- **YogaStudio app retired** — deleted `apps/yoga-studio/` (portal + 5 empty
  service shells: `yoga-users`, `yoga-classes`, `yoga-bookings`, `yoga-bonuses`,
  `yoga-reporting`). All functionality lives in platform modules now
  (`platform/auth`, `platform/services`, `platform/bookings`, `platform/packages`,
  `platform/availability`, …). Cleaned up references in `.env`, `.env.example`,
  `.github/workflows/deploy.yml`, `infra/postgres/init/00_init.sql`,
  `packages/platform-sdk/src/app-guard.js`, `platform/tenant-config/src/services/{nginx-config,bootstrap}.service.js`,
  and the live docs (CLAUDE.md, ARCHITECTURE.md, DEVELOPMENT.md, RUN.md, COMMANDS.md,
  CONVENTIONS.md, TODO.md, docs/runbooks/platform-bootstrap.md). ADRs and applied
  migrations preserve the historical record.

### Removed (secrets)
- Stripe / OAuth / Resend / S3 secrets removed from `.env` and `.env.example` —
  they live encrypted at rest in `platform_*/config|settings|oauth_providers`
  tables and are configured via `/v1/<module>/admin` endpoints (super_admin/staff).
  Only bootstrap secrets (DATABASE_URL, JWT, encryption master key, MinIO root,
  per-module DB role passwords) remain in env.

### Added
- **Module-level runtime config UI in console** — staff can now
  bootstrap every platform-core module from the admin portal without touching
  `.env` or redeploying. New sidebar group "Configuración" with sections for:
  - **OAuth Providers** (Google, Facebook): client_id + AES-GCM-encrypted
    client_secret + enabled flag. New table `platform_auth.oauth_providers`,
    routes `/v1/auth/admin/oauth-providers`. `oauth.service` resolves the live
    config from DB at each login, falling back to env for back-compat.
  - **Stripe (payments)**: publishable_key, secret_key, webhook_secret —
    encrypted. New table `platform_payments.config`, routes `/v1/payments/admin/config`.
  - **Resend + Email Templates (notifications)**: API key + sender + 6
    seeded templates with `{{var}}` interpolation. Tables
    `platform_notifications.config` and `…templates`. Routes
    `/v1/notifications/admin/config`, `…/templates` (CRUD + preview).
    `email.service` reads templates from DB with hardcoded fallback;
    Resend api_key + sender resolved from DB with env fallback (cached 30s).
  - **Stripe Connect (splitpay)**: platform_account_id + secret/publishable
    keys + webhook secret. Table `splitpay_core.config`, routes
    `/v1/splitpay/admin/config`. `lib/stripe.js` hydrates from DB at boot
    via a new `reloadStripeFromDb()` hook called from `register()`.
  - **Object storage**: S3 endpoint/region/bucket/access/secret + MinIO
    public endpoint + force_path_style. Table `platform_storage.settings`,
    routes `/v1/storage/admin/config` + `/admin/kinds` (read-only).
    `storage.service` driven by a merged DB+env settings cache.
  - **Apps & Tenants** (tenant-config): existing CRUD endpoints now require
    `requireRole('staff')` on writes; reads remain authenticated.

  All admin endpoints sit behind `requireRole('super_admin', 'staff')`. All
  secrets are encrypted at rest with AES-256-GCM via the new
  `@apphub/platform-sdk/crypto` helper (master key in
  `PLATFORM_CONFIG_ENCRYPTION_KEY`, 32 bytes hex). Migration is non-breaking:
  modules read config from DB and fall back to env for older deployments.

- **`reviews` verified-purchase check** — `platform/reviews` now calls
  `platform-marketplace`'s own `/v1/orders/:id` endpoint (HTTP loopback inside
  the same container, ready-to-split when the modules separate) to verify that
  the supplied `orderId` belongs to the reviewing user and is in a paid/fulfilled
  status. Result is persisted as `verified_purchase BOOLEAN` on
  `platform_reviews.reviews`. See [ADR 009](docs/adr/009-reviews-verified-purchase.md).
  - New column `verified_purchase` + partial index for fast verified-only listings.
  - `GET /v1/reviews?verifiedOnly=true` filter.
  - `GET /v1/reviews/aggregate` returns `verifiedCount` alongside `count`/avg.
  - Soft-fail: orders unreachable / 404 / 5xx → review created with
    `verified_purchase=false` (never blocks the user-visible action).
  - 17 unit tests for `orders-client.js`, 6 new integration tests stubbing
    `global.fetch`, all green.

- **Object storage (MinIO + `storage` module)** — sixth infra container
  (`minio:9000/9001`) and a new module of `platform-core` that mints presigned
  PUT/GET URLs and registers metadata in `platform_storage.objects`. Bytes
  never traverse Node — clients PUT directly to MinIO/S3. See
  [ADR 008](docs/adr/008-object-storage.md).
  - `packages/platform-sdk/src/storage.js` — S3 client + `presignPut/Get`,
    `headObject`, `deleteObject` helpers (using `@aws-sdk/client-s3` and
    `@aws-sdk/s3-request-presigner`).
  - `platform/storage/` — full module: `kinds.js` catalogue (13 kinds, each
    with MIME allowlist + maxBytes + retentionDays), service, repo, routes:
    `POST /v1/storage/uploads`, `POST /v1/storage/objects/:id/finalize`,
    `GET /v1/storage/objects/:id`, `GET /v1/storage/objects/:id/download-url`,
    `DELETE /v1/storage/objects/:id`, `GET /v1/storage/objects`,
    `GET /v1/storage/kinds`.
  - `platform/menu` extended with `photo_object_id`; `platform/intake-forms`
    extended with `signature_object_id`. Both keep their old URL columns for
    back-compat.
  - 2 new scheduler jobs: `storage-orphan-purge` (hourly) deletes pending
    rows older than 1h; `storage-retention-purge` (daily 03:15) soft-deletes
    objects past `retention_until` and emits `storage.object.deleted`.
  - New schema `platform_storage`, role `svc_platform_storage`, MinIO bucket
    `apphub`. Production swaps `S3_ENDPOINT` to AWS S3 / Cloudflare R2 with
    no code change.

- **`platform-scheduler` container** — fifth monolith (port 3400), single-runner
  cron service that polls Postgres and publishes scheduled events to the other
  4 monoliths over `platform.events`. See
  [ADR 007](docs/adr/007-platform-scheduler.md). Ships 9 jobs:
  - `availability-hold-purge` (`* * * * *`) — DELETE expired holds
  - `booking-reminders` (`*/5 * * * *`) — publish `booking.reminder.due` (T-24h, T-2h)
  - `booking-recurrence-expander` (`0 * * * *`) — materialize recurrences 30 days ahead
  - `reservation-reminders` (`*/5 * * * *`) — publish `reservation.reminder.due`
  - `package-expiry-warning` (`0 8 * * *`) — publish `package.expiring` (T-30d, T-7d)
  - `package-expiry-transition` (`30 0 * * *`) — flip active → expired
  - `practitioner-payout-close` (`0 2 * * *`) — publish `payout.period_due` per schedule
  - `dispute-sla` (`*/30 * * * *`) — publish `dispute.sla_breached` (>48h no vendor reply)
  - `basket-abandoned` (`0 * * * *`) — publish `basket.abandoned` for idle baskets
  - **Postgres advisory locks** wrap each job to skip overlapping ticks.
  - **Audit table** `platform_scheduler.runs` stores every run's status/timing/error.
  - **Admin API** (internal-only) `/v1/scheduler/jobs`, `/v1/scheduler/runs`,
    `/v1/scheduler/jobs/:name/run` for staff.
  - New schema `platform_scheduler` + role `svc_platform_scheduler` (BYPASSRLS,
    minimal cross-schema GRANTs).
  - Idempotency columns on client modules:
    `bookings.reminder_{24h,2h}_sent_at`, `reservations.reminder_{24h,2h}_sent_at`,
    `packages.warning_{30d,7d}_sent_at`, `disputes.sla_breached_at`.
  - New table `platform_practitioner_payouts.payout_schedules`
    (period weekly/biweekly/monthly + next_run_at).
  - Event consumers extended:
    `notifications` handles `booking.reminder.due`, `reservation.reminder.due`,
    `package.expiring`, `dispute.sla_breached`;
    `practitioner-payouts` handles `payout.period_due`;
    `disputes` handles `dispute.sla_breached`.

- **`platform-appointments` container + 8 appointment modules** — fourth monolith
  container (port 3300) for appointment / scheduling workloads (clinics, salons,
  workshops, lawyers, fitness, etc.). Same modular-monolith pattern as the other three:
  per-module schema + dedicated DB role, shared `PLATFORM_JWT_SECRET`, cross-container
  communication via Redis events on `platform.events`. See
  [ADR 006](docs/adr/006-platform-appointments-monolith.md).
  - `platform/appointments/` — orchestrator (`server.js`, `Dockerfile`, env)
  - `platform/services/` — bookable services catalog (duration, buffers, modality,
    cancellation policy). Publishes `service.published`, `service.deprecated`.
  - `platform/resources/` — practitioners, rooms, equipment, vehicles, with weekly
    work hours and ad-hoc exceptions. Publishes `resource.unavailable`.
  - `platform/bookings/` — appointment FSM (requested→confirmed→reminded→checked_in→
    in_progress→completed; cancelled / no_show / rescheduled), recurrence skeleton,
    waitlist, audit trail. Publishes `booking.{requested,confirmed,reminded,
    checked_in,in_progress,completed,cancelled,no_show,rescheduled}` and
    `booking.waitlist.{added,notified}`.
  - `platform/availability/` — slot computation engine. Reads work_hours, exceptions,
    bookings and active holds; atomic holds via tstzrange overlap checks. Publishes
    `availability.{held,released}`.
  - `platform/intake-forms/` — form templates (versioned), submissions, signatures.
    Subscribes to `booking.confirmed` to auto-create pending submissions for services
    flagged `requires_intake_form`. Publishes `intake.{requested,submitted}`.
  - `platform/telehealth/` — provider-agnostic video room provisioning (stub generates
    opaque ids/urls/tokens; Daily.co/Twilio/Jitsi integration is a drop-in
    replacement). Auto-provisions a room when a `telehealth`/`hybrid` booking is
    confirmed. Publishes `telehealth.room.{created,ended}`.
  - `platform/packages/` — prepaid session bundles ("10 sesiones por 400€") with
    balance tracking, validity expiry, automatic redemption on `booking.completed`
    and refund on `booking.cancelled` / `booking.no_show`. Publishes
    `package.{purchased,exhausted}`.
  - `platform/practitioner-payouts/` — commission rules per (practitioner, service),
    accruals on `booking.completed` (split evenly across attached practitioner
    resources), reversals on cancellation/no_show, periodic close into `payouts`.
    Publishes `payout.{created,paid}`.
  - `infra/postgres/init/01_platform_schemas.sql` — 8 new schemas + 8 dedicated roles.
  - `infra/nginx/snippets/platform-routes.conf` — 8 new `location /api/<module>/`
    blocks proxying to a new `platform_appointments` upstream.
  - `infra/nginx/conf.d/upstream.conf` — new `upstream platform_appointments`.
  - `docker-compose.yml` — new `platform-appointments` service with per-module
    `DATABASE_URL_*` + JWT secret + volume mounts for the 8 modules.
  - `.env.example` — 8 `SVC_PLATFORM_<MODULE>_DB_PASSWORD` entries.

- **`platform-restaurant` container + 6 restaurant modules** — third monolith container
  (port 3200) hosting **menu, reservations, floor-plan, kds, pos, delivery-dispatch**.
  Same modular-monolith pattern as `platform-core` / `platform-marketplace`: per-module
  schema + dedicated DB role, in-process module loading, shared `PLATFORM_JWT_SECRET` so
  JWTs are accepted across all three containers, cross-container communication via Redis
  events on `platform.events`. See [ADR 005](docs/adr/005-platform-restaurant-monolith.md).
  - `platform/restaurant/` — orchestrator (`server.js`, `Dockerfile`, env)
  - `platform/menu/` — F&B menu: course types, modifiers, allergens, availability
    windows, 86-list. Publishes `menu.item.eighty_sixed`, `menu.published`.
  - `platform/reservations/` — reservations + waitlist + service hours + blackouts.
    Publishes `reservation.{created,confirmed,seated,cancelled,no_show}`,
    `waitlist.{added,notified}`.
  - `platform/floor-plan/` — sections, tables, status FSM (free → reserved → occupied →
    dirty → free), table combine. Publishes `table.{seated,cleared,combined}`.
  - `platform/kds/` — Kitchen Display System. Stations route by course; tickets fired on
    `order.paid` / `pos.bill.paid`; FSM fired → in_progress → ready → picked_up.
    Publishes `kds.ticket.{fired,acked,ready,picked_up}`.
  - `platform/pos/` — open table bills, line items, split bill (equal / percent / amounts),
    tips, mixed payments. Publishes `pos.bill.{opened,split,paid,closed}`.
  - `platform/delivery-dispatch/` — delivery zones, riders + GPS pings, deliveries with
    carrier (own / glovo / uber / etc.). Subscribes `order.paid` to auto-create deliveries.
    Publishes `delivery.{created,dispatched,picked_up,delivered}`.
  - `infra/postgres/init/01_platform_schemas.sql` — 6 new schemas + 6 dedicated roles.
  - `infra/nginx/snippets/platform-routes.conf` — 6 new `location /api/<module>/` blocks
    proxying to the new `platform_restaurant` upstream.
  - `infra/nginx/conf.d/upstream.conf` — new `upstream platform_restaurant`.
  - `docker-compose.yml` — new `platform-restaurant` service with per-module DATABASE_URL_*.
  - `.env.example` — 6 `SVC_PLATFORM_<MODULE>_DB_PASSWORD` entries.

### Changed
- **`catalog` and `basket` folded into `platform-marketplace`** — both modules
  were previously standalone Docker containers (`platform-catalog:3003`,
  `platform-basket:3004`). They are now in-process modules of `platform-marketplace`,
  consistent with orders/inventory/reviews/messaging/shipping/disputes.
  - Refactored `platform/catalog/src/lib/{db,redis,migrate}.js` to the lazy + configurable pattern
  - Refactored `platform/basket/src/lib/redis.js` (no DB; basket exports a no-op `runMigrations`)
  - Both modules now export `register({app, db?, redis})` + `runMigrations(superuserUrl?)`
  - `platform/marketplace/src/server.js` handles modules without `databaseUrl` (basket: no Pool)
  - `docker-compose.yml`: removed `platform-catalog` and `platform-basket` services; added
    `DATABASE_URL_CATALOG` env + catalog/basket volume mounts to `platform-marketplace`
  - `infra/nginx/conf.d/upstream.conf`: removed `platform_catalog` and `platform_basket` upstreams
  - `infra/nginx/snippets/platform-routes.conf`: `/api/catalog/` and `/api/basket/` now proxy
    to `platform_marketplace`
  - Catalog now uses dedicated DB role `svc_platform_catalog` (was sharing `splitpay:splitpay`)

### Added
- **`platform-marketplace` container + 6 marketplace modules** — new monolith container
  (port 3100) hosting **orders, inventory, reviews, messaging, shipping, disputes**.
  Mirror architecture of `platform-core`: per-module schema + dedicated DB role,
  in-process module loading, shared `PLATFORM_JWT_SECRET` so JWTs are accepted across both
  containers, cross-container communication via Redis events on `platform.events`.
  See [ADR 004](docs/adr/004-domain-separated-monolith-containers.md).
  - `platform/marketplace/` — orchestrator (`server.js`, `Dockerfile`, env)
  - `platform/{orders,inventory,reviews,messaging,shipping,disputes}/` — the 6 modules,
    each with own `register({app,db,redis})` and `runMigrations(superuserUrl)`
  - `infra/postgres/init/01_platform_schemas.sql` — 6 new schemas + 6 dedicated roles
  - `infra/nginx/snippets/platform-routes.conf` — 6 new `location /api/<module>/` blocks
    proxying to `platform_marketplace` upstream
  - `infra/nginx/conf.d/upstream.conf` — new `upstream platform_marketplace`
  - `docker-compose.yml` — new `platform-marketplace` service with per-module DATABASE_URL_*
  - Event flow demonstrated end-to-end: `order.created` → inventory reserves stock,
    `order.paid` → inventory commits + shipping creates shipment, `shipping.shipment.delivered`
    → orders advances to `delivered`, `splitpay.chargeback.created` → disputes escalates.

- **`scripts/bootstrap.sh`** — first-boot bootstrap of an empty platform.
  Creates the first super_admin user (`POST /v1/auth/register`), verifies
  login, and registers the `platform` app in the registry. Idempotent.
  Required after a fresh `docker compose up` (or any DB wipe) so staff can
  log in to console.
  - Full reference: [`docs/runbooks/platform-bootstrap.md`](docs/runbooks/platform-bootstrap.md) (env vars,
    troubleshooting, wipe-and-restart workflow, design rationale)
  - Quick pointer in [`RUN.md`](RUN.md) § Option A → First-time bootstrap
- **Dynamic NGINX routing via Redis sidecar** — per-subdomain `server {}` blocks now live in
  the Redis hash `nginx:configs` instead of static files in `infra/nginx/conf.d/`. A sidecar
  inside the NGINX container polls Redis every 2s and reloads NGINX on change. Registering an
  app from console (`POST /v1/apps`) propagates routing to every NGINX replica
  without manual reload, host-side ops, or filesystem coordination. Cluster-friendly.
  See [ADR 003](docs/adr/003-dynamic-nginx-routing.md).
  - `infra/nginx/Dockerfile` — custom image: `nginx:alpine` + `redis-cli` + `tini`
  - `infra/nginx/{entrypoint,sidecar}.sh` — PID-1 entrypoint + reconciler
  - `infra/nginx/seed/*.conf` — seed configs (moved from `conf.d/`); used to populate Redis on first boot
  - `platform/tenant-config/src/services/nginx-config.service.js` — `writeAppNginxConfig` writes to Redis (`HSET` + `PUBLISH`)
  - `platform/tenant-config/src/services/apps.service.js` — calls `writeAppNginxConfig` after `INSERT INTO platform_tenants.apps`

### Added (preexisting)
- **`platform/auth` — OAuth 2.0 support (Google + Facebook)**
  - `migrations/0003_oauth_connections.sql` — `oauth_connections` table; `password_hash` made nullable
  - `src/repositories/oauth.repository.js` — provider lookup, email account linking, user creation
  - `src/services/oauth.service.js` — Google id_token verification (`google-auth-library`), Facebook Graph API token validation
  - `src/routes/oauth.routes.js` — `POST /v1/auth/oauth/google`, `POST /v1/auth/oauth/facebook`

- **`platform/notifications` — email sending**
  - `src/services/email.service.js` — Resend in production; console log fallback in development
  - `src/services/event-consumer.js` — Redis subscriber on `platform:events`; handles `user.registered` (welcome email) and `auth.password_reset_requested` (reset email)

- **`apps/aikikan/aikikan-portal` — login UI wired to real API**
  - `src/lib/auth.js` — `login`, `register`, `loginGoogle`, `loginFacebook`, `forgotPassword` helpers
  - `Login.jsx` — connected to platform-auth endpoints; Google via `@react-oauth/google`; loading/error/success states

### Changed
- **Schema isolation** — `platform-auth` and `platform-notifications` now connect at runtime with
  their own dedicated DB roles (`svc_platform_auth`, `svc_platform_notifications`) instead of the
  shared superuser. `migrate.js` in both services uses `MIGRATION_DATABASE_URL` for DDL.
- `docker-compose.yml` — updated `DATABASE_URL` + added `MIGRATION_DATABASE_URL` for platform-auth
  and platform-notifications; added OAuth and VITE env vars for aikikan-portal
- `.env.example` — added `PLATFORM_AUTH_DATABASE_URL`, `PLATFORM_NOTIFICATIONS_DATABASE_URL`,
  `MIGRATION_DATABASE_URL`, `GOOGLE_CLIENT_ID`, `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `AIKIKAN_TENANT_ID`

---

### Added (Yoga Studio PM2 single-container consolidation)
- **Yoga Studio PM2 single-container consolidation**
  - `apps/yoga-studio/Dockerfile` — one image for all yoga processes
  - `apps/yoga-studio/ecosystem.config.cjs` — PM2 process definitions for yoga-users,
    yoga-classes, yoga-bookings, yoga-bonuses, yoga-reporting, yoga-portal
  - Single `yoga-studio` Docker service replaces the previous 6 separate containers
  - Internal service calls use `http://localhost:<port>` instead of Docker hostnames

### Changed
- `docker-compose.yml` — replaced yoga-users, yoga-classes, yoga-bookings, yoga-bonuses,
  yoga-reporting, yoga-portal services with a single `yoga-studio` service
- `infra/nginx/conf.d/upstream.conf` — all yoga upstream servers now point to `yoga-studio`
  hostname on their respective ports
- `YOGA_BONUSES_INTERNAL_URL` and `YOGA_CLASSES_INTERNAL_URL` changed from Docker hostnames
  to `http://localhost` URLs

---

### Added (platform restructure)
- **AppHub multi-app platform restructure**
  - `platform/` shared microservices: auth (3000), payments (3001), notifications (3002),
    catalog (3003), basket (3004), tenant-config (3005)
  - `packages/platform-sdk/` — internal shared library: `app-guard.js`, `db.js`,
    `errors.js`, `logger.js`, `redis.js`
  - Three-claim JWT identity: `app_id` + `tenant_id` + `sub_tenant_id`
  - `appGuard` plugin with `EXPECTED_APP_ID` enforcement — returns `403 APP_MISMATCH`
    on cross-app token use
  - `setTenantContext` sets all three PostgreSQL RLS session vars (`app.app_id`,
    `app.tenant_id`, `app.sub_tenant_id`)
  - NGINX `conf.d/` subdomain routing pattern: `portal.conf`, `yoga.conf`, `splitpay.conf`
  - `infra/nginx/snippets/platform-routes.conf` — shared include for platform locations
  - `apps/split-pay/splitpay-portal/` — React 18 + Vite + Tailwind frontend (port 5175)
  - `apps/split-pay/splitpay-core/` — Stripe Connect service (port 3020, was services/split-payments port 3001)
  - `apps/__app-template__/` — blueprint for bootstrapping new apps (`__app__` placeholder)
  - PostgreSQL init: `01_platform_schemas.sql`, `02_splitpay_core_schema.sql`
  - Subdomain aliases for local dev: `hulkstein.local`, `yoga.hulkstein.local`, `splitpay.hulkstein.local`

### Changed
- `pnpm-workspace.yaml` — added `platform/*`, `apps/split-pay/*`, `apps/__app-template__/*`
- `docker-compose.yml` — added all platform service containers and split-pay containers
- `.env.example` — added `PLATFORM_JWT_SECRET`, `PLATFORM_STRIPE_*`, `SPLITPAY_STRIPE_*`
- All `.md` documentation updated for the new AppHub multi-app platform architecture

### Removed
- `services/split-payments/` — moved to `apps/split-pay/splitpay-core/`
- `services/` directory (now empty after migration)

---

### Added (previous)
- Initial monorepo structure with pnpm workspaces and Turborepo
- `split-payments` microservice v0.1.0
  - Stripe Connect account onboarding (hosted KYC flow)
  - Payment Intent creation with automatic split via `transfer_data` and `application_fee_amount`
  - Multi-beneficiary splits via Stripe Transfers
  - Split rule templates (named, reusable, assignable to tenants)
  - Payout schedule configuration per merchant
  - Refund endpoint with proportional Transfer reversal
  - Dispute management with evidence upload
  - Webhook listener with signature verification
  - Real-time split simulator endpoint
  - Row-level security by `tenant_id` + `sub_tenant_id`
  - Redis idempotency keys for all Stripe calls
  - Full unit test coverage for split engine and services
- Yoga Studio app (`apps/yoga-studio/`):
  - `yoga-portal` — React 18 + Vite + Tailwind frontend (port 5174)
  - `yoga-users` — user profiles service (port 3011)
  - `yoga-classes` — class catalogue and scheduling service (port 3012)
  - `yoga-bookings` — bookings and waiting list service (port 3013)
  - `yoga-bonuses` — credit and bonus management service (port 3014)
  - `yoga-reporting` — metrics and reporting service (port 3017)
  - Redis Pub/Sub event bus (`yoga-studio.events` channel)
  - 238 Vitest tests across all yoga services
- AppHub admin portal (`apps/portal/`, port 5173)
- Docker Compose for local development
- PostgreSQL 16 with per-service schemas and migrations
- Redis 7 for caching and event bus
- Nginx API gateway configuration
- Root documentation: CLAUDE, CONVENTIONS, CONTRIBUTING, DEVELOPMENT, ARCHITECTURE, RUN, CHANGELOG
