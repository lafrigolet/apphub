# CLAUDE.md

This file provides context for AI assistants (Claude, Copilot, etc.) working in this repository.

## Project overview

AppHub is a multi-app meta-platform. Each hosted app (yoga-studio, split-pay, …) gets its
own subdomain (`yoga.apphub.com`, `splitpay.apphub.com`) and its own set of app-specific
microservices. All apps share a set of cross-cutting platform capabilities (auth, payments,
notifications, catalog, basket, tenant-config, subscriptions).

**Deployment model — modular monolith ready to split**: the cross-cutting platform
capabilities ship together as **modules** of a single Node container called `platform-core`
(port 3000). Each module keeps its own routes, repository, PostgreSQL schema, and dedicated
DB role, so any module can be extracted back to its own container with minimal effort. The
app-specific services under `apps/*/` keep their own containers.

## Repository structure

```
apphub/
├── platform/                  # Platform-side services. Five monolith containers (platform-core + platform-marketplace + platform-restaurant + platform-appointments + platform-scheduler).
│   ├── core/                  # platform-core orchestrator — port 3000 (auth/notifications/payments/tenant-config/splitpay)
│   ├── marketplace/           # platform-marketplace orchestrator — port 3100 (orders/inventory/reviews/messaging/shipping/disputes/catalog/basket)
│   ├── restaurant/            # platform-restaurant orchestrator — port 3200 (menu/reservations/floor-plan/kds/pos/delivery-dispatch)
│   ├── appointments/          # platform-appointments orchestrator — port 3300 (services/resources/bookings/availability/intake-forms/telehealth/packages/practitioner-payouts)
│   ├── scheduler/             # platform-scheduler — port 3400, single-runner cron for all 4 monoliths
│   ├── auth/                  # Auth module (in platform-core) — schema platform_auth
│   ├── payments/              # Payments module (in platform-core) — schema platform_payments
│   ├── notifications/         # Notifications module (in platform-core) — schema platform_notifications
│   ├── tenant-config/         # Tenant-config module (in platform-core) — schema platform_tenants
│   ├── splitpay/              # Splitpay module (in platform-core) — schema splitpay_core
│   ├── storage/               # Storage module (in platform-core) — schema platform_storage; S3-compatible bucket via MinIO
│   ├── orders/                # Orders module (in platform-marketplace) — schema platform_orders
│   ├── inventory/             # Inventory module (in platform-marketplace) — schema platform_inventory
│   ├── reviews/               # Reviews module (in platform-marketplace) — schema platform_reviews
│   ├── messaging/             # Messaging module (in platform-marketplace) — schema platform_messaging
│   ├── shipping/              # Shipping module (in platform-marketplace) — schema platform_shipping
│   ├── disputes/              # Disputes module (in platform-marketplace) — schema platform_disputes
│   ├── catalog/               # Catalog module (in platform-marketplace) — schema platform_catalog
│   ├── basket/                # Basket module (in platform-marketplace) — Redis-only
│   ├── menu/                  # Menu module (in platform-restaurant) — schema platform_menu
│   ├── reservations/          # Reservations module (in platform-restaurant) — schema platform_reservations
│   ├── floor-plan/            # Floor-plan module (in platform-restaurant) — schema platform_floor_plan
│   ├── kds/                   # KDS module (in platform-restaurant) — schema platform_kds
│   ├── pos/                   # POS module (in platform-restaurant) — schema platform_pos
│   ├── delivery-dispatch/     # Delivery-dispatch module (in platform-restaurant) — schema platform_delivery_dispatch
│   ├── services/              # Services catalog module (in platform-appointments) — schema platform_services
│   ├── resources/             # Resources module (in platform-appointments) — schema platform_resources
│   ├── bookings/              # Bookings module (in platform-appointments) — schema platform_bookings
│   ├── availability/          # Availability module (in platform-appointments) — schema platform_availability
│   ├── intake-forms/          # Intake-forms module (in platform-appointments) — schema platform_intake_forms
│   ├── telehealth/            # Telehealth module (in platform-appointments) — schema platform_telehealth
│   ├── packages/              # Packages module (in platform-appointments) — schema platform_packages
│   ├── practitioner-payouts/  # Practitioner-payouts module (in platform-appointments) — schema platform_practitioner_payouts
│   └── subscriptions/         # Subscriptions module (planned, slot reserved)
├── apps/                      # App bundles (frontends + app-specific services)
│   ├── portal/                # AppHub admin UI — port 5173
│   ├── yoga-studio/           # Yoga Studio app — ports 3011–3017, 5174
│   ├── split-pay/             # Split Pay frontend (splitpay-portal) — port 5175
│   ├── aikikan/               # Aikikan Aikido portal — port 5176
│   └── __app-template__/      # Blueprint for new apps (never deployed)
├── packages/                  # Internal shared packages (pnpm workspaces)
│   ├── eslint-config/         # @splitpay/eslint-config
│   ├── sdk-js/                # @apphub/sdk-js — public JS SDK
│   └── platform-sdk/          # @apphub/platform-sdk — internal service helpers
├── infra/                     # Docker, NGINX, PostgreSQL init scripts
└── docs/                      # ADRs
```

## Tech stack

- **Runtime**: Node.js 20 LTS
- **Language**: JavaScript (ESM) for services and frontends — no TypeScript
- **Framework**: Fastify 4 for services, React 18 + Vite for frontends
- **Styling**: Tailwind CSS 3
- **Database**: PostgreSQL 16 — one schema per module / per app-specific service
- **Cache**: Redis 7
- **Payments**: Stripe Node SDK (latest)
- **Testing**: Vitest + Supertest
- **Containerisation**: Docker + Docker Compose
- **Monorepo**: pnpm workspaces + Turborepo
- **CI/CD**: GitHub Actions

## Identity model — three JWT claims

Every JWT issued by `platform/auth` carries:

```json
{
  "sub": "user-uuid",
  "app_id": "yoga-studio",
  "tenant_id": "tenant-uuid",
  "sub_tenant_id": "sub-tenant-uuid-or-null",
  "role": "alumno",
  "email": "user@example.com"
}
```

- `app_id` — which app this user belongs to (`yoga-studio`, `split-pay`, …)
- `tenant_id` — which deployment of that app (e.g. one yoga franchise group)
- `sub_tenant_id` — sub-unit within the tenant (e.g. a franchise branch), nullable

## Critical rules for AI assistants

1. **Never remove `tenant_id` scoping** from any database query. Every SELECT, INSERT,
   UPDATE, DELETE must be scoped to the current tenant.
2. **Always include `app_id` scoping** alongside `tenant_id`. A yoga token must never
   read split-pay data even when `tenant_id` matches.
3. **Always use idempotency keys** for Stripe API calls. Keys are stored in Redis with a 24h TTL.
4. **Never cross schema boundaries** — a module may only query its own PostgreSQL schema.
   Even though all platform modules share the `platform-core` process, each one connects
   through its own Pool, bound to its dedicated service role.
5. **Validate webhook signatures** — every incoming Stripe webhook must verify `Stripe-Signature`.
6. **Split reversals are proportional** — refund each Transfer by the same percentage as the
   original split, never a flat amount.
7. **sub_tenant_id is nullable** — code must handle both single-level and two-level tenancy.
8. **Use `appGuard` from `@apphub/platform-sdk`** — never write a custom JWT guard. Set
   `EXPECTED_APP_ID` in the service env; the guard returns `403 APP_MISMATCH` on mismatch.
9. **Write JavaScript, not TypeScript** — all services and frontends use `.js` / `.jsx`.
10. **Check `platform/` before adding any new horizontal capability** — auth, payments,
    notifications, catalog, basket, tenant-config and subscriptions are (or will be) modules
    of `platform-core`. If a new app needs one of these capabilities, wire it to the existing
    module instead of creating a duplicate. See the platform module registry below.
11. **Each module / service connects with its own dedicated DB role** — never use the shared
    superuser at runtime. Inside `platform-core` this means one Pool per module, each with
    `postgresql://svc_platform_<module>:...` (set via per-module env vars on the `platform-core`
    container). `migrate.js` per module uses `MIGRATION_DATABASE_URL` (the superuser); the
    application pool uses the module's own role. The same rule applies to app-specific
    services running in their own containers.
12. **Update `.md` files after any significant implementation** — keep `ARCHITECTURE.md`,
    `CHANGELOG.md`, `CONVENTIONS.md`, and `DEVELOPMENT.md` in sync with what was built.
    Specifically: new services → `ARCHITECTURE.md` + `DEVELOPMENT.md`; new patterns →
    `CONVENTIONS.md`; any change → `CHANGELOG.md` unreleased section.
13. **Module boundaries are sacred** — a `platform/<module>/` may not import internals
    from another `platform/<module>/`. Cross-module communication goes through (a) the
    module's public HTTP API, (b) Redis pub/sub on `platform.events`, or (c) shared utilities
    in `@apphub/platform-sdk`. This is what keeps the monolith ready to split.

## Modular monolith architecture

`platform-core` is a single Docker container running one Node process that hosts all
horizontal capabilities. It listens on **port 3000**. NGINX routes
`/api/{auth,users,payments,notifications,catalog,basket,tenants,apps,audit,subscriptions}/*`
to a single `platform_core` upstream.

### Module list

| Module | Path | Schema | DB role |
|---|---|---|---|
| auth | `platform/auth/` | `platform_auth` | `svc_platform_auth` |
| payments | `platform/payments/` | `platform_payments` | `svc_platform_payments` |
| notifications | `platform/notifications/` | `platform_notifications` | `svc_platform_notifications` |
| catalog | `platform/catalog/` | `platform_catalog` | `svc_platform_catalog` |
| basket | `platform/basket/` | — (Redis-only) | — |
| tenant-config | `platform/tenant-config/` | `platform_tenants` | `svc_platform_tenants` |
| subscriptions | `platform/subscriptions/` | `platform_subscriptions` | `svc_platform_subscriptions` |

### Entry point — `platform/core/src/server.js`

Boot order:

1. Load env (compose-injected vars)
2. Create one Pool per module, each bound to its dedicated role:
   `createPool('postgres://svc_platform_<module>:...@postgres:5432/apphub')`
3. Run module migrations sequentially (each module exports `runMigrations(superuserUrl)`)
4. Create the root Fastify app; register `helmet`, `cors`, `rate-limit`, `appGuard`,
   `sensible` once
5. For each module: `await module.register({ app, db: pools[module], redis, logger: logger.child({ module }) })`
6. `app.listen({ port: 3000, host: '0.0.0.0' })`

### Module contract

Every module exports from `platform/<module>/src/index.js`:

```js
export async function register({ app, db, redis, logger }) {
  // register routes under the module's prefix
  // never reach into another module's pool, repository, or service
}

export async function runMigrations(superuserUrl) {
  // apply migrations/*.sql against the module's schema
}
```

### Cross-module communication

A module **must not** import internals from another module. Permitted channels:

1. **HTTP** — call the module's own public API as an external client would
2. **Events** — publish/subscribe via `redis.publish('platform.events', …)` from
   `@apphub/platform-sdk`
3. **Shared SDK** — utilities exposed by `@apphub/platform-sdk` (DB helpers, JWT guard, errors)

This rule is what keeps the monolith ready to split.

### Splitting a module back to its own container

When a module needs independent scaling, splitting it is a 4-step operation:

1. Add `platform/<module>/src/server.js` that imports `register` and runs its own listener
2. Add `platform/<module>/Dockerfile` (workspace-context multi-stage)
3. Add a new service in `docker-compose.yml` and a new upstream in
   `infra/nginx/conf.d/upstream.conf`
4. Repoint `/api/<module>/` in `infra/nginx/snippets/platform-routes.conf` to the new upstream

Zero changes to business logic. The dedicated DB role is already what it would be in a
separate container.

## Naming conventions

- Files: `kebab-case.js` / `kebab-case.jsx`
- Functions / variables: `camelCase`
- Database columns: `snake_case`
- Environment variables: `SCREAMING_SNAKE_CASE`
- API routes: `/v1/resource-name` (kebab, versioned)
- Platform schemas: `platform_auth`, `platform_payments`, … (prefix `platform_`)
- App schemas: `yoga_classes`, `splitpay_core`, … (prefix `{app}_`)

## Commands

### Bootstrap app `<app-name>`

When the user says **"Bootstrap app `<name>`"**, create a minimal portal for that app
(landing page only — no backend services) by executing these steps in order:

1. **Determine next available ports** — check `docker-compose.yml` and `infra/nginx/conf.d/upstream.conf`
   for the highest frontend port in use (5173+) and increment by 1.

2. **Create portal files** under `apps/<name>/<name>-portal/`:
   - `package.json` — name `@<name>/<name>-portal`; deps: react 18, react-dom, react-router-dom;
     devDeps: vite, @vitejs/plugin-react, tailwindcss, autoprefixer, postcss
   - `vite.config.js` — port from step 1, `allowedHosts: ['<name>.apphub.local']`,
     proxy `/api` → `http://nginx:80`, `server.host: true`
   - `index.html` — minimal HTML shell with `<div id="root">` and `src/main.jsx` module script
   - `src/main.jsx` — React 18 `createRoot` entry
   - `src/App.jsx` — centered "Welcome!" page using Tailwind
   - `tailwind.config.js` — content glob `['./index.html', './src/**/*.{js,jsx}']`
   - `postcss.config.js` — standard tailwindcss + autoprefixer plugins
   - `Dockerfile` — root-context build: copy workspace manifests + portal `package.json`,
     `pnpm install --no-frozen-lockfile --filter @<name>/<name>-portal`,
     copy source files, `CMD ["pnpm", "dev"]`

3. **Add NGINX upstream** in `infra/nginx/conf.d/upstream.conf`:
   ```nginx
   upstream <name>_portal { server <name>-portal:<port>; }
   ```

4. **Add NGINX server block** `infra/nginx/conf.d/<name>.conf`:
   - `server_name <name>.apphub.local <name>.apphub.com`
   - `include /etc/nginx/snippets/platform-routes.conf`
   - `location /` → proxy to `<name>_portal` with WebSocket upgrade headers

5. **Add to `pnpm-workspace.yaml`** — append `'apps/<name>/*'`

6. **Add include to `infra/nginx/nginx.conf`** — append `include /etc/nginx/conf.d/<name>.conf;`
   inside the `http {}` block alongside the other per-subdomain includes.

7. **Add to `docker-compose.yml`**:
   - New service `<name>-portal`: `context: .`, correct Dockerfile path, port mapping,
     `VITE_API_BASE_URL: http://<name>.apphub.local:8080`, no `depends_on` needed beyond nginx
   - Add `<name>-portal` to nginx `depends_on`

7. **Verify** by telling the user to:
   - Add `127.0.0.1 <name>.apphub.local` to Windows `C:\Windows\System32\drivers\etc\hosts`
   - Run `docker compose up -d --build <name>-portal nginx`
   - Open `http://<name>.apphub.local:8080`

---

## Bootstrap command: Implementa `<app-name>`

When the user says **"Implementa `<name>`"**, generate all microservices required by the
imported portal prototype. Run these steps in order.

> **Prerequisite**: the `importa` command has already been run for `<name>`, so
> `apps/<name>/<name>-portal/src/` exists with mock data and React views.

### Step 0 — Derive the API surface from the portal source

Read every file under `apps/<name>/<name>-portal/src/`:

- `data/mock.js` → each top-level exported array = one DB table
- `context/AppContext.jsx` → state shape and mutations
- `views/**/*.jsx` + `components/**/*.jsx`:
  - Form `onSubmit` → POST / PUT endpoint
  - Array `.filter`/`.map` over mock data → GET list endpoint
  - Detail views → GET by-id endpoint
  - Button actions (delete/archive/suspend/restore) → DELETE / PATCH endpoint
  - Modal forms → POST endpoint

Produce a **service map**: `{ serviceName, type, endpoints[] }`.

### Step 1 — Classify each service (REUSE / EXTEND / IMPLEMENT / CREATE)

| Decision | Condition |
|---|---|
| **REUSE** | All needed endpoints already exist — no changes required |
| **EXTEND** | Service exists but is missing 1+ routes / schema changes |
| **IMPLEMENT** | Service is scaffolded (health endpoint only, e.g. `platform/tenant-config`) |
| **CREATE** | No service exists at all |

Reference files: `platform/*/src/routes/`, `platform/*/src/index.js` (module entry point),
`platform/core/src/server.js` (orchestrator), `infra/nginx/conf.d/upstream.conf`,
`docker-compose.yml`.

### Step 2 — EXTEND an existing service

For each new endpoint in an existing platform module:

1. `platform/<svc>/src/routes/<resource>.routes.js` — add route(s)
2. `platform/<svc>/src/services/<resource>.service.js` — business logic
3. `platform/<svc>/src/repositories/<resource>.repository.js` — SQL scoped to `tenant_id` AND `app_id`
4. `platform/<svc>/migrations/<N>_add_<resource>.sql` — ALTER / CREATE TABLE in the service schema

Pattern reference: `platform/auth/src/routes/auth.routes.js`

### Step 3 — IMPLEMENT a scaffolded module

Build out a platform module that exists but has only a `/health` stub:

1. Add `ajv-formats` to `package.json` if missing. (No need for helmet / cors / rate-limit /
   fastify itself as a runtime dep beyond peer — `platform-core` registers those once.)
2. `src/index.js` — export `register({ app, db, redis, logger })` and
   `runMigrations(superuserUrl)`
3. `src/lib/migrate.js` — auto-migration runner (reads `migrations/*.sql` sorted) bound to
   the module's schema
4. `src/routes/`, `src/services/`, `src/repositories/` — implement per endpoint. Repositories
   take a `db` Pool injected via `register`, never import a global pool
5. `migrations/001_init.sql` — table creation, indexes, RLS policies (the schema and role
   are provisioned in `infra/postgres/init/01_platform_schemas.sql`)
6. Wire the module into `platform/core/src/server.js`: import its `register` and
   `runMigrations`, create its Pool, run migrations, then register

Pattern reference: `platform/auth/` (the implemented module)

### Step 4 — CREATE a new platform module (inside `platform-core`)

Used for cross-cutting concerns not covered by existing platform modules. Adds a module
to the `platform-core` container; does **not** create a new container.

1. Create `platform/<svc>/` with module scaffold:
   - `package.json` — name `@apphub/platform-<svc>`; deps: fastify, @fastify/sensible,
     @apphub/platform-sdk, ajv-formats. (No helmet / cors / rate-limit / Dockerfile —
     those live on `platform-core`.)
   - `src/index.js` — exports `async function register({ app, db, redis, logger })`
     that registers routes under the module's prefix, plus
     `async function runMigrations(superuserUrl)`
   - `src/routes/<resource>.routes.js`, `src/services/<resource>.service.js`,
     `src/repositories/<resource>.repository.js`
   - `src/lib/migrate.js` — runs `migrations/*.sql` against the module's schema using the
     superuser URL
   - `migrations/001_init.sql` — RLS policies and tables. (The schema and role are
     provisioned in `infra/postgres/init/01_platform_schemas.sql`, not here.)
2. Register the module in `platform/core/src/server.js`: create a Pool with the module's
   role URL, call `await module.runMigrations(MIGRATION_DATABASE_URL)`, then
   `await module.register({ app, db, redis, logger })`.

### Step 5 — CREATE a new app-specific service (ports 3030+)

Used for concerns that only apply to one app. **App-specific services run in their own
container** (unlike platform modules), so they need the full standalone scaffold.

1. **Determine port**: scan `docker-compose.yml` + `upstream.conf`; pick the lowest free
   port above the app's existing service ports
2. Create `apps/<name>/<name>-<svc>/` with full scaffold:
   - `package.json` — name `@<name>/<name>-<svc>`; deps: fastify, @fastify/helmet,
     @fastify/cors, @fastify/sensible, @fastify/rate-limit, @apphub/platform-sdk, dotenv,
     ajv-formats
   - `src/app.js` — same registration pattern as `platform/auth/src/app.js` pre-monolith
     (helmet, cors, rate-limit, appGuard, sensible, route files)
   - `src/server.js` — `migrate()` then `app.listen`
   - `src/lib/{env,logger,db,redis,migrate}.js`
   - `src/routes/<resource>.routes.js`, `src/services/<resource>.service.js`,
     `src/repositories/<resource>.repository.js`
   - `migrations/001_init.sql` — schema `<app>_<svc>`, role `svc_<app>_<svc>`, tables, RLS
   - `Dockerfile` — workspace-context multi-stage; copy pnpm-workspace.yaml + packages/ +
     `apps/<name>/<name>-<svc>/package.json`; install
     `--filter @<name>/<name>-<svc>`; copy src; `CMD ["node", "src/server.js"]`

### Step 6 — PostgreSQL init SQL

For each CREATE service, add `infra/postgres/init/<N>_<svc>_schema.sql`:

```sql
CREATE SCHEMA IF NOT EXISTS <schema>;
CREATE ROLE svc_<schema> WITH LOGIN PASSWORD '${SVC_<SCHEMA>_DB_PASSWORD}';
GRANT USAGE ON SCHEMA <schema> TO svc_<schema>;
-- tables, indexes
ALTER TABLE <schema>.<table> ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON <schema>.<table>
  USING (app_id = current_setting('app.app_id')
     AND tenant_id = current_setting('app.tenant_id'));
```

### Step 7 — docker-compose.yml

**Platform module** → no new Docker service. Add the module's DB URL to the existing
`platform-core` service:

```yaml
platform-core:
  environment:
    DATABASE_URL_<SVC>: postgres://svc_platform_<svc>:${SVC_PLATFORM_<SVC>_DB_PASSWORD}@postgres:5432/apphub
```

Also add `SVC_PLATFORM_<SVC>_DB_PASSWORD` to `.env` / `.env.example`.

**App-specific service** → add a new compose service:

```yaml
<svc-name>:
  build:
    context: .
    dockerfile: apps/<app>/<app>-<svc>/Dockerfile
  ports:
    - "<port>:<port>"
  environment:
    PORT: <port>
    DATABASE_URL: postgres://svc_<schema>:${SVC_<SCHEMA>_DB_PASSWORD}@postgres:5432/apphub
    REDIS_URL: redis://redis:6379
    JWT_SECRET: ${JWT_SECRET}
    EXPECTED_APP_ID: <app-name>
  depends_on: [postgres, redis]
```

Also add app-specific services to nginx's `depends_on` list.

### Step 8 — NGINX upstream

**Platform module** → nothing to add. The single
`upstream platform_core { server platform-core:3000; }` already exists.

**App-specific service** → in `infra/nginx/conf.d/upstream.conf`:

```nginx
upstream <svc_name> { server <svc-container-name>:<port>; }
```

### Step 9 — NGINX routes

**Platform module** → add to `infra/nginx/snippets/platform-routes.conf`:

```nginx
location /api/<svc>/ {
  proxy_pass http://platform_core/;
  include /etc/nginx/snippets/proxy-headers.conf;
}
```

All platform modules proxy to the same `platform_core` upstream.

**App-specific service** → add to `infra/nginx/conf.d/<name>.conf` before `location /`,
pointing at the app-specific upstream.

### Step 10 — Portal API wrapper

Create `apps/<name>/<name>-portal/src/lib/api.js`:

```js
const BASE = import.meta.env.VITE_API_BASE_URL ?? ''

async function req(method, path, body) {
  const token = localStorage.getItem('token')
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw Object.assign(new Error(err.message ?? res.statusText), { status: res.status })
  }
  return res.status === 204 ? null : res.json()
}

export const api = {
  get:    (path)       => req('GET',    path),
  post:   (path, body) => req('POST',   path, body),
  put:    (path, body) => req('PUT',    path, body),
  patch:  (path, body) => req('PATCH',  path, body),
  delete: (path)       => req('DELETE', path),
}
```

### Step 11 — Wire portal views to the real API

For each view that imports from `../../data/mock`:

1. Remove the mock import
2. Replace with `useEffect` + `useState`:

```jsx
import { useState, useEffect } from 'react'
import { api } from '../../lib/api'

const [items, setItems] = useState([])
const [loading, setLoading] = useState(true)

useEffect(() => {
  api.get('/api/<svc>/v1/<resource>')
    .then(setItems)
    .catch(err => toast(err.message, 'danger'))
    .finally(() => setLoading(false))
}, [])
```

3. Add a loading state: `if (loading) return <div className="p-10 text-center text-ink3">Cargando…</div>`
4. Replace mock state mutations in `onSubmit` handlers with `api.post(...)` calls

### Step 12 — pnpm-workspace.yaml

Verify `apps/<name>/*` is listed. Add it if missing.

### Step 13 — Verification

Tell the user to run:

```bash
# Rebuild affected services (platform-core if any platform module changed,
# plus any app-specific service that was added/extended)
docker compose up -d --build platform-core <app-svc1> <app-svc2> ...

# Check migrations ran (platform-core logs each module's migrations on boot)
docker compose logs platform-core | grep -i "migrat"

# Health checks
curl http://<name>.apphub.local:8080/api/<svc>/health

# Confirm no mock imports remain
grep -r "from '../../data/mock'" apps/<name>/<name>-portal/src/views/
```

---

## Where to start when adding a new app

1. `cp -r apps/__app-template__/ apps/my-app/` — rename dirs, update `package.json` names
2. Assign ports: frontend at 5176+, services at 3030+
3. Register in DB: `INSERT INTO platform_tenants.apps ...`
4. Create PostgreSQL schema: `infra/postgres/init/0N_my_app_schema.sql`
5. Add services to `docker-compose.yml`
6. Add NGINX server block `infra/nginx/conf.d/my-app.conf` with
   `include /etc/nginx/snippets/platform-routes.conf`
7. Add `/etc/hosts` entry: `127.0.0.1 myapp.apphub.local`

## Platform module registry

apphub ships **two monolith containers**, each hosting a coherent domain.
See [ADR 004](docs/adr/004-domain-separated-monolith-containers.md) for the rationale.
Before adding any new horizontal capability, check whether it already exists in one of them.

### platform-core (port 3000) — horizontal infrastructure

| Capability | Module | Schema | DB role | Status |
|---|---|---|---|---|
| Auth (email/password + OAuth) | `platform/auth` | `platform_auth` | `svc_platform_auth` | ✅ Implemented |
| Stripe payments | `platform/payments` | `platform_payments` | `svc_platform_payments` | 🔧 Skeleton |
| Email / push notifications | `platform/notifications` | `platform_notifications` | `svc_platform_notifications` | ✅ Implemented |
| App & tenant registry | `platform/tenant-config` | `platform_tenants` | `svc_platform_tenants` | ✅ Implemented |
| Stripe Connect (split payments) | `platform/splitpay` | `splitpay_core` | `splitpay` (shared) | ✅ Implemented |
| Object storage (S3/MinIO presigned URLs) | `platform/storage` | `platform_storage` | `svc_platform_storage` | ✅ Implemented |

### platform-marketplace (port 3100) — marketplace transactions

| Capability | Module | Schema | DB role | Status |
|---|---|---|---|---|
| Orders (persistent ledger) | `platform/orders` | `platform_orders` | `svc_platform_orders` | ✅ Implemented |
| Inventory (stock by SKU) | `platform/inventory` | `platform_inventory` | `svc_platform_inventory` | ✅ Implemented |
| Reviews (verified + replies) | `platform/reviews` | `platform_reviews` | `svc_platform_reviews` | ✅ Implemented |
| Messaging (buyer ↔ vendor) | `platform/messaging` | `platform_messaging` | `svc_platform_messaging` | ✅ Implemented |
| Shipping (zones, rates, tracking) | `platform/shipping` | `platform_shipping` | `svc_platform_shipping` | ✅ Implemented |
| Disputes (operational, pre-chargeback) | `platform/disputes` | `platform_disputes` | `svc_platform_disputes` | ✅ Implemented |
| Product & service catalogue | `platform/catalog` | `platform_catalog` | `svc_platform_catalog` | ✅ Implemented |
| Shopping cart (Redis-only) | `platform/basket` | — | — | ✅ Implemented |

### platform-restaurant (port 3200) — restaurant operations

| Capability | Module | Schema | DB role | Status |
|---|---|---|---|---|
| F&B menu (modifiers, allergens, availability windows, 86-list) | `platform/menu` | `platform_menu` | `svc_platform_menu` | ✅ Implemented |
| Reservations + waitlist | `platform/reservations` | `platform_reservations` | `svc_platform_reservations` | ✅ Implemented |
| Floor plan / tables / sections | `platform/floor-plan` | `platform_floor_plan` | `svc_platform_floor_plan` | ✅ Implemented |
| Kitchen Display System | `platform/kds` | `platform_kds` | `svc_platform_kds` | ✅ Implemented |
| POS bills / split / tips / mixed payments | `platform/pos` | `platform_pos` | `svc_platform_pos` | ✅ Implemented |
| Delivery dispatch (riders, zones, GPS, fleet) | `platform/delivery-dispatch` | `platform_delivery_dispatch` | `svc_platform_delivery_dispatch` | ✅ Implemented |

### platform-appointments (port 3300) — appointment / scheduling

| Capability | Module | Schema | DB role | Status |
|---|---|---|---|---|
| Bookable services catalog (duration, buffers, modality) | `platform/services` | `platform_services` | `svc_platform_services` | ✅ Implemented |
| Resources — practitioners, rooms, equipment, schedules | `platform/resources` | `platform_resources` | `svc_platform_resources` | ✅ Implemented |
| Bookings — appointment FSM, recurrence, reschedule, waitlist | `platform/bookings` | `platform_bookings` | `svc_platform_bookings` | ✅ Implemented |
| Availability engine — slot computation + atomic Redis holds | `platform/availability` | `platform_availability` | `svc_platform_availability` | ✅ Implemented |
| Intake forms — pre-appointment questionnaires + signatures | `platform/intake-forms` | `platform_intake_forms` | `svc_platform_intake_forms` | ✅ Implemented |
| Telehealth — video room provisioning + tokens | `platform/telehealth` | `platform_telehealth` | `svc_platform_telehealth` | ✅ Implemented |
| Packages — prepaid session bundles, balance + expiry | `platform/packages` | `platform_packages` | `svc_platform_packages` | ✅ Implemented |
| Practitioner payouts — commissions, accruals, periodic close | `platform/practitioner-payouts` | `platform_practitioner_payouts` | `svc_platform_practitioner_payouts` | ✅ Implemented |

### platform-scheduler (port 3400) — single-runner cron

Cron-as-a-service container that polls Postgres + Redis and publishes events to
the other 4 monoliths. Runs as `replicas: 1` to guarantee exactly-once. Each
job uses Postgres advisory locks to skip overlapping ticks. Has its own role
`svc_platform_scheduler` with `BYPASSRLS` and minimal cross-schema GRANTs.
No public NGINX route in V1; admin endpoints (`/v1/scheduler/jobs`,
`/v1/scheduler/runs`, `/v1/scheduler/jobs/:name/run`) are reachable only over
the docker network. See [ADR 007](docs/adr/007-platform-scheduler.md).

| Job | Cron | Effect |
|---|---|---|
| `availability-hold-purge` | `* * * * *` | DELETE expired holds |
| `booking-reminders` | `*/5 * * * *` | publish `booking.reminder.due` (T-24h, T-2h) |
| `booking-recurrence-expander` | `0 * * * *` | materialize recurrent bookings 30 days ahead |
| `reservation-reminders` | `*/5 * * * *` | publish `reservation.reminder.due` |
| `package-expiry-warning` | `0 8 * * *` | publish `package.expiring` (T-30d, T-7d) |
| `package-expiry-transition` | `30 0 * * *` | flip active → expired |
| `practitioner-payout-close` | `0 2 * * *` | publish `payout.period_due` per schedule |
| `dispute-sla` | `*/30 * * * *` | publish `dispute.sla_breached` (>48h no vendor reply) |
| `basket-abandoned` | `0 * * * *` | publish `basket.abandoned` for idle baskets |

### Planned

| Capability | Module | Status |
|---|---|---|
| Subscriptions / recurring billing | `platform/subscriptions` | 📋 Planned (slot reserved in platform-core) |

**OAuth providers supported by the `auth` module:** Google (`credential` id_token), Facebook (`accessToken`).
Routes: `POST /v1/auth/oauth/google`, `POST /v1/auth/oauth/facebook`.

## Where to start when adding a new platform module

1. **Check the registry above first** — if a skeleton exists, implement it rather than scaffolding a new module.
2. Copy any existing implemented module (e.g. `platform/auth/`) as a template.
3. Add the dedicated DB role and schema to `infra/postgres/init/01_platform_schemas.sql`.
4. Export `register({ app, db, redis, logger })` and `runMigrations(superuserUrl)` from
   `platform/<svc>/src/index.js`.
5. Register the module in `platform/core/src/server.js`: create the module's Pool with its
   own role URL, call `await module.runMigrations(MIGRATION_DATABASE_URL)`, then
   `await module.register(deps)`.
6. Add `DATABASE_URL_<SVC>` and `SVC_PLATFORM_<SVC>_DB_PASSWORD` to the `platform-core`
   service in `docker-compose.yml`.
7. Add a route prefix in `infra/nginx/snippets/platform-routes.conf` pointing at the
   `platform_core` upstream.
8. Update the platform module registry above and `ARCHITECTURE.md`.

## Environment variables

All secrets live in `.env` (never committed). See `.env.example` for required keys.
Platform-wide secrets use the prefix `PLATFORM_`. App-specific secrets use the app
prefix (e.g. `SPLITPAY_` for split-pay services).
