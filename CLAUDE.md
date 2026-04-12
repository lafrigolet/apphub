# CLAUDE.md

This file provides context for AI assistants (Claude, Copilot, etc.) working in this repository.

## Project overview

SplitPay Platform is a multi-tenant SaaS that allows third-party web applications to embed
Stripe Connect split payment functionality. Clients register a tenant, get a subdomain
(`tenant.splitpay.app`), and optionally point their own domain via CNAME.

## Repository structure

```
splitpay-platform/
├── apps/                    # React 18 + Tailwind + Vite frontends
├── services/                # Node.js microservices (Express + TypeScript)
│   └── split-payments/      # Core payments microservice — START HERE
├── packages/                # Internal shared packages (pnpm workspaces)
├── infra/                   # Docker and infrastructure config
└── docs/                    # Architecture diagrams and ADRs
```

## Tech stack

- **Runtime**: Node.js 20 LTS
- **Language**: TypeScript 5 (strict mode, no `any`)
- **Framework**: Express 5 for services, React 18 for apps
- **Styling**: Tailwind CSS 3
- **Database**: PostgreSQL 16 — one schema per microservice
- **Cache**: Redis 7
- **Payments**: Stripe Node SDK (latest)
- **Testing**: Vitest + Supertest
- **Containerisation**: Docker + Docker Compose
- **Monorepo**: pnpm workspaces + Turborepo
- **CI/CD**: GitHub Actions

## Multi-tenancy model

Every database table has two columns for isolation:
- `tenant_id uuid NOT NULL` — always present, identifies the client app
- `sub_tenant_id uuid` — nullable, for apps that need a second isolation level

Row-level security (RLS) is enforced at the PostgreSQL level.
The application layer passes `tenant_id` (and optionally `sub_tenant_id`) via JWT claims.

## Critical rules for AI assistants

1. **Never remove `tenant_id` scoping** from any database query. Every SELECT, INSERT, UPDATE,
   DELETE must be scoped to the current tenant.
2. **Always use idempotency keys** for Stripe API calls. Keys are stored in Redis with a 24h TTL.
3. **Never cross schema boundaries** — a service may only query its own PostgreSQL schema.
4. **Validate webhook signatures** — every incoming Stripe webhook must verify `Stripe-Signature`.
5. **Split reversals are proportional** — when issuing a refund, reverse each Transfer by the
   same percentage as the original split, never a flat amount.
6. **sub_tenant_id is nullable** — code must handle both single-level and two-level tenancy.

## Naming conventions

- Files: `kebab-case.ts`
- Classes / types / interfaces: `PascalCase`
- Functions / variables: `camelCase`
- Database columns: `snake_case`
- Environment variables: `SCREAMING_SNAKE_CASE`
- API routes: `/v1/resource-name` (kebab, versioned)

## Where to start when adding a new microservice

1. Copy `services/split-payments` as a template
2. Create a new PostgreSQL schema in `infra/postgres/init/`
3. Add the service to `docker-compose.yml`
4. Add a `turbo.json` pipeline entry
5. Register the route in `infra/nginx/nginx.conf`

## Environment variables

All secrets live in `.env` (never committed). See `.env.example` for required keys.
Each service reads only its own prefix (e.g. `PAYMENTS_` for split-payments).
