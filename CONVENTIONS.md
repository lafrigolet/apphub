# Code Conventions

## TypeScript

- Strict mode enabled in all packages (`"strict": true`)
- No `any` — use `unknown` and narrow with type guards
- Prefer `interface` for public API shapes, `type` for unions and utility types
- Always type function return values explicitly
- Use `z.infer<typeof Schema>` from Zod for request/response types

## File naming

| Artefact | Convention | Example |
|---|---|---|
| Source file | `kebab-case.ts` | `split-engine.ts` |
| Test file | `kebab-case.test.ts` | `split-engine.test.ts` |
| Route handler | `resource.routes.ts` | `payment.routes.ts` |
| Service layer | `resource.service.ts` | `payment.service.ts` |
| Repository | `resource.repository.ts` | `payment.repository.ts` |
| Middleware | `name.middleware.ts` | `tenant.middleware.ts` |
| Types | `resource.types.ts` | `payment.types.ts` |

## Directory structure per service

```
services/my-service/
├── src/
│   ├── routes/          # Express route handlers (thin, delegate to services)
│   ├── services/        # Business logic (no DB access directly)
│   ├── repositories/    # DB access (SQL only, no business logic)
│   ├── middleware/      # Express middleware
│   ├── lib/             # External clients (Stripe, Redis, etc.)
│   ├── types/           # TypeScript types and Zod schemas
│   ├── utils/           # Pure utility functions
│   └── app.ts           # Express app factory
├── tests/
│   ├── unit/            # Unit tests (pure functions, services with mocked repos)
│   └── integration/     # Integration tests (real DB, Stripe test mode)
├── migrations/          # SQL migration files (numbered, immutable)
├── Dockerfile
└── package.json
```

## API design

- All routes are versioned: `/v1/...`
- Resource names are plural and kebab-case: `/v1/split-rules`, `/v1/payment-intents`
- HTTP verbs follow REST semantics
- Responses always have the shape:
  ```json
  { "data": { ... } }           // success
  { "error": { "code": "...", "message": "...", "details": [...] } }  // error
  ```
- Pagination uses cursor-based pagination: `?cursor=...&limit=20`
- Dates are ISO 8601 UTC strings

## Database

- Column names: `snake_case`
- Every table must have: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`,
  `tenant_id uuid NOT NULL`, `created_at timestamptz DEFAULT now()`,
  `updated_at timestamptz DEFAULT now()`
- Foreign keys always have explicit `ON DELETE` behaviour
- Indexes are named: `idx_{table}_{columns}`
- Migrations are numbered sequentially: `0001_create_transactions.sql`
- Migrations are immutable once merged to main — never edit, always add

## Error handling

- Use typed error classes that extend `AppError` (see `src/utils/errors.ts`)
- Never throw raw `Error` in service or route code
- All async route handlers are wrapped with `asyncHandler` middleware
- Stripe errors are caught and mapped to domain errors before re-throwing

## Testing

- Minimum coverage: 80% for services and repositories
- Unit tests use Vitest with mocked dependencies
- Integration tests run against a real PostgreSQL + Redis (via Docker in CI)
- Stripe interactions use `stripe-mock` in tests
- Test file mirrors source file location under `tests/`

## Git

- Branch names: `feat/short-description`, `fix/short-description`, `chore/short-description`
- Commit messages follow Conventional Commits: `feat: add split rule templates`
- PRs require at least one review and passing CI before merge
- Squash merge to keep main history clean

## Environment variables

- Never hardcode secrets or URLs
- Each service has its own prefix: `PAYMENTS_`, `AUTH_`, `NOTIF_`
- Validate all env vars at startup with Zod (fail fast if missing)
- Document every variable in `.env.example` with a comment
