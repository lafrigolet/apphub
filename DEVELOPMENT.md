# Development Guide

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node.js | 20 LTS | https://nodejs.org or `nvm install 20` |
| pnpm | 9+ | `npm install -g pnpm` |
| Docker | 24+ | https://docs.docker.com/get-docker/ |
| Docker Compose | v2 | included with Docker Desktop |

## First-time setup

```bash
# 1. Clone the repository
git clone https://github.com/your-org/apphub.git
cd apphub

# 2. Install all dependencies (workspaces)
pnpm install

# 3. Copy and fill environment variables
cp .env.example .env
# Edit .env — minimum required: PLATFORM_JWT_SECRET, PLATFORM_STRIPE_SECRET_KEY

# 4. Add local DNS aliases to /etc/hosts
echo "127.0.0.1  apphub.local" | sudo tee -a /etc/hosts
echo "127.0.0.1  yoga.apphub.local" | sudo tee -a /etc/hosts
echo "127.0.0.1  splitpay.apphub.local" | sudo tee -a /etc/hosts

# 5. Start the full stack
docker compose up -d

# 6. Verify
curl http://yoga.apphub.local:8080/api/auth/health
```

## /etc/hosts setup

NGINX routes requests by `Host` header. Without the DNS aliases, the subdomain
server blocks will not match and all requests land on the default server (404).

```
127.0.0.1  apphub.local
127.0.0.1  yoga.apphub.local
127.0.0.1  splitpay.apphub.local
```

Add more lines for each new app as you add them.

## Environment variables

See `.env.example` for all variables. Key ones for local development:

```bash
# Platform JWT — shared secret across all services
PLATFORM_JWT_SECRET=change_me_at_least_32_characters_long

# Stripe — use test keys from https://dashboard.stripe.com/test/apikeys
PLATFORM_STRIPE_SECRET_KEY=sk_test_...
PLATFORM_STRIPE_WEBHOOK_SECRET=whsec_...
SPLITPAY_STRIPE_SECRET_KEY=sk_test_...
SPLITPAY_STRIPE_WEBHOOK_SECRET=whsec_...

# Database — matches docker-compose.yml defaults
DATABASE_URL=postgresql://apphub:apphub@localhost:5432/apphub

# Redis — matches docker-compose.yml defaults
REDIS_URL=redis://localhost:6379
```

## Stripe local webhooks

```bash
stripe login
stripe listen --forward-to yoga.apphub.local:8080/api/payments/webhooks/stripe
# Copy the webhook signing secret and set it as PLATFORM_STRIPE_WEBHOOK_SECRET
```

## Running tests

```bash
# All yoga-studio services
pnpm --filter "@yoga-studio/*" test

# All split-pay services
pnpm --filter "@split-pay/*" test

# Specific service
pnpm --filter @yoga-studio/yoga-classes test

# Entire monorepo
pnpm test
```

## Docker workflow

```bash
# Start all services
docker compose up -d

# View logs for a specific service
docker compose logs -f platform-auth
docker compose logs -f yoga-classes

# Rebuild a service after Dockerfile changes
docker compose up -d --build yoga-classes

# Stop everything
docker compose down

# Stop and remove volumes (resets DB)
docker compose down -v
```

## Database

```bash
# Connect to PostgreSQL directly
docker compose exec postgres psql -U apphub -d apphub

# Inspect a schema
docker compose exec postgres psql -U apphub -d apphub -c "\dt yoga_classes.*"
docker compose exec postgres psql -U apphub -d apphub -c "\dt platform_auth.*"

# Run migrations for a specific service (dev only — auto-runs on startup)
docker compose exec yoga-classes node src/migrate.js
```

## Ports

| Service | Port |
|---|---|
| platform-auth | 3000 |
| platform-payments | 3001 |
| platform-notifications | 3002 |
| platform-catalog | 3003 |
| platform-basket | 3004 |
| platform-tenant-config | 3005 |
| yoga-users | 3011 |
| yoga-classes | 3012 |
| yoga-bookings | 3013 |
| yoga-bonuses | 3014 |
| yoga-reporting | 3017 |
| splitpay-core | 3020 |
| portal (AppHub admin) | 5173 |
| yoga-portal | 5174 |
| splitpay-portal | 5175 |
| PostgreSQL | 5432 |
| Redis | 6379 |
| NGINX gateway | 8080 |

## Common issues

**Subdomain returns 404**: ensure `/etc/hosts` has the alias, and NGINX is running:
`docker compose ps nginx`.

**Port already in use**: `lsof -ti:3012 | xargs kill`

**Database connection refused**: ensure `docker compose up -d postgres` has finished.
Check with `docker compose ps`.

**Stripe webhook 400**: regenerate the webhook secret with `stripe listen` and update `.env`.

**pnpm install fails**: ensure you're using pnpm 9+. Run `pnpm --version`.

**APP_MISMATCH 403**: the JWT was issued for a different `app_id` than the service expects.
Check `EXPECTED_APP_ID` in the service env and `app_id` in the JWT payload.
