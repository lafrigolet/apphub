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
10. **Check `platform/` before building any new microservice** — auth, payments, notifications,
    catalog, basket, and tenant-config are already implemented there. If a new app needs one of
    these capabilities, wire it to the existing platform service instead of creating a duplicate.
    See the platform service registry below.
11. **Each microservice connects with its own dedicated DB role** — never use the shared
    superuser `DATABASE_URL` at runtime. Set `DATABASE_URL` to `postgresql://svc_<service>:...`
    and `MIGRATION_DATABASE_URL` to the superuser. `migrate.js` uses `MIGRATION_DATABASE_URL`;
    the application pool uses `DATABASE_URL`.
12. **Update `.md` files after any significant implementation** — keep `ARCHITECTURE.md`,
    `CHANGELOG.md`, `CONVENTIONS.md`, and `DEVELOPMENT.md` in sync with what was built.
    Specifically: new services → `ARCHITECTURE.md` + `DEVELOPMENT.md`; new patterns →
    `CONVENTIONS.md`; any change → `CHANGELOG.md` unreleased section.

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

## Where to start when adding a new app

1. `cp -r apps/__app-template__/ apps/my-app/` — rename dirs, update `package.json` names
2. Assign ports: frontend at 5176+, services at 3030+
3. Register in DB: `INSERT INTO platform_tenants.apps ...`
4. Create PostgreSQL schema: `infra/postgres/init/0N_my_app_schema.sql`
5. Add services to `docker-compose.yml`
6. Add NGINX server block `infra/nginx/conf.d/my-app.conf` with
   `include /etc/nginx/snippets/platform-routes.conf`
7. Add `/etc/hosts` entry: `127.0.0.1 myapp.apphub.local`

## Platform service registry

Before building any new backend capability, check whether it already exists:

| Capability | Service | Port | Status |
|---|---|---|---|
| Auth (email/password + OAuth) | `platform/auth` | 3000 | ✅ Implemented |
| Stripe payments | `platform/payments` | 3001 | 🔧 Skeleton |
| Email / push notifications | `platform/notifications` | 3002 | ✅ Implemented |
| Product & service catalogue | `platform/catalog` | 3003 | 🔧 Skeleton |
| Shopping cart (Redis-only) | `platform/basket` | 3004 | 🔧 Skeleton |
| App & tenant registry | `platform/tenant-config` | 3005 | 🔧 Skeleton |

**OAuth providers supported by `platform/auth`:** Google (`credential` id_token), Facebook (`accessToken`).
Routes: `POST /v1/auth/oauth/google`, `POST /v1/auth/oauth/facebook`.

## Where to start when adding a new platform service

1. **Check the registry above first** — if a skeleton exists, implement it rather than creating a new service.
2. Copy any existing implemented service (e.g. `platform/auth`) as a template.
3. Assign the next port in the 3000–3009 range.
4. Add the dedicated DB role to `infra/postgres/init/01_platform_schemas.sql`.
5. In `docker-compose.yml`: set `DATABASE_URL` to the service role, add `MIGRATION_DATABASE_URL` (superuser).
6. Add the service to `docker-compose.yml`.
7. Add a route to `infra/nginx/snippets/platform-routes.conf`.
8. Update the platform service registry table above and `ARCHITECTURE.md`.

## Environment variables

All secrets live in `.env` (never committed). See `.env.example` for required keys.
Platform-wide secrets use the prefix `PLATFORM_`. App-specific secrets use the app
prefix (e.g. `SPLITPAY_` for split-pay services).
