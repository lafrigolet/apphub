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

## Cross-module HTTP loopback

Cuando un módulo de `platform-core` necesita las capacidades de otro
módulo del mismo proceso (ej. `platform/donations` → `platform/splitpay`
para crear la Checkout Session, o `platform/donations` →
`platform/storage` para subir el PDF del certificado), llama por **HTTP
loopback** a `process.env.PLATFORM_CORE_BASE_URL` (default
`http://platform-core:3000`), no a través de un import directo.

Razones:
- El módulo destino aplica `appGuard`, rate-limit y validación zod tal
  como lo haría con cualquier otro consumidor — sin reglas especiales
  para llamadas "internas".
- El día que el módulo se separe a su propio container, la llamada
  funciona sin cambios.
- El JWT del request inicial (si lo hubiera) puede propagarse en el
  header `Authorization: Bearer …` para preservar identidad.

## Cross-app event subscribers

Los módulos de plataforma que sirven a varios apps a la vez (p.ej.
`platform/donations` recibe checkout events que podrían venir de
aikikan, splitpay o cualquier otro) deben **`psubscribe('*.events')`**
con patrón y filtrar internamente por `metadata.purpose` (o equivalente)
para identificar los eventos relevantes. No suscribirse hard-coded a
`aikikan.events` — eso ataría el módulo a un único app.

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
EXPECTED_APP_ID=aikikan       // or split-pay, etc.
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

## Public (unauthenticated) endpoints

Endpoints marked `config: { public: true }` (contact forms, lead capture)
must ship with anti-abuse from day one:

- **Per-route rate-limit override** on top of the global `@fastify/rate-limit`:
  `config: { public: true, rateLimit: { max: 5, timeWindow: '1 minute' } }`.
  This relies on `trustProxy: true` in each monolith's `Fastify()` options so
  `req.ip` is the real client IP behind NGINX/Cloudflare — never remove it.
- **Honeypot field `website`** in the body schema: hidden in the form, humans
  leave it empty. When it arrives non-empty, reply with a `201` that is
  indistinguishable from a real success (fake id/reference) but do NOT persist
  or publish events. See `platform/leads/src/routes/leads.routes.js`.

### Public file downloads (platform/storage)

Anonymous downloads exist only for kinds flagged `public: true` in
`platform/storage/src/kinds.js` (e.g. `public_download` for landing
materials). The flow is `GET /v1/storage/public/:id?appId&tenantId` →
`302` to a short-lived presigned GET — nginx/Node never proxy the bytes.
The object UUID is unguessable and the lookup still runs under RLS with the
appId/tenantId from the query. Every other kind stays authenticated-only;
never flag a kind `public` if its objects can contain user data.

## Provider webhooks (signed, raw body)

Provider-signed webhooks (`config: { public: true }`) verify the provider's
signature, never a JWT. When the scheme signs the exact request bytes (Stripe,
Svix/Resend), capture the raw body with a content-type parser **encapsulated to
the webhook routes' register context** — never globally:

```js
await app.register(async (scope) => {
  scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    if (req.routeOptions?.config?.rawBody) req.rawBody = body
    try { done(null, body.length ? JSON.parse(body.toString()) : {}) }
    catch (err) { err.statusCode = 400; done(err, undefined) }
  })
  await scope.register(webhooksRoutes, { prefix: '…/webhooks' })
})
```

See `platform/splitpay/src/index.js` (Stripe) and
`platform/notifications/src/index.js` (Resend/Svix). Webhook routes always
reply 200 after passing the signature gate — processing errors are absorbed
and logged so the provider doesn't retry-storm; the failure lands in the
module's own dead-letter state instead.

## Inbound email (reply tokens)

When an outbound email should have its replies re-ingested into a platform
conversation, mint a plus-addressed Reply-To with
`mintReplyAddress({ targetEvent, context, appId, tenantId })` from
`platform/notifications` (`reply-address.service.js`). It returns
`reply+<token>@<inbound_domain>` or **null** when inbound is disabled — always
fall back to the previous Reply-To on null. Tokens are lowercase hex (email
local-parts are case-insensitive in practice; never put case-sensitive tokens
in an address). Consumers subscribe to the token's `targetEvent` on
`platform.events`; the payload carries `text` (quoted history stripped),
`rawText`, attachment storage keys and the token's `context`.

## Notification senders

Every sender in `platform/notifications` (email/SMS/push) must record each
attempt in `platform_notifications.send_log` via
`services/send-log.service.js#logSend` with status `sent | failed | skipped`.
The write is best-effort: a logging failure must never break the send.
Template keys travel from `compose()` to `send()` as `templateKey` — when
adding a new sender wrapper, pass the template key through.

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

## Database connection isolation

Each microservice must use its own dedicated PostgreSQL role at runtime. Never use the
shared superuser for application queries. Use two separate connection strings:

```yaml
# docker-compose.yml — platform-auth example
DATABASE_URL: postgresql://svc_platform_auth:platform_auth_secret@postgres:5432/splitpay
MIGRATION_DATABASE_URL: postgresql://splitpay:splitpay@postgres:5432/splitpay
```

- `DATABASE_URL` → restricted role, schema-scoped grants, RLS enforced — used by the app pool
- `MIGRATION_DATABASE_URL` → superuser, used **only** by `migrate.js` for DDL (CREATE TABLE)

In `migrate.js`:
```js
const migrationPool = new pg.Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL })
```

Service roles and schema grants are defined in `infra/postgres/init/01_platform_schemas.sql`.

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
