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
git clone https://github.com/your-org/splitpay-platform.git
cd splitpay-platform

# 2. Install all dependencies (workspaces)
pnpm install

# 3. Copy and fill environment variables
cp .env.example .env
# Edit .env — minimum required: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET

# 4. Start infrastructure (PostgreSQL + Redis)
docker compose up -d postgres redis

# 5. Run database migrations
pnpm --filter split-payments db:migrate

# 6. Start the split-payments service in watch mode
pnpm --filter split-payments dev

# 7. (Optional) Start everything at once
docker compose up -d
pnpm dev
```

## Environment variables

See `.env.example` for all variables. Key ones for local development:

```bash
# Stripe — use test keys from https://dashboard.stripe.com/test/apikeys
PAYMENTS_STRIPE_SECRET_KEY=sk_test_...
PAYMENTS_STRIPE_WEBHOOK_SECRET=whsec_...
PAYMENTS_STRIPE_PUBLISHABLE_KEY=pk_test_...

# Database — matches docker-compose.yml defaults
DATABASE_URL=postgresql://splitpay:splitpay@localhost:5432/splitpay

# Redis — matches docker-compose.yml defaults
REDIS_URL=redis://localhost:6379
```

## Stripe local webhooks

To test webhooks locally, use the Stripe CLI:

```bash
# Install: https://stripe.com/docs/stripe-cli
stripe login
stripe listen --forward-to localhost:3001/v1/webhooks/stripe
# Copy the webhook signing secret printed and set it as PAYMENTS_STRIPE_WEBHOOK_SECRET
```

## Running tests

```bash
# All tests across the monorepo
pnpm test

# Only split-payments tests
pnpm --filter split-payments test

# Watch mode
pnpm --filter split-payments test:watch

# Coverage report
pnpm --filter split-payments test:coverage

# TypeScript type check
pnpm typecheck

# Lint
pnpm lint
```

## Docker workflow

```bash
# Start all services
docker compose up -d

# View logs for a specific service
docker compose logs -f split-payments

# Rebuild a service after Dockerfile changes
docker compose up -d --build split-payments

# Stop everything
docker compose down

# Stop and remove volumes (resets DB)
docker compose down -v
```

## Database

```bash
# Run pending migrations
pnpm --filter split-payments db:migrate

# Connect to PostgreSQL directly
docker compose exec postgres psql -U splitpay -d splitpay

# Inspect the payments schema
docker compose exec postgres psql -U splitpay -d splitpay -c "\dt payments.*"
```

## Ports

| Service | Port |
|---|---|
| split-payments API | 3001 |
| PostgreSQL | 5432 |
| Redis | 6379 |
| Nginx (gateway) | 8080 |

## Common issues

**Port already in use**: `lsof -ti:3001 | xargs kill`

**Database connection refused**: ensure `docker compose up -d postgres` has finished starting.
Check with `docker compose ps`.

**Stripe webhook 400**: regenerate the webhook secret with `stripe listen` and update `.env`.

**pnpm install fails**: ensure you're using pnpm 9+. Run `pnpm --version` to check.
