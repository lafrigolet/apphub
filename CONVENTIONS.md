# Code Conventions

## Language

All services and frontends are written in JavaScript (ESM). No TypeScript.
Use JSDoc comments only where the types are non-obvious.

## File naming

| Artefact | Convention | Example |
|---|---|---|
| Source file | `kebab-case.js` | `split-engine.js` |
| React component | `PascalCase.jsx` | `BookingCard.jsx` |
| Test file | `kebab-case.test.js` | `split-engine.test.js` |
| Route handler | `resource.routes.js` | `payment.routes.js` |
| Service layer | `resource.service.js` | `payment.service.js` |
| Repository | `resource.repository.js` | `payment.repository.js` |

## Directory structure per service

```
{service}/
├── src/
│   ├── routes/          # Fastify route handlers (thin, delegate to services)
│   ├── services/        # Business logic (no DB access directly)
│   ├── repositories/    # DB access (SQL only, no business logic)
│   ├── lib/             # External clients (db, redis, env, logger)
│   ├── plugins/         # Fastify plugins (app-guard, etc.)
│   └── app.js           # Fastify app factory
├── src/__tests__/       # Vitest test files
├── migrations/          # SQL migration files (numbered, immutable)
├── Dockerfile
└── package.json
```

## Platform SDK usage

Always import shared utilities from `@apphub/platform-sdk` — never copy-paste them:

```js
import { appGuard }         from '@apphub/platform-sdk/app-guard.js'
import { setTenantContext } from '@apphub/platform-sdk/db.js'
import { AppError }         from '@apphub/platform-sdk/errors.js'
import { createLogger }     from '@apphub/platform-sdk/logger.js'
import { publish }          from '@apphub/platform-sdk/redis.js'
```

## JWT guard

Register `appGuard` in every Fastify app. Set `EXPECTED_APP_ID` in the environment:

```js
// platform services
EXPECTED_APP_ID=platform

// app-specific services
EXPECTED_APP_ID=yoga-studio   // or split-pay, etc.
```

## API design

- All routes are versioned: `/v1/...`
- Resource names are plural and kebab-case: `/v1/split-rules`, `/v1/booking-sessions`
- HTTP verbs follow REST semantics
- Responses always have the shape:
  ```json
  { "data": { ... } }
  { "error": { "code": "...", "message": "..." } }
  ```
- Pagination uses cursor-based pagination: `?cursor=...&limit=20`
- Dates are ISO 8601 UTC strings

## Database

- Column names: `snake_case`
- Every table must have: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`,
  `app_id text NOT NULL`, `tenant_id uuid NOT NULL`,
  `created_at timestamptz DEFAULT now()`, `updated_at timestamptz DEFAULT now()`
- `sub_tenant_id uuid` is added where two-level tenancy is needed (nullable)
- Indexes are named: `idx_{table}_{columns}`
- Migrations are numbered sequentially: `0001_create_transactions.sql`
- Migrations are immutable once merged to main — never edit, always add
- Schema names use the pattern `platform_*` for platform services and `{app}_*` for app services

## PostgreSQL session context

Use `setTenantContext` from `platform-sdk` before any tenant-scoped query:

```js
await setTenantContext(client, req.identity.appId, req.identity.tenantId, req.identity.subTenantId)
```

This sets `app.app_id`, `app.tenant_id`, and `app.sub_tenant_id` — all three RLS vars.

## Error handling

- Use typed error classes that extend `AppError` from `@apphub/platform-sdk/errors.js`
- Never throw raw `Error` in service or route code
- Handle async errors with Fastify's built-in error handler

## Testing

- Minimum coverage: 80% for services and repositories
- Use Vitest with `vi.mock()` for mocking dependencies
- Tests live in `src/__tests__/` alongside source
- Stripe interactions use mocked clients in tests

## Git

- Branch names: `feat/short-description`, `fix/short-description`, `chore/short-description`
- Commit messages follow Conventional Commits: `feat: add split rule templates`
- PRs require at least one review and passing CI before merge
- Squash merge to keep main history clean

## Environment variables

- Never hardcode secrets or URLs
- Platform-wide secrets use the prefix `PLATFORM_` (e.g. `PLATFORM_JWT_SECRET`)
- App-specific secrets use the app prefix (e.g. `SPLITPAY_STRIPE_SECRET_KEY`)
- Validate all env vars at startup with Zod (fail fast if missing)
- Document every variable in `.env.example` with a comment
