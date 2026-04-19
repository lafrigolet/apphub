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
