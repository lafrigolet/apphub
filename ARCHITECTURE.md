# Architecture

## Overview

SplitPay is a multi-tenant platform built as a monorepo of microservices.
Each microservice is independently deployable, owns its own PostgreSQL schema,
and communicates with others only via HTTP APIs (no shared DB queries across services).

## Multi-tenancy model

```
Platform (your infrastructure)
  └── Tenant (a client's app)          tenant_id uuid
        └── Sub-tenant (optional)      sub_tenant_id uuid (nullable)
              └── End users
```

- **tenant_id** is present in every table row, every JWT, every API call.
- **sub_tenant_id** is nullable — a `NULL` value means the resource belongs to the root tenant.
- Row-level security (RLS) in PostgreSQL enforces isolation at the DB level,
  regardless of application bugs.

## Domain routing

```
tienda-ana.com  ──CNAME──►  proxy.splitpay.app
pedro.splitpay.app         ──►  (wildcard DNS)
                                      │
                               Caddy / Traefik
                               (TLS termination,
                                on-demand Let's Encrypt)
                                      │
                            Tenant Resolver middleware
                            (Host header → tenant_id)
                                      │
                              App (same React build,
                               config injected per tenant)
```

## PostgreSQL schema-per-service

One PostgreSQL instance, one schema per microservice:

```
PostgreSQL instance
├── schema: payments      (split-payments service)
├── schema: auth          (auth service)
├── schema: notifications (notifications service)
└── schema: tenants       (tenant-config service)
```

Each service connects with its own PostgreSQL role that only has access to its schema.
Cross-schema queries are never allowed.

## Scaling strategy

Applied in order, only when the previous level is insufficient:

1. **Redis cache** — eliminates 80%+ of repetitive reads (tenant config, split rules, sessions)
2. **Read replicas** — offload SELECTs (reporting, dashboards) from the primary
3. **Table partitioning** — partition high-volume tables by `tenant_id`
4. **Schema extraction** — move a specific schema to its own PostgreSQL instance (change connection string only, no code changes)
5. **Citus / Aurora** — only if you reach millions of tenants

## Idempotency

All Stripe API calls carry an `Idempotency-Key` header derived from the internal
operation ID. Keys are stored in Redis with a 24-hour TTL to prevent duplicate charges
on network retries.

## Webhook processing

```
Stripe ──► POST /v1/webhooks/stripe
               │
           Verify Stripe-Signature (reject if invalid)
               │
           Publish to internal Event Bus (Redis Streams or RabbitMQ)
               │
      ┌────────┴────────┐
  Payments handler   Notifications handler
  (update TX status)  (send merchant email)
```

Webhook processing is always asynchronous. The HTTP endpoint returns 200 immediately
after signature verification; actual processing happens in a worker.

## Monorepo tooling

- **pnpm workspaces** — shared `node_modules`, no duplication
- **Turborepo** — incremental builds and test runs (only rebuilds what changed)
- **Docker Compose** — identical environment in local, CI, and staging

## Architecture Decision Records

ADRs are stored in `docs/adr/`. Current decisions:

| # | Decision |
|---|---|
| 001 | Use PostgreSQL schemas instead of separate databases per service |
| 002 | Use Caddy for automatic TLS on custom domains |
| 003 | Use Redis Streams for internal event bus (avoid RabbitMQ operational overhead at early stage) |
| 004 | Use pnpm workspaces + Turborepo over Nx or Lerna |
| 005 | Two-level tenancy (tenant_id + sub_tenant_id) modelled from day one |
