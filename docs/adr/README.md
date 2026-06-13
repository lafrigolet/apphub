# Architecture Decision Records

Each ADR captures a decision that's hard to reverse, worth justifying once,
and would otherwise live as folklore. ADRs are append-only — once accepted,
a record isn't edited; if the decision changes, a new ADR supersedes it.

| # | Title | Status |
|---|---|---|
| [001](001-postgres-schemas-per-service.md) | PostgreSQL schemas instead of separate databases per service | Accepted |
| [002](002-two-level-tenancy.md) | Three-level identity: `app_id + tenant_id + sub_tenant_id` | Accepted |
| [003](003-dynamic-nginx-routing.md) | Dynamic NGINX routing via Redis sidecar | Accepted |
| [004](004-domain-separated-monolith-containers.md) | Domain-separated monolith containers | Accepted |
| [005](005-platform-restaurant-monolith.md) | `platform-restaurant` — third monolith for restaurant operations | Accepted |
| [006](006-platform-appointments-monolith.md) | `platform-appointments` — fourth monolith for scheduling | Accepted |
| [007](007-platform-scheduler.md) | `platform-scheduler` — single-runner cron for the 4 monoliths | Accepted |
| [008](008-object-storage.md) | Object storage: MinIO + `storage` module of platform-core | Accepted |
| [009](009-reviews-verified-purchase.md) | `reviews` verified-purchase via HTTP loopback to `orders` | Accepted |
| [010](010-messaging-realtime-deferred.md) | Real-time in `messaging` deferred (polling now, WebSocket later) | Deferred |
| [011](011-calendar-integrations-deferred.md) | Calendar integrations (Google / Outlook two-way sync) deferred | Deferred |
| [012](012-tenant-console-multi-host-routing.md) | Tenant Console multi-host routing | Accepted |
| [013](013-app-architecture-and-schema-naming.md) | App architecture: monolith per app + unified schema naming | Accepted |
| [014](014-chat-module-and-websocket-gateway.md) | `chat` module + the platform's first WebSocket gateway | Accepted |
| [015](015-platform-tpv-monolith.md) | `platform-tpv` — fifth monolith for point-of-sale operations | Superseded by 016 (container decision only; module design stands) |
| [016](016-tpv-folded-into-platform-core.md) | `tpv` folded into `platform-core` (kept ready-to-split) | Accepted |
| [017](017-unified-portals-container.md) | Single `portals` container for all frontends (port-per-portal) | Accepted |
| [018](018-apps-servers-orchestrator.md) | `apps-servers` — single orchestrator for app-specific servers (per-scope guard) | Accepted |
| [020](020-single-tenant-collapse.md) | Single-tenant collapse — `tenant_id` derived from `app_id`, `sub_tenant_id` reserved (columns/RLS kept) | Accepted |

## Writing a new ADR

1. Pick the next sequential number; never renumber existing ADRs.
2. Filename: `NNN-kebab-case-title.md`.
3. Body structure (free-form, but typically): **Context** · **Decision** ·
   **Consequences** · **Alternatives considered**.
4. Add a row to this index.
5. If the new ADR supersedes an old one, mark the old one's status here as
   "Superseded by NNN" but leave the file alone.
