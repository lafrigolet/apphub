---
description: Generate all microservices required by the imported portal prototype (REUSE/EXTEND/IMPLEMENT/CREATE)
argument-hint: <app-name>
---

# Implementa `$ARGUMENTS`

Generate all microservices required by the imported portal prototype. Run
these steps in order.

> **Prerequisite**: the `importa` command has already been run for `<name>`,
> so `apps/<name>/<name>-portal/src/` exists with mock data and React views.

## Step 0 — Derive the API surface from the portal source

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

## Step 1 — Classify each service (REUSE / EXTEND / IMPLEMENT / CREATE)

| Decision | Condition |
|---|---|
| **REUSE** | All needed endpoints already exist — no changes required |
| **EXTEND** | Service exists but is missing 1+ routes / schema changes |
| **IMPLEMENT** | Service is scaffolded (health endpoint only, e.g. `platform/tenant-config`) |
| **CREATE** | No service exists at all |

Reference files: `platform/*/src/routes/`, `platform/*/src/index.js` (module
entry point), `platform/core/src/server.js` (orchestrator),
`infra/nginx/conf.d/upstream.conf`, `docker-compose.yml`.

## Step 2 — EXTEND an existing service

For each new endpoint in an existing platform module:

1. `platform/<svc>/src/routes/<resource>.routes.js` — add route(s)
2. `platform/<svc>/src/services/<resource>.service.js` — business logic
3. `platform/<svc>/src/repositories/<resource>.repository.js` — SQL scoped
   to `tenant_id` AND `app_id`
4. `platform/<svc>/migrations/<N>_add_<resource>.sql` — ALTER / CREATE
   TABLE in the service schema

Pattern reference: `platform/auth/src/routes/auth.routes.js`

## Step 3 — IMPLEMENT a scaffolded module

Build out a platform module that exists but has only a `/health` stub:

1. Add `ajv-formats` to `package.json` if missing. (No need for helmet /
   cors / rate-limit / fastify itself as a runtime dep beyond peer —
   `platform-core` registers those once.)
2. `src/index.js` — export `register({ app, db, redis, logger })` and
   `runMigrations(superuserUrl)`
3. `src/lib/migrate.js` — auto-migration runner (reads `migrations/*.sql`
   sorted) bound to the module's schema
4. `src/routes/`, `src/services/`, `src/repositories/` — implement per
   endpoint. Repositories take a `db` Pool injected via `register`, never
   import a global pool
5. `migrations/001_init.sql` — table creation, indexes, RLS policies (the
   schema and role are provisioned in
   `infra/postgres/init/01_platform_schemas.sql`)
6. Wire the module into `platform/core/src/server.js`: import its
   `register` and `runMigrations`, create its Pool, run migrations, then
   register

Pattern reference: `platform/auth/` (the implemented module)

## Step 4 — CREATE a new platform module (inside `platform-core`)

Used for cross-cutting concerns not covered by existing platform modules.
Adds a module to the `platform-core` container; does **not** create a new
container.

1. Create `platform/<svc>/` with module scaffold:
   - `package.json` — name `@apphub/platform-<svc>`; deps: fastify,
     @fastify/sensible, @apphub/platform-sdk, ajv-formats. (No helmet /
     cors / rate-limit / Dockerfile — those live on `platform-core`.)
   - `src/index.js` — exports
     `async function register({ app, db, redis, logger })` that registers
     routes under the module's prefix, plus
     `async function runMigrations(superuserUrl)`
   - `src/routes/<resource>.routes.js`,
     `src/services/<resource>.service.js`,
     `src/repositories/<resource>.repository.js`
   - `src/lib/migrate.js` — runs `migrations/*.sql` against the module's
     schema using the superuser URL
   - `migrations/001_init.sql` — RLS policies and tables. (The schema and
     role are provisioned in
     `infra/postgres/init/01_platform_schemas.sql`, not here.)
2. Register the module in `platform/core/src/server.js`: create a Pool
   with the module's role URL, call
   `await module.runMigrations(MIGRATION_DATABASE_URL)`, then
   `await module.register({ app, db, redis, logger })`.

## Step 5 — CREATE the app monolith (one container per app, ports 3030+)

Per ADR 013, app-specific code runs in **one monolith container per app**
with a **single schema `app_<app>` and a single role `svc_app_<app>`**.
Different domains (members, events, dues, …) live in folders within the
same `src/` tree, NOT in separate schemas. Granular schema separation is
reserved for `platform_*` modules.

1. **Determine port**: scan `docker-compose.yml` + `upstream.conf`; pick
   the lowest free port ≥ 3030.
2. Create `apps/<app>/<app>-server/` with the full scaffold:
   - `package.json` — name `@<app>/<app>-server`; deps: fastify,
     @fastify/helmet, @fastify/cors, @fastify/sensible,
     @fastify/rate-limit, @apphub/platform-sdk, dotenv, ajv-formats, pg,
     ioredis.
   - `src/app.js` — same registration pattern as
     `platform/auth/src/app.js` (helmet, cors, rate-limit, appGuard with
     `EXPECTED_APP_ID=<app>`, sensible, route files for every dominio).
   - `src/server.js` — `runMigrations()` then
     `app.listen({ port: 3030, host: '0.0.0.0' })`.
   - `src/lib/{env,logger,db,redis,migrate}.js`. The `db.js` exposes a
     single Pool using `svc_app_<app>` and the `withTenantTransaction`
     helper from `@apphub/platform-sdk/db`.
   - `src/routes/<dominio>.routes.js`,
     `src/services/<dominio>.service.js`,
     `src/repositories/<dominio>.repository.js` — one set per dominio.
     ALL repos query `app_<app>.<table>` (the same single schema) — never
     another app's, never `platform_*`.
   - `src/events/` — Redis subscribers to `platform:events` (e.g.
     `user.revoked` → delete the matching row in the app's tables).
   - `migrations/001_init.sql`, `migrations/0002_…sql`, … — one shared
     sequence; tables across all dominios live here. The schema and role
     themselves are provisioned in
     `infra/postgres/init/<N>_app_<app>_schema.sql`, not in the
     migrations.
   - `Dockerfile` — workspace-context multi-stage; copy
     pnpm-workspace.yaml + packages/ +
     `apps/<app>/<app>-server/package.json`; install
     `--filter @<app>/<app>-server`; copy src;
     `CMD ["node", "--watch", "src/server.js"]` (development) /
     `CMD ["node", "src/server.js"]` (production).
3. Cross-app communication MUST use HTTP module APIs or Redis events.
   Direct SQL into `platform_*` from the app monolith is forbidden — same
   rule as between platform modules.

## Step 6 — PostgreSQL init SQL

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

## Step 7 — docker-compose.yml

**Platform module** → no new Docker service. Add the module's DB URL to
the existing `platform-core` service:

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

## Step 8 — NGINX upstream

**Platform module** → nothing to add. The single
`upstream platform_core { server platform-core:3000; }` already exists.

**App-specific service** → in `infra/nginx/conf.d/upstream.conf`:

```nginx
upstream <svc_name> { server <svc-container-name>:<port>; }
```

## Step 9 — NGINX routes

**Platform module** → add to
`infra/nginx/snippets/platform-routes.conf`:

```nginx
location /api/<svc>/ {
  proxy_pass http://platform_core/;
  include /etc/nginx/snippets/proxy-headers.conf;
}
```

All platform modules proxy to the same `platform_core` upstream.

**App-specific service** → add to `infra/nginx/conf.d/<name>.conf` before
`location /`, pointing at the app-specific upstream.

## Step 10 — Portal API wrapper

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

## Step 11 — Wire portal views to the real API

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

3. Add a loading state:
   `if (loading) return <div className="p-10 text-center text-ink3">Cargando…</div>`
4. Replace mock state mutations in `onSubmit` handlers with `api.post(...)`
   calls

## Step 12 — pnpm-workspace.yaml

Verify `apps/<name>/*` is listed. Add it if missing.

## Step 13 — Verification

Tell the user to run:

```bash
# Rebuild affected services (platform-core if any platform module changed,
# plus any app-specific service that was added/extended)
docker compose up -d --build platform-core <app-svc1> <app-svc2> ...

# Check migrations ran (platform-core logs each module's migrations on boot)
docker compose logs platform-core | grep -i "migrat"

# Health checks
curl http://<name>.hulkstein.local:8080/api/<svc>/health

# Confirm no mock imports remain
grep -r "from '../../data/mock'" apps/<name>/<name>-portal/src/views/
```
