# Architecture

## Overview

AppHub is a multi-app meta-platform built as a monorepo of microservices. Multiple
independent apps (yoga-studio, split-pay, …) share a set of cross-cutting platform
services. Each app gets its own subdomain and its own app-specific microservices.

## Platform layers

```
                  ┌─────────────────────────────────────────────┐
                  │            Internet / CDN                    │
                  └────────────────────┬────────────────────────┘
                                       │
                  ┌────────────────────▼────────────────────────┐
                  │       NGINX  (conf.d/ subdomain routing)     │
                  │  apphub.local  yoga.apphub.local  splitpay…  │
                  └──────┬─────────────┬────────────────┬───────┘
                         │             │                │
              ┌──────────▼──┐  ┌───────▼────┐  ┌───────▼──────┐
              │  AppHub      │  │ Yoga Studio │  │ Split Pay    │
              │  portal:5173 │  │ portal:5174 │  │ portal:5175  │
              └─────────────┘  └───────┬─────┘  └──────┬───────┘
                                       │ /api/app/*     │ /api/app/*
                              ┌────────▼──────┐ ┌───────▼──────┐
                              │ yoga-* svcs   │ │   splitpay   │
                              │ 3011–3017     │ │ 3020         │
                              └───────────────┘ └──────────────┘
                                       │                │
              /api/auth, /api/payments, /api/orders, /api/menu, …
        ┌──────────────────────┬─────────────────────┬──────────────────────┐
        │                      │                     │                      │
┌───────▼────────────┐ ┌───────▼─────────────┐ ┌─────▼───────────────┐
│ platform-core:3000 │ │ platform-marketplace│ │ platform-restaurant │
│                    │ │ :3100               │ │ :3200               │
│ auth, payments,    │ │ orders, inventory,  │ │ menu, reservations, │
│ notifications,     │ │ reviews, messaging, │ │ floor-plan, kds,    │
│ tenant-config,     │ │ shipping, disputes, │ │ pos,                │
│ splitpay           │ │ catalog, basket     │ │ delivery-dispatch   │
└────────────────────┘ └─────────────────────┘ └─────────────────────┘
                                  │                        │
                          shared Postgres + Redis (platform.events)
```

## Subdomain routing

| Subdomain | Local alias | App |
|---|---|---|
| `apphub.com` | `apphub.local` | AppHub admin portal |
| `yoga.apphub.com` | `yoga.apphub.local` | Yoga Studio |
| `splitpay.apphub.com` | `splitpay.apphub.local` | Split Pay |
| `aikikan.apphub.com` | `aikikan.apphub.local` | Aikikan (Aikido association) |

### Route namespace convention

| URL prefix | Meaning | Served by | Present on |
|---|---|---|---|
| `/api/auth/` | Platform auth | platform-core | All subdomains |
| `/api/payments/` | Platform payments | platform-core | All subdomains |
| `/api/notifications/` | Platform notifications | platform-core | All subdomains |
| `/api/tenants/` | Tenant registry | platform-core | All subdomains |
| `/api/splitpay/` | Stripe Connect | platform-core | All subdomains |
| `/api/orders/` | Orders ledger | platform-marketplace | All subdomains |
| `/api/inventory/` | Stock per SKU | platform-marketplace | All subdomains |
| `/api/reviews/` | Reviews + replies | platform-marketplace | All subdomains |
| `/api/messages/` | Buyer ↔ vendor chat | platform-marketplace | All subdomains |
| `/api/shipping/` | Shipments + tracking | platform-marketplace | All subdomains |
| `/api/disputes/` | Operational disputes | platform-marketplace | All subdomains |
| `/api/catalog/` | Product catalogue | platform-marketplace | All subdomains |
| `/api/basket/` | Shopping cart (Redis) | platform-marketplace | All subdomains |
| `/api/menu/` | F&B menu | platform-restaurant | All subdomains |
| `/api/reservations/` | Reservations + waitlist | platform-restaurant | All subdomains |
| `/api/floor-plan/` | Tables + sections | platform-restaurant | All subdomains |
| `/api/kds/` | Kitchen Display System | platform-restaurant | All subdomains |
| `/api/pos/` | POS bills + split + tips | platform-restaurant | All subdomains |
| `/api/delivery-dispatch/` | Riders + delivery zones | platform-restaurant | All subdomains |
| `/api/app/...` | App-specific routes | (per-app service) | Only that subdomain |
| `/` | App frontend | (per-app portal) | Only that subdomain |

NGINX uses a hybrid configuration:

- **Static infrastructure** (`nginx.conf`, `conf.d/upstream.conf`, `snippets/`) is bind-mounted
  read-only from the host. These rarely change and are version-controlled via git.
- **Per-subdomain server blocks** live in **Redis** (hash `nginx:configs`, one field per
  subdomain). A sidecar inside the NGINX container polls Redis every 2s, renders each field
  to `/etc/nginx/conf.d/sites/<subdomain>.conf`, and triggers `nginx -s reload` on change.

When staff registers a new app from voragine-console (`POST /v1/apps`), `platform-core` writes
the rendered server block to the Redis hash. Every NGINX replica in the cluster picks it up
within ~2s without manual reload, host-side ops, or filesystem coordination between nodes.

See [ADR 003 — Dynamic NGINX routing via Redis sidecar](docs/adr/003-dynamic-nginx-routing.md)
for the rationale, alternatives considered (Docker Configs, OpenResty, NGINX Plus, K8s Ingress),
and operational details (bootstrap, debugging, tunables, migration to Kubernetes).

## Identity model — three JWT claims

```
platform/auth  issues JWTs with:
  sub           →  user UUID
  app_id        →  which app   (yoga-studio | split-pay | …)
  tenant_id     →  which deployment of that app
  sub_tenant_id →  sub-unit within the tenant (nullable)
  role          →  user role within that app
  email
```

Every app-specific service registers the `appGuard` plugin from `@apphub/platform-sdk`.
The guard reads `EXPECTED_APP_ID` from the environment and returns `403 APP_MISMATCH` if
the token's `app_id` does not match. Platform services set `EXPECTED_APP_ID=platform`.

## Multi-tenancy model

```
Platform (AppHub)
  └── App (yoga-studio, split-pay, …)       app_id
        └── Tenant (a deployment)            tenant_id uuid
              └── Sub-tenant (optional)      sub_tenant_id uuid (nullable)
                    └── End users
```

- `app_id` is set at login from the request body and verified on every service call.
- `tenant_id` is looked up from `platform_tenants.tenants` at login time.
- `sub_tenant_id` is nullable — `NULL` means the resource belongs to the root tenant.
- Row-level security in PostgreSQL enforces isolation on all three axes.

## PostgreSQL schema isolation

One PostgreSQL instance, one schema per service. Each service connects with its own
dedicated PostgreSQL role — never the shared superuser. The superuser is only used
by `migrate.js` via `MIGRATION_DATABASE_URL`.

```
PostgreSQL instance
│
│ ── platform-core modules ──
├── platform_auth                 (platform/auth)            role: svc_platform_auth
├── platform_payments             (platform/payments)        role: svc_platform_payments
├── platform_notifications        (platform/notifications)   role: svc_platform_notifications
├── platform_tenants              (platform/tenant-config)   role: svc_platform_tenants
├── splitpay_core                 (platform/splitpay)        role: splitpay (shared, legacy)
│
│ ── platform-marketplace modules ──
├── platform_orders               (platform/orders)          role: svc_platform_orders
├── platform_inventory            (platform/inventory)       role: svc_platform_inventory
├── platform_reviews              (platform/reviews)         role: svc_platform_reviews
├── platform_messaging            (platform/messaging)       role: svc_platform_messaging
├── platform_shipping             (platform/shipping)        role: svc_platform_shipping
├── platform_disputes             (platform/disputes)        role: svc_platform_disputes
├── platform_catalog              (platform/catalog)         role: svc_platform_catalog
│   (basket has no schema — Redis-only)
│
│ ── platform-restaurant modules ──
├── platform_menu                 (platform/menu)            role: svc_platform_menu
├── platform_reservations         (platform/reservations)    role: svc_platform_reservations
├── platform_floor_plan           (platform/floor-plan)      role: svc_platform_floor_plan
├── platform_kds                  (platform/kds)             role: svc_platform_kds
├── platform_pos                  (platform/pos)             role: svc_platform_pos
├── platform_delivery_dispatch    (platform/delivery-dispatch) role: svc_platform_delivery_dispatch
│
│ ── App-specific schemas ──
├── yoga_users / yoga_classes / yoga_bookings / yoga_bonuses / yoga_reporting
└── … (one per app service)
```

Cross-schema queries are never allowed. Roles and grants are defined in
`infra/postgres/init/01_platform_schemas.sql`.

## Event bus

Services communicate asynchronously via Redis Pub/Sub. Events are published to a channel
named `{appId}.events` using `publish()` from `@apphub/platform-sdk/redis.js`. Consumers
subscribe to the same channel in their startup hook.

## Idempotency

All Stripe API calls carry an `Idempotency-Key` derived from the internal operation ID.
Keys are stored in Redis with a 24-hour TTL to prevent duplicate charges on network retries.

## Monorepo tooling

- **pnpm workspaces** — shared `node_modules`, no duplication
- **Turborepo** — incremental builds and test runs
- **Docker Compose** — identical environment in local, CI, and staging

## Container topology

| Docker service | What runs inside | Ports |
|---|---|---|
| `platform-core` | Modular monolith: auth + notifications + payments + tenant-config + splitpay | 3000 |
| `platform-marketplace` | Modular monolith: orders + inventory + reviews + messaging + shipping + disputes + catalog + basket | 3100 |
| `platform-restaurant` | Modular monolith: menu + reservations + floor-plan + kds + pos + delivery-dispatch | 3200 |
| `platform-appointments` | Modular monolith: services + resources + bookings + availability + intake-forms + telehealth + packages + practitioner-payouts | 3300 |
| `platform-scheduler` | Single-runner cron for all 4 monoliths (9 jobs: hold purge, reminders, recurrence expander, expiry warnings, payout close, SLA breach, abandoned cart) | 3400 |
| `yoga-studio` | All 5 yoga services + yoga-portal via PM2 | 3011–3014, 3017, 5174 |
| `portal` | AppHub admin (Vite dev) | 5173 |
| `splitpay-portal` | Split Pay frontend (Vite dev) | 5175 |
| `aikikan-portal` | Aikikan frontend (Vite dev) | 5176 |
| `voragine-console-portal` | Voragine staff console (Vite dev) | 5177 |
| `postgres` | PostgreSQL 16 | 5432 |
| `redis` | Redis 7 | 6379 |
| `nginx` | NGINX gateway | 8080 |

The **four monolith containers** (`platform-core`, `platform-marketplace`,
`platform-restaurant` and `platform-appointments`) follow the same pattern: each owns a
domain, exposes a single port, hosts its modules in-process, runs each module's migrations
on boot, and shares the same Postgres + Redis instances. Cross-container communication is
by Redis events (`platform.events` channel) and shared `PLATFORM_JWT_SECRET` so JWTs are
accepted on all of them. See [ADR 004](docs/adr/004-domain-separated-monolith-containers.md)
for the rationale, [ADR 005](docs/adr/005-platform-restaurant-monolith.md) for the
restaurant split, and [ADR 006](docs/adr/006-platform-appointments-monolith.md) for the
appointments split.

All yoga services and their portal share one container managed by PM2. Internal
service-to-service calls within yoga-studio use `http://localhost:<port>`.

## Port allocation

| Range | Owner |
|---|---|
| 3000–3005 | Platform services |
| 3006–3009 | Reserved for future platform services |
| 3011–3017 | Yoga Studio app services (inside `yoga-studio` container) |
| 3020–3029 | Split Pay app services |
| 3030–3099 | Future app services |
| 3100 | platform-marketplace |
| 3200 | platform-restaurant |
| 3300 | platform-appointments |
| 3400 | platform-scheduler |
| 3400+ | Future domain monoliths |
| 5173 | AppHub admin portal |
| 5174 | Yoga Studio portal (inside `yoga-studio` container) |
| 5175 | Split Pay portal |
| 5176 | Aikikan portal |
| 5177+ | Future app portals |

## Architecture Decision Records

ADRs are stored in `docs/adr/`. Current decisions:

| # | Decision |
|---|---|
| 001 | Use PostgreSQL schemas instead of separate databases per service |
| 002 | Three-level identity: app_id + tenant_id + sub_tenant_id |
| 003 | Dynamic NGINX routing via Redis sidecar |
| 004 | Domain-separated monolith containers (platform-core + platform-marketplace) |
| 005 | platform-restaurant: third domain monolith for restaurant operations |
| 006 | platform-appointments: fourth domain monolith for appointment / scheduling |
| 007 | platform-scheduler: single-runner cron container for the 4 monoliths |
