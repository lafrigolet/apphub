# Changelog

All notable changes to this project will be documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

## [Unreleased]

### Added
- **Dynamic NGINX routing via Redis sidecar** — per-subdomain `server {}` blocks now live in
  the Redis hash `nginx:configs` instead of static files in `infra/nginx/conf.d/`. A sidecar
  inside the NGINX container polls Redis every 2s and reloads NGINX on change. Registering an
  app from voragine-console (`POST /v1/apps`) propagates routing to every NGINX replica
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
  - `src/services/email.service.js` — SendGrid in production; console log fallback in development
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
  - Subdomain aliases for local dev: `apphub.local`, `yoga.apphub.local`, `splitpay.apphub.local`

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
