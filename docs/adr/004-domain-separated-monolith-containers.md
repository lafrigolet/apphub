# ADR 004 — Domain-separated monolith containers

**Date**: 2026-04-29
**Status**: Accepted
**Related**: [ADR 003](003-dynamic-nginx-routing.md)

## Context

apphub started with one monolith (`platform-core`) hosting all horizontal capabilities
(auth, notifications, payments, tenant-config, splitpay). When marketplace-specific
modules became necessary (orders, inventory, reviews, messaging, shipping, disputes),
the natural reflex was to keep adding them to `platform-core` — same orchestrator, same
process, more `moduleDescriptors`.

We chose **not** to do that. Instead, we created a **second monolith container**
`platform-marketplace` (port 3100) that mirrors the architecture of `platform-core` and
hosts the 6 marketplace modules.

## Decision

Group modules into separate monolith containers per **domain**:

| Container | Port | Domain | Modules |
|---|---|---|---|
| `platform-core` | 3000 | Horizontal infrastructure | auth, notifications, payments, tenant-config, splitpay |
| `platform-marketplace` | 3100 | Marketplace transactions | orders, inventory, reviews, messaging, shipping, disputes |
| (future) `platform-<domain>` | 3200+ | New domains | … |

Both containers share:
- The same Postgres instance (separate schemas + dedicated `svc_platform_<module>` roles)
- The same Redis instance (shared `platform.events` pub/sub channel — events cross containers transparently)
- The same `PLATFORM_JWT_SECRET` so `appGuard` accepts the same JWTs everywhere without round-trips

Each container owns:
- Its own orchestrator at `platform/<container>/src/server.js` (parallel directories: `platform/core/`, `platform/marketplace/`)
- Its own `Dockerfile`
- Its own port and NGINX upstream
- Its own list of modules (no overlap)

## Rationale

We considered four alternatives:

1. **One big monolith** (extending `platform-core`) — simplest. Rejected because:
   - Domain mixing: a bug in `shipping` could crash `auth`. Auth uptime is critical.
   - Scaling pressure: marketplace traffic patterns (high-volume checkout, stock reservations) are very different from auth/notifications. Shared process = shared bottleneck.
   - Cognitive load: contributors working on marketplace shouldn't need to grok auth internals.

2. **Microservices, one container per module** — what apphub was originally — Rejected at the platform-core split (see prior commits). Too many containers, network overhead, deploy-time coupling.

3. **Domain-separated containers (chosen)** — middle ground. Multiple monoliths, each one cohesive within its domain. Cross-container boundary aligns with cognitive boundaries.

4. **Kubernetes namespaces with per-module pods** — would work in a K8s-native deployment but apphub still ships as plain `docker-compose` for now. Premature.

The decisive trade-off: **smaller blast radius** (containers fail independently) vs **operational overhead** (two builds, two deploys, two log streams). For a marketplace specifically, we chose blast radius.

## Cross-container coupling

Modules in different containers communicate **only** by:

1. **Redis events** (`platform.events`) — preferred. Events fire-and-forget, both containers subscribe. Examples in V1:
   - `splitpay.payment.completed` (platform-core/splitpay) → consumed by `orders` (platform-marketplace) to advance to `paid`
   - `order.created` (platform-marketplace/orders) → consumed by `inventory` to reserve stock
   - `order.delivered` (platform-marketplace/orders) → would be consumed by `notifications` (platform-core) for "your package was delivered" emails (not wired in V1)
   - `shipping.shipment.delivered` (platform-marketplace/shipping) → consumed by `orders` to advance to `delivered`
   - `splitpay.chargeback.created` (platform-core/splitpay) → consumed by `disputes` (platform-marketplace) to escalate

2. **HTTP** — only when synchronous response is required. Examples:
   - `disputes.resolve` could call `splitpay/refund` HTTP if we wanted immediate refund response (V1 emits `dispute.resolved` event instead — splitpay would react asynchronously)
   - `reviews.create` validating the order belongs to the buyer (V1 trusts the JWT and the body — robust verification would call `/api/orders/:id`)

We never use FK constraints across schemas. Each module's tables are self-contained; cross-references are by ID stored as TEXT/UUID.

## Auth across containers

`appGuard` (in `@apphub/platform-sdk/app-guard`) verifies the JWT signature locally with `PLATFORM_JWT_SECRET`. Both containers receive that env var. A token issued by `auth` on `platform-core` is accepted by `platform-marketplace` without any cross-container call.

Tokens carry `app_id` and `tenant_id`, so RLS works identically: the request handler calls `setTenantContext(client, appId, tenantId, subTenantId)` before any query, and Postgres policies on each schema scope the data.

## Database isolation

Schemas + roles per module, regardless of which container hosts the module:

```
platform_orders         ← svc_platform_orders         ← platform-marketplace
platform_inventory      ← svc_platform_inventory      ← platform-marketplace
platform_reviews        ← svc_platform_reviews        ← platform-marketplace
platform_messaging      ← svc_platform_messaging      ← platform-marketplace
platform_shipping       ← svc_platform_shipping       ← platform-marketplace
platform_disputes       ← svc_platform_disputes       ← platform-marketplace
platform_auth           ← svc_platform_auth           ← platform-core
…
```

Each module's role can only `USAGE` its own schema (`infra/postgres/init/01_platform_schemas.sql`). The superuser is used only for migrations via `MIGRATION_DATABASE_URL`.

## Consequences

### Positive

- Independent scaling: `platform-marketplace` can be scaled separately if checkout traffic spikes.
- Independent deploys: deploying a fix to `disputes` doesn't redeploy `auth`.
- Smaller cognitive surface: contributors can work in one container without the other.
- Reusable pattern: future domains (analytics, billing, gamification) get their own monolith too.
- Each module remains "ready to split" — same internal contract (`register`, `runMigrations`).

### Negative

- Two build pipelines, two log streams, two health endpoints — operational overhead.
- `PLATFORM_JWT_SECRET` is duplicated in env vars; rotation requires restarting both containers.
- Cross-container HTTP calls (when needed) use Docker DNS names (`platform-core:3000`, `platform-marketplace:3100`); not as elegant as in-process function calls.
- Eventual consistency: when a module in container A reacts to an event from container B, there's ~10-50ms of latency where the system is in an intermediate state.

## NGINX routing

NGINX adds one upstream per container:

```nginx
upstream platform_core         { server platform-core:3000; }
upstream platform_marketplace  { server platform-marketplace:3100; }
```

Per-module routes in `infra/nginx/snippets/platform-routes.conf` proxy to the correct upstream:

```nginx
location /api/auth/        { proxy_pass http://platform_core/v1/auth/; }
location /api/orders/      { proxy_pass http://platform_marketplace/v1/orders/; }
location /api/inventory/   { proxy_pass http://platform_marketplace/v1/inventory/; }
…
```

Existing dynamic NGINX routing (ADR 003) is unaffected — per-app server blocks still come from Redis; this ADR only changes which `proxy_pass` upstream the platform routes target.

## Repeatability

To create a third domain container (e.g. `platform-analytics`):

1. Create `platform/analytics/` with the same skeleton as `platform/marketplace/`
2. Pick a port (3200+)
3. Add modules under `platform/<module>/` (per existing module pattern)
4. Add `upstream platform_analytics { server platform-analytics:3200; }` in NGINX
5. Add per-module `location` blocks routing there
6. Add the service in `docker-compose.yml`

Zero changes to existing containers. The pattern composes.

## Migration path to Kubernetes

When apphub moves to K8s, each monolith container becomes a `Deployment`:

- `platform-core-deployment.yaml` (3 replicas, port 3000)
- `platform-marketplace-deployment.yaml` (5 replicas, port 3100)
- One `Service` per Deployment
- One `Ingress` resource per public route (replaces NGINX `location` blocks)
- Redis events keep working unchanged
- `PLATFORM_JWT_SECRET` becomes a `Secret` referenced by both Deployments

Per-domain scaling becomes per-Deployment HPA rules. The architecture is K8s-native by accident.

## References

- `platform/marketplace/src/server.js` — orchestrator
- `platform/marketplace/Dockerfile` — image
- `platform/{orders,inventory,reviews,messaging,shipping,disputes}/` — the 6 modules
- `infra/postgres/init/01_platform_schemas.sql` — schemas + roles
- `infra/nginx/snippets/platform-routes.conf` — per-module routing
- `docker-compose.yml` — `platform-marketplace` service definition
