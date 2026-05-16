# RUN.md — How to run the AppHub platform

## Index

1. [Requirements](#1-requirements)
2. [First-time setup](#2-first-time-setup)
3. [Environment variables](#3-environment-variables)
4. [Run without Stripe keys](#4-run-without-stripe-keys)
5. [Run with Stripe in test mode](#5-run-with-stripe-in-test-mode)
6. [Execution modes](#6-execution-modes)
7. [Verify everything works](#7-verify-everything-works)
8. [Run tests](#8-run-tests)
9. [Common commands](#9-common-commands)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Requirements

| Tool | Min version | Install |
|---|---|---|
| Node.js | 20 LTS | https://nodejs.org or `nvm install 20` |
| Docker | 24+ | https://docs.docker.com/get-docker/ |
| Docker Compose | v2 (included with Docker Desktop) | — |
| pnpm | 9+ | `npm install -g pnpm@9` |

Verify before continuing:

```bash
node --version    # v20.x.x or higher
docker --version  # Docker version 24.x.x or higher
pnpm --version    # 9.x.x or higher
```

---

## 2. First-time setup

```bash
# 1. Clone and install dependencies
git clone https://github.com/your-org/apphub.git
cd apphub
pnpm install

# 2. Create the environment file
cp .env.example .env

# 3. Add local DNS aliases (required for subdomain routing)
echo "127.0.0.1  hulkstein.local"           | sudo tee -a /etc/hosts
echo "127.0.0.1  splitpay.hulkstein.local"  | sudo tee -a /etc/hosts
echo "127.0.0.1  aikikan.hulkstein.local"   | sudo tee -a /etc/hosts
```

Now edit `.env` with your values. Continue to the next section.

---

## 3. Environment variables

The `.env` file at the root of the project contains all configuration.
**Never commit it to Git** — it is already in `.gitignore`.

### Required variables

```bash
# Database — defaults work with docker-compose.yml
DATABASE_URL=postgresql://apphub:apphub@localhost:5432/apphub

# Redis — default works with docker-compose.yml
REDIS_URL=redis://localhost:6379

# Platform JWT secret — shared across all services (min 32 chars)
PLATFORM_JWT_SECRET=change_me_at_least_32_characters_long

NODE_ENV=development
LOG_LEVEL=debug
```

### Stripe variables

```bash
PLATFORM_STRIPE_SECRET_KEY=sk_test_...
PLATFORM_STRIPE_WEBHOOK_SECRET=whsec_...
SPLITPAY_STRIPE_SECRET_KEY=sk_test_...
SPLITPAY_STRIPE_WEBHOOK_SECRET=whsec_...
```

---

## 4. Run without Stripe keys

You can start the platform without a Stripe account. Use these placeholders in `.env`:

```bash
PLATFORM_STRIPE_SECRET_KEY=<your-stripe-test-secret-key>
PLATFORM_STRIPE_WEBHOOK_SECRET=<your-stripe-webhook-secret>
SPLITPAY_STRIPE_SECRET_KEY=<your-stripe-test-secret-key>
SPLITPAY_STRIPE_WEBHOOK_SECRET=<your-stripe-webhook-secret>
PLATFORM_JWT_SECRET=development_local_change_this_to_32chars
DATABASE_URL=postgresql://apphub:apphub@localhost:5432/apphub
REDIS_URL=redis://localhost:6379
NODE_ENV=development
LOG_LEVEL=debug
```

Endpoints that call Stripe (payment creation, webhooks) will fail, but all other
endpoints (auth, classes, bookings, bonuses, reporting, split rules) work normally.

---

## 5. Run with Stripe in test mode

1. Create a free account at https://stripe.com
2. Go to https://dashboard.stripe.com/test/apikeys
3. Copy the **Secret key** (`sk_test_…`) into `.env`

For local webhooks, use the Stripe CLI:

```bash
# Install the Stripe CLI — https://stripe.com/docs/stripe-cli
stripe login

# Keep this running in a separate terminal
stripe listen --forward-to aikikan.hulkstein.local:8080/api/payments/webhooks/stripe
# Copy the printed whsec_… and set it as PLATFORM_STRIPE_WEBHOOK_SECRET
```

---

## 6. Execution modes

### Option A — Full stack via Docker Compose (recommended)

Everything — infra, platform services, app services, frontends — runs inside Docker.

```bash
docker compose up -d

# Follow logs
docker compose logs -f platform-core
docker compose logs -f platform-marketplace
docker compose logs -f platform-restaurant
docker compose logs -f platform-appointments
```

### First-time bootstrap (after a fresh DB or wipe)

The `platform_auth.users` table starts empty, so nobody can log in to
console (the staff portal). Create the first super_admin:

```bash
./scripts/bootstrap.sh                                                      # interactive
BOOTSTRAP_ADMIN_EMAIL=… BOOTSTRAP_ADMIN_PASSWORD=… ./scripts/bootstrap.sh   # non-interactive
```

The script is idempotent and registers both the super_admin and the
`platform` app in the registry. After it succeeds, log in at
http://console.hulkstein.local:8080 and start creating apps from the
**Apps** sidebar — new subdomains route automatically.

Full reference: [`docs/runbooks/platform-bootstrap.md`](docs/runbooks/platform-bootstrap.md) (env vars,
troubleshooting, wipe-and-restart workflow, design rationale). See also
[ADR 003](docs/adr/003-dynamic-nginx-routing.md) for what happens after
bootstrap when an app is created.

### Option B — Infrastructure in Docker, service on host (hot reload)

```bash
# Terminal 1 — infrastructure only
docker compose up -d postgres redis nginx

# Terminal 2 — run a specific monolith with watch mode
pnpm --filter @apphub/platform-core dev
```

### Option C — Tests only (no service needed)

```bash
docker compose up -d postgres redis
pnpm test
```

---

## 7. Verify everything works

### Health check (no auth required)

```bash
curl http://hulkstein.local:8080/health
# → {"status":"ok"}

curl http://aikikan.hulkstein.local:8080/api/auth/health
# → {"status":"ok","service":"platform-auth"}
```

### Register an aikikan user

```bash
curl -X POST http://aikikan.hulkstein.local:8080/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "app_id": "aikikan",
    "email": "test@aikikan.es",
    "password": "Secur3P@ss!",
    "name": "Test User"
  }'
# Response includes a JWT with app_id: "aikikan"
```

### Verify cross-app token rejection

Use the aikikan JWT obtained above against a split-pay endpoint:

```bash
curl http://splitpay.hulkstein.local:8080/api/app/merchants \
  -H "Authorization: Bearer <aikikan-jwt>"
# → 403 APP_MISMATCH
```

---

## 8. Run tests

Tests mock all external dependencies (DB, Redis, Stripe). No running services needed
beyond PostgreSQL and Redis.

```bash
# All split-pay tests
pnpm --filter "@split-pay/*" test

# All aikikan tests
pnpm --filter "@aikikan/*" test

# Specific module
pnpm --filter @apphub/platform-auth test

# Watch mode
pnpm --filter @apphub/platform-auth test -- --watch

# Full monorepo
pnpm test
```

---

## 9. Common commands

### Service management

```bash
# Start everything
docker compose up -d

# Stop everything
docker compose down

# Stop and wipe the database (full reset)
docker compose down -v

# View logs
docker compose logs -f platform-core

# Restart one service
docker compose restart platform-core

# Rebuild after Dockerfile change
docker compose up -d --build platform-core
```

### Database

```bash
# Connect to PostgreSQL
docker compose exec postgres psql -U apphub -d apphub

# List tables in a schema
docker compose exec postgres psql -U apphub -d apphub -c "\dt platform_auth.*"

# View applied migrations
docker compose exec postgres psql -U apphub -d apphub \
  -c "SELECT * FROM platform_auth.migrations ORDER BY applied_at;"
```

### Monorepo

```bash
# Install all package dependencies
pnpm install

# Lint everything
pnpm lint

# Test everything
pnpm test

# Clean builds and node_modules
pnpm clean
```

---

## 10. Troubleshooting

### Subdomain returns 404 or wrong response

Check that `/etc/hosts` has the aliases and that NGINX is running:

```bash
docker compose ps nginx
```

### Service won't start: "Invalid environment variables"

The `.env` file has missing or malformed values. Common checks:
- `PLATFORM_STRIPE_SECRET_KEY` starts with `sk_test_` or `sk_live_`
- `PLATFORM_STRIPE_WEBHOOK_SECRET` starts with `whsec_`
- `PLATFORM_JWT_SECRET` is at least 32 characters

### Error: "connection refused"

PostgreSQL or Redis is not ready yet. Check:

```bash
docker compose ps
# Both should show "healthy"
docker compose logs postgres
```

### Error: "relation does not exist"

Migrations have not run. They run automatically on service startup — check service logs:

```bash
docker compose logs platform-auth
```

### 403 APP_MISMATCH

The JWT was issued for a different `app_id` than the service expects. Verify:
- The login request included the correct `app_id` in the body
- The service has `EXPECTED_APP_ID` set correctly in docker-compose.yml

### Port already in use

```bash
# macOS / Linux
lsof -ti:3012 | xargs kill

# Windows (PowerShell)
Get-Process -Id (Get-NetTCPConnection -LocalPort 3012).OwningProcess | Stop-Process
```

### pnpm not found

```bash
npm install -g pnpm@9
```
