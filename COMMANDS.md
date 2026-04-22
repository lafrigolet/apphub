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
docker compose up -d --build platform-auth nginx

# Tear everything down (containers, network — volumes survive)
docker compose down

# Nuke volumes too (wipes Postgres + Redis data)
docker compose down -v

# List running services and their status
docker compose ps

# Follow logs for one service (Ctrl-C to stop)
docker compose logs -f platform-auth

# Tail the last 100 lines
docker compose logs --tail=100 platform-notifications

# Restart a single service
docker compose restart platform-catalog

# Open a shell inside a running container
docker compose exec platform-auth sh

# Run a one-off command against a service (no shell)
docker compose exec platform-auth node --version
```

**Services**: `postgres`, `redis`, `platform-auth`, `platform-payments`,
`platform-notifications`, `platform-catalog`, `platform-basket`,
`platform-tenant-config`, `portal`, `yoga-studio`, `splitpay-core`,
`splitpay-portal`, `aikikan-portal`, `voragine-console-portal`, `nginx`.

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
`@apphub/platform-auth`, `@apphub/platform-payments`, `@apphub/platform-notifications`,
`@apphub/platform-catalog`, `@apphub/platform-basket`, `@apphub/platform-tenant-config`,
`@apphub/platform-sdk`, `@yoga-studio/yoga-bookings`, `@split-pay/splitpay-core`, …

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

---

## PostgreSQL

Connection info (defaults from `docker-compose.yml`):

- Host: `postgres` (inside Docker) / `localhost` (from host)
- Port: `5432`
- DB:   `splitpay`
- Superuser: `splitpay` / `splitpay`
- Per-service roles: `svc_platform_auth`, `svc_platform_catalog`,
  `svc_platform_tenants`, `svc_platform_notifications`, `svc_platform_payments`

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
SELECT set_config('app.app_id',        'yoga-studio',                            true);
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
| platform-auth               | 3000      |
| platform-payments           | 3001      |
| platform-notifications      | 3002      |
| platform-catalog            | 3003      |
| platform-basket             | 3004      |
| platform-tenant-config      | 3005      |
| PostgreSQL                  | 5432      |
| Redis                       | 6379      |
| portal (AppHub admin)       | 5173      |
| yoga-studio portal          | 5174      |
| splitpay portal             | 5175      |
| aikikan portal              | 5176      |
| voragine-console portal     | 5177      |

All app subdomains go through NGINX: `http://yoga.apphub.local:8080`,
`http://splitpay.apphub.local:8080`, etc. (requires `/etc/hosts` entries).
