# Architecture

## Overview

AppHub is a multi-app meta-platform built as a monorepo of microservices. Multiple
independent apps (aikikan, split-pay, …) share a set of cross-cutting platform
services. Each app gets its own subdomain and its own app-specific microservices.

## Platform layers

```
                  ┌─────────────────────────────────────────────┐
                  │            Internet / CDN                    │
                  └────────────────────┬────────────────────────┘
                                       │
                  ┌────────────────────▼────────────────────────┐
                  │       NGINX  (conf.d/ subdomain routing)     │
                  │  hulkstein.local  aikikan.hulkstein.local  splitpay…│
                  └──────┬─────────────┬────────────────┬───────┘
                         │             │                │
              ┌──────────▼──┐  ┌───────▼────┐  ┌───────▼──────┐
              │  AppHub      │  │   Aikikan   │  │ Split Pay    │
              │  portal:5173 │  │ portal:5176 │  │ portal:5175  │
              └─────────────┘  └───────┬─────┘  └──────┬───────┘
                                       │ /api/app/*     │ /api/app/*
                              ┌────────▼──────┐ ┌───────▼──────┐
                              │ aikikan-server│ │   splitpay   │
                              │ 3030          │ │ 3020         │
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
| `hulkstein.com` | `hulkstein.local` | AppHub admin portal |
| `splitpay.hulkstein.com` | `splitpay.hulkstein.local` | Split Pay |
| `aikikan.hulkstein.com` | `aikikan.hulkstein.local` | Aikikan (Aikido association) |
| `js-electric.hulkstein.com` | `js-electric.hulkstein.local` | JS Electric (marketing landing + lead inbox) |

### Route namespace convention

| URL prefix | Meaning | Served by | Present on |
|---|---|---|---|
| `/api/auth/` | Platform auth | platform-core | All subdomains |
| `/api/payments/` | Platform payments | platform-core | All subdomains |
| `/api/notifications/` | Platform notifications | platform-core | All subdomains |
| `/api/tenants/` | Tenant registry | platform-core | All subdomains |
| `/api/splitpay/` | Stripe Connect | platform-core | All subdomains |
| `/api/storage/` | Object storage (MinIO/S3 presigned URLs) | platform-core | All subdomains |
| `/api/leads/` | Public lead-capture + staff CRM | platform-core | Hulkstein landing |
| `/api/donations/` | Donations (one-shot + recurring + fiscal) | platform-core | All subdomains |
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

When staff registers a new app from console (`POST /v1/apps`), `platform-core` writes
the rendered server block to the Redis hash. Every NGINX replica in the cluster picks it up
within ~2s without manual reload, host-side ops, or filesystem coordination between nodes.

See [ADR 003 — Dynamic NGINX routing via Redis sidecar](docs/adr/003-dynamic-nginx-routing.md)
for the rationale, alternatives considered (Docker Configs, OpenResty, NGINX Plus, K8s Ingress),
and operational details (bootstrap, debugging, tunables, migration to Kubernetes).

## Identity model — three JWT claims

```
platform/auth  issues JWTs with:
  sub           →  user UUID
  app_id        →  which app   (aikikan | split-pay | …)
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
  └── App (aikikan, split-pay, …)           app_id
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
├── platform_storage              (platform/storage)         role: svc_platform_storage
├── platform_leads                (platform/leads)           role: svc_platform_leads
├── platform_donations            (platform/donations)       role: svc_platform_donations
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
├── app_aikikan                    (apps/aikikan/aikikan-server)  role: svc_app_aikikan
└── … (one per app — apps without app-specific domain like js-electric have no schema)
```

**Apps without an app-specific schema.** Not every app needs a backend.
Marketing-site apps (current example: `js-electric`) live as portal-only
deployments that REUSE platform modules — typically `platform/inquiries`
for the contact form and `platform/auth` for an embedded admin inbox. No
`app_<name>` schema, no `<name>-server` container. Admin views live inside
the app's own portal (see memory `feedback_app_admin_in_own_portal.md`),
not in `packages/tenant-console-ui/`. When/if the app later grows
app-specific data (CMS for projects, blog posts, etc.), that's the trigger
to introduce `app_<name>` per ADR 013.

Cross-schema queries are never allowed. Roles and grants are defined in
`infra/postgres/init/01_platform_schemas.sql`.

## Event bus

Services communicate asynchronously via Redis Pub/Sub. Events are published to a channel
named `{appId}.events` using `publish()` from `@apphub/platform-sdk/redis.js`. Consumers
subscribe to the same channel in their startup hook.

Cross-app subscribers (modules en `platform-core` que sirven a más de un
app, p.ej. `platform/donations`) usan **`psubscribe('*.events')`** y
filtran por `metadata.*` para identificar los eventos relevantes —
patrón inspirado en cómo splitpay enruta sus webhooks de Stripe a la
app correcta vía `metadata.app_id`.

Eventos clave emitidos por el dominio dinero:

| Origen | Tipo | Cuándo | Consumido por |
|---|---|---|---|
| `platform/splitpay` | `splitpay.checkout.completed`, `splitpay.invoice.paid`, `splitpay.invoice.payment_failed`, `splitpay.subscription.updated`, `splitpay.subscription.deleted` | webhook Stripe correspondiente | Cada app que cobra (aikikan-server, `platform/donations`, …) |
| `platform/donations` | `donation.completed`, `donation.recurring.charged`, `donation.recurring.failed`, `donation.recurring.cancelled`, `donation.refunded`, `donation.certificate.ready` | tras reconciliar el webhook de splitpay | `platform/notifications` (emails al donante) + apps suscritas |

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
| `platform-core` | Modular monolith: auth + notifications + payments + tenant-config + splitpay + storage + leads + donations | 3000 |
| `platform-marketplace` | Modular monolith: orders + inventory + reviews + messaging + shipping + disputes + catalog + basket | 3100 |
| `platform-restaurant` | Modular monolith: menu + reservations + floor-plan + kds + pos + delivery-dispatch | 3200 |
| `platform-appointments` | Modular monolith: services + resources + bookings + availability + intake-forms + telehealth + packages + practitioner-payouts | 3300 |
| `platform-scheduler` | Single-runner cron for all 4 monoliths (9 jobs: hold purge, reminders, recurrence expander, expiry warnings, payout close, SLA breach, abandoned cart) | 3400 |
| `portal` | AppHub admin (Vite dev) | 5173 |
| `splitpay-portal` | Split Pay frontend (Vite dev) | 5175 |
| `aikikan-portal` | Aikikan frontend (Vite dev) | 5176 |
| `console-portal` | Voragine staff console (Vite dev) | 5177 |
| `js-electric-portal` | JS Electric landing + admin inbox (Vite dev) | 5180 |
| `postgres` | PostgreSQL 16 | 5432 |
| `redis` | Redis 7 | 6379 |
| `minio` | S3-compatible object store (MinIO) | 9000 (API), 9001 (console) |
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

## Port allocation

| Range | Owner |
|---|---|
| 3000–3005 | Platform services |
| 3006–3009 | Reserved for future platform services |
| 3020–3029 | Split Pay app services |
| 3030–3099 | App monolith servers (one per app — aikikan, …) |
| 3100 | platform-marketplace |
| 3200 | platform-restaurant |
| 3300 | platform-appointments |
| 3400 | platform-scheduler |
| 3400+ | Future domain monoliths |
| 5173 | AppHub admin portal |
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
| 008 | Object storage: MinIO + storage module of platform-core (presigned PUT/GET) |
