# AppHub

Multi-app meta-platform. Each hosted app (aikikan, split-pay, …) gets its own
subdomain and its own app-specific microservices. All apps share a set of cross-cutting
platform capabilities (auth, payments, notifications, catalog, basket, tenant-config,
orders, inventory, reviews, messaging, shipping, disputes, menu, reservations,
floor-plan, kds, pos, delivery-dispatch).

## Architecture

```
apphub/
├── apps/                      # App bundles (frontends + app-specific services)
├── platform/                  # Three modular monoliths + their modules
│   ├── core/                  # platform-core    — port 3000
│   ├── marketplace/           # platform-marketplace — port 3100
│   ├── restaurant/            # platform-restaurant  — port 3200
│   └── <module>/              # one directory per in-process module
├── packages/                  # Shared packages (eslint-config, sdk-js, platform-sdk)
├── infra/                     # Docker, NGINX, PostgreSQL init
├── docker-compose.yml         # Local development orchestration
└── turbo.json                 # Turborepo task pipeline
```

The platform side ships as **three modular-monolith containers**. Each container hosts
several modules in-process; each module owns its own Postgres schema, dedicated DB role,
and routes. Modules are "ready to split" — any one can be extracted to its own container
without business-logic changes.

## Key concepts

- **Tenant**: a deployment of a hosted app, identified by `tenant_id`
- **Sub-tenant**: optional second isolation level within a tenant (e.g. franchise branches)
- **app_id + tenant_id + sub_tenant_id**: three-claim JWT identity, enforced by
  `appGuard` and Postgres row-level security
- **Schema-per-module**: each module owns its PostgreSQL schema; no cross-schema JOINs
- **Row-level security**: every table is isolated by `app_id` + `tenant_id` + optional
  `sub_tenant_id` at the DB level
- **Modular monolith ready to split**: modules co-deploy by domain, but each one can be
  extracted to its own container if it needs independent scaling

## Quick start

```bash
# Prerequisites: Docker, Node 20+, pnpm 9+
cp .env.example .env          # fill in your Stripe / Resend / OAuth keys
pnpm install
docker compose up -d          # starts postgres, redis, the three monoliths,
                              # all app services and frontends, plus NGINX
./scripts/bootstrap.sh        # creates the first super_admin (idempotent)
```

Open http://console.hulkstein.local:8080 (after adding the alias to
`/etc/hosts`) and start registering apps.

## Platform monoliths

| Container | Port | Modules |
|---|---|---|
| `platform-core` | 3000 | auth, payments, notifications, tenant-config, splitpay |
| `platform-marketplace` | 3100 | orders, inventory, reviews, messaging, shipping, disputes, catalog, basket |
| `platform-restaurant` | 3200 | menu, reservations, floor-plan, kds, pos, delivery-dispatch |

NGINX routes `/api/<module>/*` from any subdomain to the right monolith.

## Documentation

- [CLAUDE.md](./CLAUDE.md) — AI assistant context and platform module registry
- [ARCHITECTURE.md](./ARCHITECTURE.md) — Architecture, ADRs, container topology
- [CONVENTIONS.md](./CONVENTIONS.md) — Code conventions
- [CONTRIBUTING.md](./CONTRIBUTING.md) — How to contribute
- [DEVELOPMENT.md](./DEVELOPMENT.md) — Local development guide
- [RUN.md](./RUN.md) — How to run the platform
- [COMMANDS.md](./COMMANDS.md) — Quick reference for compose / pnpm / psql / redis
- [CHANGELOG.md](./CHANGELOG.md) — Notable changes
- [docs/](./docs/README.md) — Index of architecture, design specs and runbooks
- [docs/adr/](./docs/adr/README.md) — Architecture decision records
- [docs/runbooks/platform-bootstrap.md](./docs/runbooks/platform-bootstrap.md) — First-boot bootstrap script reference
- [docs/runbooks/tenant-onboarding.md](./docs/runbooks/tenant-onboarding.md) — Provision a new tenant
