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
echo "127.0.0.1  hulkstein.local" | sudo tee -a /etc/hosts
echo "127.0.0.1  splitpay.hulkstein.local" | sudo tee -a /etc/hosts
echo "127.0.0.1  aikikan.hulkstein.local" | sudo tee -a /etc/hosts

# 5. Start the full stack
docker compose up -d

# 6. Verify
curl http://aikikan.hulkstein.local:8080/api/auth/health
```

## /etc/hosts setup

NGINX routes requests by `Host` header. Without the DNS aliases, the subdomain
server blocks will not match and all requests land on the default server (404).

```
127.0.0.1  hulkstein.local
127.0.0.1  splitpay.hulkstein.local
127.0.0.1  aikikan.hulkstein.local
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

# Database — superuser (used only by migrate.js)
MIGRATION_DATABASE_URL=postgresql://splitpay:splitpay@localhost:5432/splitpay
# Per-service DB roles (schema-isolated runtime connections)
PLATFORM_AUTH_DATABASE_URL=postgresql://svc_platform_auth:platform_auth_secret@localhost:5432/splitpay
PLATFORM_NOTIFICATIONS_DATABASE_URL=postgresql://svc_platform_notifications:platform_notifications_secret@localhost:5432/splitpay

# Redis — matches docker-compose.yml defaults
REDIS_URL=redis://localhost:6379

# OAuth (optional in development — social buttons hidden when blank)
GOOGLE_CLIENT_ID=
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=

# Aikikan tenant UUID (set after first DB seed)
AIKIKAN_TENANT_ID=
```

## Stripe local webhooks

```bash
stripe login
stripe listen --forward-to aikikan.hulkstein.local:8080/api/payments/webhooks/stripe
# Copy the webhook signing secret and set it as PLATFORM_STRIPE_WEBHOOK_SECRET
```

## Running tests

```bash
# All split-pay services
pnpm --filter "@split-pay/*" test

# All aikikan services
pnpm --filter "@aikikan/*" test

# Specific module
pnpm --filter @apphub/platform-auth test

# Entire monorepo
pnpm test
```

## Docker workflow

```bash
# Start all services
docker compose up -d

# View logs for a specific service
docker compose logs -f platform-core
docker compose logs -f platform-marketplace
docker compose logs -f platform-restaurant
docker compose logs -f platform-appointments

# Rebuild a service after Dockerfile changes
docker compose up -d --build platform-core

# Stop everything
docker compose down

# Stop and remove volumes (resets DB)
docker compose down -v
```

## Database

```bash
# Connect to PostgreSQL directly
docker compose exec postgres psql -U splitpay -d splitpay

# Inspect a schema
docker compose exec postgres psql -U splitpay -d splitpay -c "\dt platform_auth.*"
docker compose exec postgres psql -U splitpay -d splitpay -c "\dt platform_orders.*"
docker compose exec postgres psql -U splitpay -d splitpay -c "\dt platform_menu.*"
docker compose exec postgres psql -U splitpay -d splitpay -c "\dt app_aikikan.*"
```

## Ports

| Container | Modules / service | Port |
|---|---|---|
| platform-core | auth, payments, notifications, tenant-config, splitpay | 3000 |
| platform-marketplace | orders, inventory, reviews, messaging, shipping, disputes, catalog, basket | 3100 |
| platform-restaurant | menu, reservations, floor-plan, kds, pos, delivery-dispatch | 3200 |
| platform-appointments | services, resources, bookings, availability, intake-forms, telehealth, packages, practitioner-payouts | 3300 |
| platform-scheduler | cron runner | 3400 |
| portal | AppHub admin | 5173 |
| splitpay-portal | splitpay-portal | 5175 |
| aikikan-portal | aikikan-portal | 5176 |
| voragine-console-portal | voragine-console-portal | 5177 |
| postgres | PostgreSQL | 5432 |
| redis | Redis | 6379 |
| nginx | NGINX gateway | 8080 |

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
