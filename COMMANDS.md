# Commands cheat sheet

Quick reference for working in this repo. DB credentials, service names, and
script names below match `docker-compose.yml` and the current `package.json`s.

---

## Docker Compose

All commands are run from the repo root.

```bash
# Bring the whole stack up in the background
docker compose up -d

# Rebuild one or more services after code changes
docker compose up -d --build platform-core nginx

# Tear everything down (containers, network — volumes survive)
docker compose down

# Nuke volumes too (wipes Postgres + Redis data)
docker compose down -v

# List running services and their status
docker compose ps

# Follow logs for one service (Ctrl-C to stop)
docker compose logs -f platform-core
docker compose logs -f platform-marketplace
docker compose logs -f platform-restaurant

# Tail the last 100 lines
docker compose logs --tail=100 platform-restaurant

# Restart a single service
docker compose restart platform-marketplace

# Open a shell inside a running container
docker compose exec platform-core sh

# Run a one-off command against a service (no shell)
docker compose exec platform-core node --version
```

**Services**: `postgres`, `redis`, `platform-core`, `platform-marketplace`,
`platform-restaurant`, `platform-appointments`, `platform-scheduler`, `portal`,
`splitpay-portal`, `aikikan-portal`, `console-portal`, `nginx`.

---

## pnpm

```bash
# Install all workspace deps
pnpm install

# Run a script in a specific workspace package
pnpm --filter @apphub/platform-auth dev
pnpm --filter @apphub/platform-auth test:unit
pnpm --filter @apphub/platform-auth test:integration
pnpm --filter @apphub/platform-auth db:migrate

# Add a dep to a specific package
pnpm --filter @apphub/platform-auth add bcrypt

# Add a dev dep to a specific package
pnpm --filter @apphub/platform-auth add -D vitest

# Root-level scripts (run everything via Turbo)
pnpm test:unit            # all unit tests
pnpm test:integration     # all integration tests (needs postgres + redis up)
pnpm dev                  # all dev servers
pnpm build                # all build tasks
pnpm lint
```

**Package names** to use with `--filter`:

- Orchestrators: `@apphub/platform-core`, `@apphub/platform-marketplace`,
  `@apphub/platform-restaurant`
- platform-core modules: `@apphub/platform-auth`, `@apphub/platform-payments`,
  `@apphub/platform-notifications`, `@apphub/platform-tenant-config`,
  `@apphub/platform-splitpay`
- platform-marketplace modules: `@apphub/platform-orders`,
  `@apphub/platform-inventory`, `@apphub/platform-reviews`,
  `@apphub/platform-messaging`, `@apphub/platform-shipping`,
  `@apphub/platform-disputes`, `@apphub/platform-catalog`,
  `@apphub/platform-basket`
- platform-restaurant modules: `@apphub/platform-menu`,
  `@apphub/platform-reservations`, `@apphub/platform-floor-plan`,
  `@apphub/platform-kds`, `@apphub/platform-pos`,
  `@apphub/platform-delivery-dispatch`
- Shared SDK: `@apphub/platform-sdk`
- App servers: `@aikikan/aikikan-server`, …

---

## Turbo

Turbo reads `turbo.json` and runs tasks across the workspace with caching.

```bash
# Run a task in every package that defines it
pnpm exec turbo run test:unit
pnpm exec turbo run build

# Run only in one package (and its dependencies)
pnpm exec turbo run build --filter=@apphub/platform-auth

# Force a re-run ignoring the cache
pnpm exec turbo run test:unit --force

# See which tasks would run (dry run)
pnpm exec turbo run build --dry-run

# Wipe the Turbo cache
rm -rf node_modules/.cache/turbo
```

When Turbo prints `>>> FULL TURBO` it means every task was a cache hit — nothing
actually ran.

---

## Redis

Connect inside the container — simplest route, no client install on the host:

```bash
# Open the Redis CLI
docker compose exec redis redis-cli

# One-off command without entering the REPL
docker compose exec redis redis-cli PING
```

Useful commands once inside the REPL:

```
PING                                 # → PONG
KEYS *                               # list ALL keys (slow on large DBs)
KEYS basket:int-test:*               # pattern match
SCAN 0 MATCH basket:* COUNT 100      # preferred over KEYS in production
GET basket:int-test:<tenant>:<user>  # read a string value
TTL <key>                            # seconds until expiry, -1 = no TTL
TYPE <key>                           # string | list | hash | set | zset | stream

DEL <key>                            # delete one
FLUSHDB                              # wipe current DB (careful!)
INFO keyspace                        # show db sizes
MONITOR                              # live tail of every command (Ctrl-C)
CLIENT LIST                          # connected clients
SUBSCRIBE platform:events            # watch pub/sub events
```

### NGINX dynamic routing (hash `nginx:configs`)

The NGINX gateway loads its per-subdomain server blocks from Redis at runtime. See
[ADR 003](docs/adr/003-dynamic-nginx-routing.md) for the design.

```bash
# Show every subdomain that NGINX is currently serving
docker compose exec redis redis-cli HKEYS nginx:configs

# Inspect the rendered conf for one subdomain
docker compose exec redis redis-cli HGET nginx:configs autoroute

# Manually edit / replace a server block (sidecar reloads NGINX in ~2s)
docker compose exec redis redis-cli HSET nginx:configs autoroute "$(cat new.conf)"

# Unrouted: drop a subdomain. Sidecar removes the rendered file and reloads.
docker compose exec redis redis-cli HDEL nginx:configs autoroute

# Force re-seed from the baked-in seeds (aikikan, splitpay, …) — useful in dev
docker compose exec redis redis-cli DEL nginx:configs
docker compose restart nginx     # next sidecar init re-seeds from /etc/nginx/seed/

# Watch the sidecar reconciliation loop
docker compose logs -f nginx | grep sidecar
```

Normal flow: staff hits `POST /api/apps/` from voragine-console → `platform-core` writes the
rendered conf to `nginx:configs` → every NGINX replica reloads within `POLL_INTERVAL` (default
2s). No host-side ops, no `docker compose restart`.

---

## PostgreSQL

Connection info (defaults from `docker-compose.yml`):

- Host: `postgres` (inside Docker) / `localhost` (from host)
- Port: `5432`
- DB:   `splitpay`
- Superuser: `splitpay` / `splitpay`
- Per-module roles (one per module across all three monoliths):
  - platform-core: `svc_platform_auth`, `svc_platform_payments`,
    `svc_platform_notifications`, `svc_platform_tenants`
  - platform-marketplace: `svc_platform_orders`, `svc_platform_inventory`,
    `svc_platform_reviews`, `svc_platform_messaging`, `svc_platform_shipping`,
    `svc_platform_disputes`, `svc_platform_catalog`
  - platform-restaurant: `svc_platform_menu`, `svc_platform_reservations`,
    `svc_platform_floor_plan`, `svc_platform_kds`, `svc_platform_pos`,
    `svc_platform_delivery_dispatch`

```bash
# Open psql as superuser (inside container)
docker compose exec postgres psql -U splitpay -d splitpay

# Connect as a specific service role
docker compose exec postgres psql -U svc_platform_auth -d splitpay

# Run a single query
docker compose exec postgres psql -U splitpay -d splitpay -c "SELECT now();"

# From the host machine (needs psql installed)
psql -h localhost -U splitpay -d splitpay
```

### Inspecting the database inside psql

```sql
\l                        -- list databases
\c splitpay               -- connect to db
\dn                       -- list schemas
\dt *.*                   -- list tables across all schemas
\dt platform_auth.*       -- tables in one schema
\d platform_auth.users    -- describe one table (columns, indexes, FKs)
\di platform_auth.*       -- list indexes
\du                       -- list roles
\dp platform_auth.users   -- column-level privileges

-- Size info
\l+
\dt+ platform_auth.*

-- Row counts per table (quick estimate)
SELECT schemaname, relname, n_live_tup
FROM pg_stat_user_tables
ORDER BY n_live_tup DESC;

-- Does a table have RLS enabled?
SELECT relname, relrowsecurity
FROM pg_class
WHERE relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'platform_catalog');

-- List RLS policies
SELECT schemaname, tablename, policyname, qual
FROM pg_policies
WHERE schemaname LIKE 'platform_%';

\q                        -- quit
```

### RLS session context (for debugging)

Every query from a service client first sets three session vars inside a
transaction — matching what `setTenantContext()` does in code:

```sql
BEGIN;
SELECT set_config('app.app_id',        'aikikan',                                true);
SELECT set_config('app.tenant_id',     '00000000-0000-0000-0000-000000000099',   true);
SELECT set_config('app.sub_tenant_id', '',                                       true);
-- now queries respect RLS
SELECT * FROM platform_catalog.items;
COMMIT;
```

`is_local = true` → setting dies at the end of the transaction, so you must
stay inside `BEGIN` / `COMMIT` for RLS policies to see the values.

### Migrations

```bash
# Run migrations for one service
pnpm --filter @apphub/platform-auth db:migrate

# Inside the container (useful if DB role lives only on the container network)
docker compose exec platform-auth node src/lib/migrate.js
```

### Backup / restore

```bash
# Dump everything
docker compose exec postgres pg_dump -U splitpay splitpay > backup.sql

# Restore
cat backup.sql | docker compose exec -T postgres psql -U splitpay splitpay
```

---

## Common ports

| Service                     | Host port |
|-----------------------------|-----------|
| NGINX (entrypoint)          | 8080      |
| platform-core               | 3000      |
| platform-marketplace        | 3100      |
| platform-restaurant         | 3200      |
| platform-appointments       | 3300      |
| platform-scheduler          | 3400      |
| PostgreSQL                  | 5432      |
| Redis                       | 6379      |
| portal (AppHub admin)       | 5173      |
| splitpay portal             | 5175      |
| aikikan portal              | 5176      |
| voragine-console portal     | 5177      |

**Modules per monolith** (each on its own schema + DB role, not its own port):
- `platform-core` (3000) → `auth`, `notifications`, `payments`, `tenant-config`, `splitpay`
- `platform-marketplace` (3100) → `orders`, `inventory`, `reviews`, `messaging`, `shipping`, `disputes`, `catalog`, `basket`
- `platform-restaurant` (3200) → `menu`, `reservations`, `floor-plan`, `kds`, `pos`, `delivery-dispatch`

All app subdomains go through NGINX: `http://aikikan.hulkstein.local:8080`,
`http://splitpay.hulkstein.local:8080`, etc. (requires `/etc/hosts` entries).
