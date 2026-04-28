# Platform bootstrap

After a fresh `docker compose up` (or any time the database is wiped), the
auth tables are empty and **nobody can log in to voragine-console** — the
staff console where apps, tenants and admins are managed. This document
explains the bootstrap script that creates the first super_admin and brings
the platform to a usable state.

## When you need to run it

Run `./scripts/bootstrap.sh` after **any** of these:

- First clone of the repo, before opening voragine-console for the first time
- `docker compose down -v` (wipes the postgres volume)
- Manual `TRUNCATE TABLE platform_auth.users` or any equivalent reset
- Migrating to a new postgres instance with empty data

Re-running the script when the platform is already bootstrapped is safe — it
is idempotent.

## What it does

In a single non-interactive flow:

```
[platform-core healthy?]
    ↓ wait up to WAIT_TIMEOUT seconds for /health
[ask for email + password (or read from env)]
    ↓
[POST /v1/auth/register]   role=super_admin, appId=platform
    ↓                       201 → created   |   409 → already existed
[POST /v1/auth/login]      verify the credentials work
    ↓                       must return 200 with accessToken
[GET  /v1/apps/platform]   ensure the registry has a row for the staff app
    ↓                       404 → POST /v1/apps to create it
[done]
```

After this, `platform_auth.users` has at least one row with `role='super_admin'`
and `platform_tenants.apps` contains the `platform` app (subdomain
`voragine-console`). The two seed apps from the migration (`yoga-studio` and
`split-pay`) are unaffected.

## How to run

### Interactive (recommended for dev)

```bash
./scripts/bootstrap.sh
# Super-admin email: staff@apphub.local
# Super-admin password: ********
# Confirm password: ********
```

### Non-interactive (CI/automation)

```bash
BOOTSTRAP_ADMIN_EMAIL="staff@apphub.local" \
BOOTSTRAP_ADMIN_PASSWORD="StrongPass123!" \
  ./scripts/bootstrap.sh
```

### From inside CI without prompting

The script also supports overriding the platform-core URL and tenant defaults:

```bash
PLATFORM_CORE_URL="http://platform-core:3000" \
PLATFORM_APP_ID="platform" \
PLATFORM_TENANT_ID="00000000-0000-0000-0000-000000000001" \
WAIT_TIMEOUT=120 \
BOOTSTRAP_ADMIN_EMAIL="ci@apphub.local" \
BOOTSTRAP_ADMIN_PASSWORD="$(openssl rand -base64 24)Aa1!" \
  ./scripts/bootstrap.sh
```

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `BOOTSTRAP_ADMIN_EMAIL` | (prompt) | Email of the super_admin to create |
| `BOOTSTRAP_ADMIN_PASSWORD` | (prompt) | Password (min 8 chars) |
| `PLATFORM_CORE_URL` | `http://localhost:3000` | Where to reach platform-core's HTTP API |
| `PLATFORM_APP_ID` | `platform` | The `app_id` claim baked into staff JWTs |
| `PLATFORM_TENANT_ID` | `00000000-0000-0000-0000-000000000001` | UUID baked into staff JWTs (no row created) |
| `PLATFORM_TENANT_NAME` | `Platform Root` | Human-readable name (currently unused) |
| `WAIT_TIMEOUT` | `60` | Seconds to wait for `platform-core` to come up |

## Outputs

On success the script ends with:

```
🎉 Platform bootstrapped successfully.

Log in to voragine-console:
  via gateway:  http://voragine-console.apphub.local:8080
  via Vite dev: http://localhost:5177

  email:    staff@apphub.local
  password: (the password you just set)
```

## Idempotency

Re-running the script with the same credentials produces:

```
! user staff@apphub.local already exists — leaving as-is
✓ login successful
✓ 'platform' app already registered
```

(zero state change). Safe to call from CI on every pipeline run.

If you re-run with a different password and the user already exists,
the login step fails with HTTP 401 and the script aborts. To recover, use
the existing password or wipe the user manually:

```bash
docker compose exec postgres psql -U splitpay -d splitpay \
  -c "DELETE FROM platform_auth.users WHERE email='staff@apphub.local';"
./scripts/bootstrap.sh   # now it can re-create with the new password
```

## Why the design is this way

### `/v1/auth/register` is public, no token needed for the chicken-and-egg

The bootstrap creates the *first* user in an empty database, which means
there's no existing token to authorize the operation. The auth endpoint is
registered with `config: { public: true }` precisely so this bootstrap is
possible. **In production this should be locked down** to staff-only after
the first user exists — but that hardening is out of scope for now.

### `tenantId` is a real UUID, but no tenant row is created

JWTs require a `tenant_id` claim by structure (`appGuard` rejects tokens
missing it). For staff users, voragine-console never queries the tenant —
`AppContext.jsx` short-circuits with `if (role === 'staff') { setMyTenant(null); return }`.
So we use a known fixed UUID and skip the cost of inserting a tenant row that
would never be read.

### `platform` app is registered in `platform_tenants.apps`

The staff console references `app_id='platform'` everywhere (in JWT validation,
in audit logs, etc.). Having a corresponding registry row makes the platform
self-consistent: `GET /v1/apps` lists `platform` alongside `yoga-studio` and
`split-pay`, with `subdomain='voragine-console'`. It's "the staff console as
an app like any other" — a property we care about for cleanliness.

### Idempotent by design, not accident

The script handles every step's "already done" outcome explicitly (HTTP 409
on register, HTTP 200 on get-app). This makes it safe to wire into CI as a
pre-flight check, and forgiving for operators who re-run it after partial
failures.

## Troubleshooting

### `platform-core not reachable. Is the stack up?`

Check the stack is healthy:

```bash
docker compose ps
docker compose logs platform-core --tail=50
```

Common causes:

- `PLATFORM_JWT_SECRET` missing in `.env` (must be ≥32 chars). `platform-core`
  fails to start with a clear message in its logs.
- Port `3000` already taken on the host.
- `postgres` health check still red — bootstrap script waits for `platform-core`
  not for postgres directly. Wait a bit longer or check `docker compose logs postgres`.

### `register failed (HTTP 422)`

The validation rejected the request. Common cases:

- Password shorter than 8 characters (`min(8)` in the Zod schema)
- `tenantId` is not a valid UUID (override `PLATFORM_TENANT_ID` or stop messing with it)

The script prints the full `data.details` from the Zod error so the missing
or malformed field is visible.

### `login failed (HTTP 401)`

The user already exists with a different password. Either:

- Use the existing password: `BOOTSTRAP_ADMIN_PASSWORD="$(the right one)"`
- Or wipe the user and re-bootstrap (see Idempotency above)

### `register failed (HTTP 404)` or NGINX 502

The platform-core process started but the auth module is not yet registered.
Wait a few seconds (`platform-core` boots ~3-5s after postgres is healthy)
and retry. If it persists, `docker compose logs platform-core` will show
which module failed to register.

### Bootstrap succeeds but voragine-console still rejects login

Two possibilities:

- **The portal is calling the wrong API base URL**. Open the browser devtools
  Network tab, repro login, and check the request URL. If it goes to a host
  that doesn't resolve, see `apps/voragine-console/voragine-console-portal/vite.config.js`
  proxy configuration.
- **JWT secret mismatch**. If `PLATFORM_JWT_SECRET` changed between when the
  user was created and now, login still works but `appGuard` will reject the
  token on subsequent requests. Restart `platform-core` so the validation key
  matches the signing key, or re-bootstrap.

## Wipe and re-bootstrap workflow

If you want to start completely fresh (development only — destroys all data):

```bash
# 1. Stop the stack and destroy the postgres + redis volumes
docker compose down -v

# 2. Bring up infrastructure only first
docker compose up -d postgres redis

# 3. Bring up platform-core (re-runs migrations on a virgin DB,
#    re-seeds yoga-studio and split-pay apps from migration 0001)
docker compose up -d platform-core

# 4. Bootstrap: create the super_admin
./scripts/bootstrap.sh

# 5. Bring up the rest
docker compose up -d
```

For a partial wipe (keep schemas + migrations, just clear app data),
use `TRUNCATE` on the relevant tables — there's no helper for that yet but
it's a few SQL statements (see chat history or write your own).

## Related

- [`scripts/bootstrap.sh`](../scripts/bootstrap.sh) — the script itself
- [`RUN.md`](../RUN.md) — the broader "how to run the platform" doc
- [`docs/adr/003-dynamic-nginx-routing.md`](adr/003-dynamic-nginx-routing.md) — what happens *after* bootstrap when staff registers an app
- [`platform/auth/src/routes/auth.routes.js`](../platform/auth/src/routes/auth.routes.js) — the `/v1/auth/register` endpoint the script calls
- [`platform/tenant-config/src/routes/apps.routes.js`](../platform/tenant-config/src/routes/apps.routes.js) — the `/v1/apps` endpoint the script calls
