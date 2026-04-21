# CLAUDE.md

This file provides context for AI assistants (Claude, Copilot, etc.) working in this repository.

## Project overview

AppHub is a multi-app meta-platform. Each hosted app (yoga-studio, split-pay, …) gets its
own subdomain (`yoga.apphub.com`, `splitpay.apphub.com`) and its own set of app-specific
microservices. All apps share a set of cross-cutting platform services (auth, payments,
notifications, catalog, basket, tenant-config).

## Repository structure

```
apphub/
├── platform/                  # Shared platform microservices — ports 3000–3009
│   ├── auth/                  # JWT auth + multi-app registration — port 3000
│   ├── payments/              # Stripe Connect gateway — port 3001
│   ├── notifications/         # Email / push / SMS — port 3002
│   ├── catalog/               # Product & service catalogue — port 3003
│   ├── basket/                # Shopping cart (Redis-only) — port 3004
│   └── tenant-config/         # App & tenant registry — port 3005
├── apps/                      # App bundles (frontend + app-specific services)
│   ├── portal/                # AppHub admin UI — port 5173
│   ├── yoga-studio/           # Yoga Studio app — ports 3011–3017, 5174
│   ├── split-pay/             # Split Pay app — ports 3020, 5175
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
- **Database**: PostgreSQL 16 — one schema per microservice
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
4. **Never cross schema boundaries** — a service may only query its own PostgreSQL schema.
5. **Validate webhook signatures** — every incoming Stripe webhook must verify `Stripe-Signature`.
6. **Split reversals are proportional** — refund each Transfer by the same percentage as the
   original split, never a flat amount.
7. **sub_tenant_id is nullable** — code must handle both single-level and two-level tenancy.
8. **Use `appGuard` from `@apphub/platform-sdk`** — never write a custom JWT guard. Set
   `EXPECTED_APP_ID` in the service env; the guard returns `403 APP_MISMATCH` on mismatch.
9. **Write JavaScript, not TypeScript** — all services and frontends use `.js` / `.jsx`.

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

6. **Add to `docker-compose.yml`**:
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

Reference files: `platform/*/src/routes/`, `platform/*/src/app.js`,
`infra/nginx/conf.d/upstream.conf`, `docker-compose.yml`.

### Step 2 — EXTEND an existing service

For each new endpoint in an existing platform service:

1. `platform/<svc>/src/routes/<resource>.routes.js` — add route(s)
2. `platform/<svc>/src/services/<resource>.service.js` — business logic
3. `platform/<svc>/src/repositories/<resource>.repository.js` — SQL scoped to `tenant_id` AND `app_id`
4. `platform/<svc>/migrations/<N>_add_<resource>.sql` — ALTER / CREATE TABLE in the service schema

Pattern reference: `platform/auth/src/routes/auth.routes.js`

### Step 3 — IMPLEMENT a scaffolded service

Build out a service that exists but has only a `/health` stub:

1. Add `fastify-plugin`, `@fastify/rate-limit`, `ajv-formats` to `package.json`
2. `src/app.js` — register `helmet`, `cors`, `rate-limit`, `appGuard`, `sensible`, route files
3. `src/lib/env.js` — declare and validate env vars
4. `src/lib/db.js` — `createPool` from `@apphub/platform-sdk`; export `setTenantCtx`
5. `src/lib/redis.js` — `createRedis` from `@apphub/platform-sdk`
6. `src/lib/migrate.js` — auto-migration runner (reads `migrations/*.sql` sorted)
7. `src/server.js` — call `migrate()` then `app.listen`
8. `src/routes/`, `src/services/`, `src/repositories/` — implement per endpoint
9. `migrations/001_init.sql` — full schema creation

Pattern reference: `platform/auth/` (all files)

### Step 4 — CREATE a new platform service (ports 3006–3009)

Used for cross-cutting concerns not covered by existing platform services.

1. **Determine port**: scan `docker-compose.yml` + `upstream.conf`; pick lowest free port in 3006–3009
2. Create `platform/<svc>/` with full scaffold:
   - `package.json` — name `@apphub/platform-<svc>`; deps: fastify, @fastify/helmet,
     @fastify/cors, @fastify/sensible, @fastify/rate-limit, @apphub/platform-sdk, dotenv, ajv-formats
   - `src/app.js` — same registration pattern as `platform/auth/src/app.js`
   - `src/server.js` — `migrate()` then `app.listen`
   - `src/lib/{env,logger,db,redis,migrate}.js`
   - `src/plugins/app-guard.js` — thin wrapper re-exporting `appGuard` from `@apphub/platform-sdk`
   - `src/utils/errors.js` — re-exports `AppError` and subclasses from platform-sdk
   - `src/routes/<resource>.routes.js`, `src/services/<resource>.service.js`,
     `src/repositories/<resource>.repository.js`
   - `migrations/001_init.sql` — schema `platform_<svc>`, role `svc_platform_<svc>`, tables, RLS
   - `Dockerfile` — workspace-context multi-stage; copy pnpm-workspace.yaml + packages/ +
     `platform/<svc>/package.json`; install `--filter @apphub/platform-<svc>`;
     copy src; `CMD ["node", "src/server.js"]`

### Step 5 — CREATE a new app-specific service (ports 3030+)

Used for concerns that only apply to one app.

Same scaffold as Step 4, but:
- Located at `apps/<name>/<name>-<svc>/`
- `package.json` name: `@<name>/<name>-<svc>`
- Schema: `<app>_<svc>`, role: `svc_<app>_<svc>`
- Port: next free port above the app's existing service ports

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

For each CREATE service add:

```yaml
<svc-name>:
  build:
    context: .
    dockerfile: platform/<svc>/Dockerfile   # or apps/<app>/<app>-<svc>/Dockerfile
  ports:
    - "<port>:<port>"
  environment:
    PORT: <port>
    DATABASE_URL: postgres://svc_<schema>:${SVC_<SCHEMA>_DB_PASSWORD}@postgres:5432/apphub
    REDIS_URL: redis://redis:6379
    JWT_SECRET: ${JWT_SECRET}
    EXPECTED_APP_ID: <app-name>   # omit for cross-cutting platform services
  depends_on: [postgres, redis]
```

Also add the new service to nginx's `depends_on` list.

### Step 8 — NGINX upstream

In `infra/nginx/conf.d/upstream.conf`:

```nginx
upstream <svc_name> { server <svc-container-name>:<port>; }
```

### Step 9 — NGINX routes

**Platform service** → add to `infra/nginx/snippets/platform-routes.conf`:

```nginx
location /api/<svc>/ {
  proxy_pass http://<svc_name>/;
  include /etc/nginx/snippets/proxy-headers.conf;
}
```

**App-specific service** → add to `infra/nginx/conf.d/<name>.conf` before `location /`.

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
# Rebuild affected services
docker compose up -d --build <svc1> <svc2> ...

# Check migrations ran
docker compose logs <svc1> | grep "migration"

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

## Where to start when adding a new platform service

1. Copy any existing `platform/` service as a template
2. Assign the next port in the 3000–3009 range
3. Create a new PostgreSQL schema in `infra/postgres/init/01_platform_schemas.sql`
4. Add the service to `docker-compose.yml`
5. Add a route to `infra/nginx/snippets/platform-routes.conf`

## Environment variables

All secrets live in `.env` (never committed). See `.env.example` for required keys.
Platform-wide secrets use the prefix `PLATFORM_`. App-specific secrets use the app
prefix (e.g. `SPLITPAY_` for split-pay services).
