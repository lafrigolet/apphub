# SplitPay Platform

Multi-tenant platform for embedding split payment capabilities into any web application via Stripe Connect.

## Architecture

```
splitpay-platform/
├── apps/                    # React frontends (one per client app)
├── services/                # Shared microservices
│   └── split-payments/      # Stripe Connect split payments microservice
├── packages/                # Shared code
│   ├── sdk-js/              # JS client SDK for frontends
│   ├── ui-components/       # Shared React component library
│   └── eslint-config/       # Shared ESLint rules
├── infra/                   # Docker, Nginx, CI/CD config
│   ├── nginx/
│   └── postgres/
├── docker-compose.yml       # Local development orchestration
├── docker-compose.prod.yml  # Production overrides
└── turbo.json               # Turborepo task pipeline
```

## Key concepts

- **Tenant**: a client app registered on the platform, identified by `tenant_id`
- **Sub-tenant**: optional second isolation level within a tenant (e.g. marketplace vendors, SaaS orgs)
- **Schema-per-service**: each microservice owns its PostgreSQL schema; no cross-service JOINs
- **Row-level security**: every table is isolated by `tenant_id` + optional `sub_tenant_id` at the DB level

## Quick start

```bash
# Prerequisites: Docker, Node 20+, pnpm 9+
cp .env.example .env          # fill in your Stripe keys
pnpm install
docker compose up -d          # starts postgres, redis, all services
pnpm dev                      # starts all apps and services in watch mode
```

## Services

| Service | Port | Description |
|---|---|---|
| split-payments | 3001 | Stripe Connect split payments |
| auth | 3002 | JWT authentication (coming soon) |
| notifications | 3003 | Email / push notifications (coming soon) |
| tenant-config | 3004 | Tenant provisioning and domain management (coming soon) |

## Documentation

- [CLAUDE.md](./CLAUDE.md) — AI assistant context and guidelines
- [CONVENTIONS.md](./CONVENTIONS.md) — Code conventions
- [CONTRIBUTING.md](./CONTRIBUTING.md) — How to contribute
- [DEVELOPMENT.md](./DEVELOPMENT.md) — Local development guide
- [ARCHITECTURE.md](./ARCHITECTURE.md) — Architecture decisions and diagramsn
- [RUN.md](./RUN.md) — How to run the platform
