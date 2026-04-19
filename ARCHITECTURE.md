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
                              │ yoga-* svcs   │ │ splitpay-core│
                              │ 3011–3017     │ │ 3020         │
                              └───────────────┘ └──────────────┘
                                       │                │
                         /api/auth, /api/payments, …
                  ┌────────────────────▼────────────────────────┐
                  │              Platform services               │
                  │  auth:3000  payments:3001  notifications:3002│
                  │  catalog:3003  basket:3004  tenant-config:3005│
                  └─────────────────────────────────────────────┘
```

## Subdomain routing

| Subdomain | Local alias | App |
|---|---|---|
| `apphub.com` | `apphub.local` | AppHub admin portal |
| `yoga.apphub.com` | `yoga.apphub.local` | Yoga Studio |
| `splitpay.apphub.com` | `splitpay.apphub.local` | Split Pay |

### Route namespace convention

| URL prefix | Meaning | Present on |
|---|---|---|
| `/api/auth/` | Platform auth | All subdomains |
| `/api/payments/` | Platform payments | All subdomains |
| `/api/notifications/` | Platform notifications | All subdomains |
| `/api/catalog/` | Platform catalog | All subdomains |
| `/api/basket/` | Platform basket | All subdomains |
| `/api/tenants/` | Platform tenant-config | All subdomains |
| `/api/app/...` | App-specific routes | Only that subdomain |
| `/` | App frontend | Only that subdomain |

NGINX uses a `conf.d/` pattern: one `server {}` block per subdomain file, all including
the shared `snippets/platform-routes.conf` for the `/api/*` platform locations.

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

One PostgreSQL instance, one schema per service:

```
PostgreSQL instance
├── platform_auth          (platform/auth)
├── platform_payments      (platform/payments)
├── platform_notifications (platform/notifications)
├── platform_catalog       (platform/catalog)
├── platform_tenants       (platform/tenant-config)
├── yoga_users             (yoga-studio/yoga-users)
├── yoga_classes           (yoga-studio/yoga-classes)
├── yoga_bookings          (yoga-studio/yoga-bookings)
├── yoga_bonuses           (yoga-studio/yoga-bonuses)
├── yoga_reporting         (yoga-studio/yoga-reporting)
└── splitpay_core          (split-pay/splitpay-core)
```

Each service connects with its own PostgreSQL role scoped to its schema.
Cross-schema queries are never allowed.

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
| `platform-auth` | platform/auth (Node) | 3000 |
| `platform-payments` | platform/payments (Node) | 3001 |
| `platform-notifications` | platform/notifications (Node) | 3002 |
| `platform-catalog` | platform/catalog (Node) | 3003 |
| `platform-basket` | platform/basket (Node) | 3004 |
| `platform-tenant-config` | platform/tenant-config (Node) | 3005 |
| `yoga-studio` | All 5 yoga services + yoga-portal via PM2 | 3011–3014, 3017, 5174 |
| `splitpay-core` | split-pay/splitpay-core (Node) | 3020 |
| `portal` | AppHub admin (Vite dev) | 5173 |
| `splitpay-portal` | Split Pay frontend (Vite dev) | 5175 |
| `postgres` | PostgreSQL 16 | 5432 |
| `redis` | Redis 7 | 6379 |
| `nginx` | NGINX gateway | 8080 |

All yoga services and their portal share one container managed by PM2. Internal
service-to-service calls within yoga-studio use `http://localhost:<port>`.

## Port allocation

| Range | Owner |
|---|---|
| 3000–3005 | Platform services |
| 3006–3009 | Reserved for future platform services |
| 3011–3017 | Yoga Studio app services (inside `yoga-studio` container) |
| 3020–3029 | Split Pay app services |
| 3030+ | Future app services |
| 5173 | AppHub admin portal |
| 5174 | Yoga Studio portal (inside `yoga-studio` container) |
| 5175 | Split Pay portal |
| 5176+ | Future app portals |

## Architecture Decision Records

ADRs are stored in `docs/adr/`. Current decisions:

| # | Decision |
|---|---|
| 001 | Use PostgreSQL schemas instead of separate databases per service |
| 002 | Three-level identity: app_id + tenant_id + sub_tenant_id |
