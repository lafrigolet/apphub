# SplitPay Platform - Gemini Context

This file provides essential context, mandates, and workflows for the SplitPay Platform codebase. It should be used as the primary instructional reference for AI assistants and developers.

## Project Overview
SplitPay Platform is a multi-tenant SaaS that enables third-party web applications to embed Stripe Connect split payment functionality.

- **Primary Technologies:** Node.js 20 LTS, TypeScript 5 (strict), Express 5, PostgreSQL 16, Redis 7.
- **Architecture:** Monorepo with microservices (schema-per-service isolation), pnpm workspaces, and Turborepo for task orchestration.
- **Key Concepts:**
    - **Multi-tenancy:** Two-level isolation (`tenant_id` + optional `sub_tenant_id`).
    - **Database Security:** Row-Level Security (RLS) enforced at the PostgreSQL level.
    - **Payment Logic:** Idempotency keys (Redis-backed), proportional split reversals for refunds, and async webhook processing.

## Core Mandates (High Priority)
1. **Tenant Scoping:** Every database query (SELECT, INSERT, UPDATE, DELETE) MUST be scoped by `tenant_id`. Never remove scoping even during debugging.
2. **Stripe Idempotency:** Always include `Idempotency-Key` in Stripe API calls. Keys are stored in Redis with a 24-hour TTL.
3. **Schema Isolation:** Services MUST NOT perform cross-schema queries. Each service owns its schema (e.g., `payments`, `auth`).
4. **Webhook Security:** All incoming Stripe webhooks MUST verify the `Stripe-Signature` header.
5. **Refund Logic:** When issuing refunds, reverse transfers proportionally to the original split.
6. **No Raw Errors:** Use typed error classes extending `AppError` (found in `src/utils/errors.ts`).

## Repository Structure
- `apps/`: React 18 + Tailwind + Vite frontends.
- `services/`: Node.js microservices (Express + TypeScript).
    - `split-payments/`: Core payments service (Start here).
- `packages/`: Internal shared packages (e.g., `sdk-js`, `eslint-config`).
- `infra/`: Docker, Nginx (gateway), and database initialization scripts.
- `docs/`: Architecture diagrams, ADRs, and API documentation.

## Building and Running
### Prerequisites
- Node.js >= 20.0.0
- pnpm >= 9.0.0
- Docker & Docker Compose

### Setup
```bash
cp .env.example .env          # Fill Stripe keys
pnpm install                  # Install all workspace dependencies
docker compose up -d          # Start infra (Postgres, Redis, Nginx)
pnpm dev                      # Start all apps/services in watch mode
```

### Key Commands
- **Run dev:** `pnpm dev`
- **Build all:** `pnpm build`
- **Test all:** `pnpm test`
- **Typecheck:** `pnpm typecheck`
- **Lint:** `pnpm lint`
- **Migrations (Payments):** `pnpm --filter split-payments db:migrate`

## Development Conventions
### Naming & Style
- **Files:** `kebab-case.ts` (e.g., `payment.service.ts`).
- **Classes/Types:** `PascalCase`.
- **Functions/Variables:** `camelCase`.
- **DB Columns:** `snake_case`.
- **API Routes:** `/v1/resource-names` (kebab-case, plural).

### Directory Structure (Service)
- `src/routes/`: Express route handlers (thin).
- `src/services/`: Business logic.
- `src/repositories/`: Database access (SQL only).
- `src/middleware/`: Express middleware.
- `src/lib/`: External clients (Stripe, Redis, etc.).
- `src/types/`: TypeScript types and Zod schemas.

### API Response Standard
- **Success:** `{ "data": { ... } }`
- **Error:** `{ "error": { "code": "...", "message": "...", "details": [...] } }`

### Testing Requirements
- **Framework:** Vitest + Supertest.
- **Target:** 80% coverage for services and repositories.
- **Unit Tests:** Pure functions and services (mocked repos).
- **Integration Tests:** Real Postgres + Redis (Docker).

## Database Standards
- Use UUIDs for IDs (`gen_random_uuid()`).
- Every table MUST have `id`, `tenant_id`, `created_at`, and `updated_at`.
- Migrations are sequential (`0001_...sql`) and immutable. Never edit a merged migration.
