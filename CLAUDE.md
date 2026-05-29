# CLAUDE.md

This file provides context for AI assistants (Claude, Copilot, etc.) working in this repository.

## Project overview

AppHub is a multi-app meta-platform. Each hosted app (aikikan, split-pay, …) gets its
own subdomain (`aikikan.hulkstein.com`, `splitpay.hulkstein.com`) and its own set of app-specific
microservices. All apps share a set of cross-cutting platform capabilities (auth, payments,
notifications, catalog, basket, tenant-config, subscriptions).

**Deployment model — modular monolith ready to split**: the cross-cutting platform
capabilities ship together as **modules** of a single Node container called `platform-core`
(port 3000). Each module keeps its own routes, repository, PostgreSQL schema, and dedicated
DB role, so any module can be extracted back to its own container with minimal effort. The
app-specific services under `apps/*/` keep their own containers.

## Repository structure

```
apphub/
├── platform/                  # Platform-side services. Five monolith containers (platform-core + platform-marketplace + platform-restaurant + platform-appointments + platform-scheduler).
│   ├── core/                  # platform-core orchestrator — port 3000 (auth/notifications/payments/tenant-config/splitpay)
│   ├── marketplace/           # platform-marketplace orchestrator — port 3100 (orders/inventory/reviews/messaging/shipping/disputes/catalog/basket)
│   ├── restaurant/            # platform-restaurant orchestrator — port 3200 (menu/reservations/floor-plan/kds/pos/delivery-dispatch)
│   ├── appointments/          # platform-appointments orchestrator — port 3300 (services/resources/bookings/availability/intake-forms/telehealth/packages/practitioner-payouts)
│   ├── scheduler/             # platform-scheduler — port 3400, single-runner cron for all 4 monoliths
│   ├── auth/                  # Auth module (in platform-core) — schema platform_auth
│   ├── payments/              # Payments module (in platform-core) — schema platform_payments
│   ├── notifications/         # Notifications module (in platform-core) — schema platform_notifications
│   ├── tenant-config/         # Tenant-config module (in platform-core) — schema platform_tenants
│   ├── splitpay/              # Splitpay module (in platform-core) — schema splitpay_core
│   ├── storage/               # Storage module (in platform-core) — schema platform_storage; S3-compatible bucket via MinIO
│   ├── leads/                 # Leads module (in platform-core) — schema platform_leads; public contact form + staff CRM
│   ├── donations/             # Donations module (in platform-core) — schema platform_donations; one-shot + recurring + fiscal (Ley 49/2002, AEAT 182)
│   ├── inquiries/             # Inquiries module (in platform-core) — schema platform_inquiries; per-tenant contact form (email-only, admin replies from personal inbox)
│   ├── orders/                # Orders module (in platform-marketplace) — schema platform_orders
│   ├── inventory/             # Inventory module (in platform-marketplace) — schema platform_inventory
│   ├── reviews/               # Reviews module (in platform-marketplace) — schema platform_reviews
│   ├── messaging/             # Messaging module (in platform-marketplace) — schema platform_messaging
│   ├── shipping/              # Shipping module (in platform-marketplace) — schema platform_shipping
│   ├── disputes/              # Disputes module (in platform-marketplace) — schema platform_disputes
│   ├── catalog/               # Catalog module (in platform-marketplace) — schema platform_catalog
│   ├── basket/                # Basket module (in platform-marketplace) — Redis-only
│   ├── menu/                  # Menu module (in platform-restaurant) — schema platform_menu
│   ├── reservations/          # Reservations module (in platform-restaurant) — schema platform_reservations
│   ├── floor-plan/            # Floor-plan module (in platform-restaurant) — schema platform_floor_plan
│   ├── kds/                   # KDS module (in platform-restaurant) — schema platform_kds
│   ├── pos/                   # POS module (in platform-restaurant) — schema platform_pos
│   ├── delivery-dispatch/     # Delivery-dispatch module (in platform-restaurant) — schema platform_delivery_dispatch
│   ├── services/              # Services catalog module (in platform-appointments) — schema platform_services
│   ├── resources/             # Resources module (in platform-appointments) — schema platform_resources
│   ├── bookings/              # Bookings module (in platform-appointments) — schema platform_bookings
│   ├── availability/          # Availability module (in platform-appointments) — schema platform_availability
│   ├── intake-forms/          # Intake-forms module (in platform-appointments) — schema platform_intake_forms
│   ├── telehealth/            # Telehealth module (in platform-appointments) — schema platform_telehealth
│   ├── packages/              # Packages module (in platform-appointments) — schema platform_packages
│   ├── practitioner-payouts/  # Practitioner-payouts module (in platform-appointments) — schema platform_practitioner_payouts
│   └── subscriptions/         # Subscriptions module (planned, slot reserved)
├── apps/                      # App bundles (frontends + app-specific services)
│   ├── portal/                # AppHub admin UI — port 5173
│   ├── split-pay/             # Split Pay frontend (splitpay-portal) — port 5175
│   ├── aikikan/               # Aikikan Aikido portal — port 5176
│   └── __app-template__/      # Blueprint for new apps (never deployed)
├── packages/                  # Internal shared packages (pnpm workspaces)
│   ├── eslint-config/         # @splitpay/eslint-config
│   ├── sdk-js/                # @apphub/sdk-js — public JS SDK
│   └── platform-sdk/          # @apphub/platform-sdk — internal service helpers
├── infra/                     # Docker, NGINX, PostgreSQL init scripts
└── docs/                      # ADRs
```

## Tech stack

- **Runtime**: Node.js 20 LTS
- **Language**: JavaScript (ESM) for services and frontends — no TypeScript
- **Framework**: Fastify 4 for services, React 18 + Vite for frontends
- **Styling**: Tailwind CSS 3
- **Database**: PostgreSQL 16 — one schema per module / per app-specific service
- **Cache**: Redis 7
- **Payments**: Stripe Node SDK (latest)
- **Testing**: Vitest + Supertest
- **Containerisation**: Docker + Docker Compose
- **Monorepo**: pnpm workspaces + Turborepo
- **CI/CD**: GitHub Actions

## Identity model — three JWT claims

Every JWT issued by `platform/auth` carries:

```json
{
  "sub": "user-uuid",
  "app_id": "aikikan",
  "tenant_id": "tenant-uuid",
  "sub_tenant_id": "sub-tenant-uuid-or-null",
  "role": "user",
  "email": "user@example.com"
}
```

- `app_id` — which app this user belongs to (`aikikan`, `split-pay`, …)
- `tenant_id` — which deployment of that app (e.g. one aikikan federation chapter)
- `sub_tenant_id` — sub-unit within the tenant (e.g. a dojo branch), nullable

## Critical rules for AI assistants

1. **Never remove `tenant_id` scoping** from any database query. Every SELECT, INSERT,
   UPDATE, DELETE must be scoped to the current tenant.
2. **Always include `app_id` scoping** alongside `tenant_id`. An aikikan token must never
   read split-pay data even when `tenant_id` matches.
3. **Always use idempotency keys** for Stripe API calls. Keys are stored in Redis with a 24h TTL.
4. **Never cross schema boundaries** — a module may only query its own PostgreSQL schema.
   Even though all platform modules share the `platform-core` process, each one connects
   through its own Pool, bound to its dedicated service role.
5. **Validate webhook signatures** — every incoming Stripe webhook must verify `Stripe-Signature`.
6. **Split reversals are proportional** — refund each Transfer by the same percentage as the
   original split, never a flat amount.
7. **sub_tenant_id is nullable** — code must handle both single-level and two-level tenancy.
8. **Use `appGuard` from `@apphub/platform-sdk`** — never write a custom JWT guard. Set
   `EXPECTED_APP_ID` in the service env; the guard returns `403 APP_MISMATCH` on mismatch.
9. **Write JavaScript, not TypeScript** — all services and frontends use `.js` / `.jsx`.
10. **Check the platform registry before building anything new — and ASK where it should
    live.** Before scaffolding *any* new microservice, module, table, or significant
    feature, follow the decision tree in
    [§ "Adding new functionality"](#adding-new-functionality--decision-tree). The short
    version: (a) if the platform already implements it, reuse / extend the existing
    module; (b) if not, **stop and ask the user**: "should this be a new platform module
    (reusable by every app) or live inside the requesting portal/app-server (specific to
    this app)?" Never silently default to one option. Reuse is the cheapest, extraction
    second cheapest only if a reusable abstraction is obvious; "build it locally for
    this app" is correct when the feature is genuinely app-specific.
11. **Each module / service connects with its own dedicated DB role** — never use the shared
    superuser at runtime. Inside `platform-core` this means one Pool per module, each with
    `postgresql://svc_platform_<module>:...` (set via per-module env vars on the `platform-core`
    container). `migrate.js` per module uses `MIGRATION_DATABASE_URL` (the superuser); the
    application pool uses the module's own role. The same rule applies to app-specific
    services running in their own containers.
12. **Update `.md` files after any significant implementation** — keep `ARCHITECTURE.md`,
    `CHANGELOG.md`, `CONVENTIONS.md`, and `DEVELOPMENT.md` in sync with what was built.
    Specifically: new services → `ARCHITECTURE.md` + `DEVELOPMENT.md`; new patterns →
    `CONVENTIONS.md`; any change → `CHANGELOG.md` unreleased section.
13. **Module boundaries are sacred** — a `platform/<module>/` may not import internals
    from another `platform/<module>/`. Cross-module communication goes through (a) the
    module's public HTTP API, (b) Redis pub/sub on `platform.events`, or (c) shared utilities
    in `@apphub/platform-sdk`. This is what keeps the monolith ready to split.
14. **App-specific code is a monolith with one schema** — see ADR 013. New apps live in
    `apps/<app>/<app>-server/` with a single schema `app_<app>` and a single role
    `svc_app_<app>`. Granular schema separation is reserved for `platform_*`. Tenant
    isolation in `app_<app>` is by row (`(app_id, tenant_id, sub_tenant_id)` + RLS),
    same as in `platform_*`. The app monolith MUST NOT cross-schema-read `platform_*`;
    it talks to platform via HTTP module APIs or Redis events. New apps default to
    `app_<app>`.

## Adding new functionality — decision tree

When the user asks for a new feature (a new microservice, a new admin page,
a new table, a flow that touches several modules), follow this **before
writing any code**:

### Step 1 — Inventory check

Read the platform module registry below (§ Platform module registry). For
each capability the feature needs, classify:

| Status | Action |
|---|---|
| ✅ implemented module exists and covers it | **REUSE**: call it via its public HTTP API or subscribe to its events. |
| 🔧 module exists but is a skeleton / missing pieces | **EXTEND** the existing module (add routes, columns, events). |
| ❌ nothing in `platform/` covers it | go to Step 2. |

If the feature blends with something close (e.g. "events with registration"
≈ `services` + `sessions` + `bookings`), prefer **EXTEND** over a new module.
Document the modeling fit honestly — don't shoehorn a square peg.

### Step 2 — Stop and ask the user

When nothing in the registry fits, **the assistant must pause and ask the
user explicitly which side of the line the work belongs on**. Use a prompt
like:

> "This functionality (`<feature name>`) isn't covered by any current
> platform module. Where do you want it to live?
>
> **(a) New platform module** — `platform/<name>/`, reusable by every app.
> Cost: a new schema, role, migrations, registry update, ADR if the
> decision is non-obvious. Right when the feature is generic (orders,
> notifications, calendar slots, …) and ≥1 other app could use it.
>
> **(b) Inside the requesting app** — `apps/<app>/<app>-server/` (or its
> portal). Lives in `app_<app>` schema. Right when the feature is
> genuinely specific to that app's domain (aikikan grade exams, restaurant
> menu modifiers tied to a specific brand, …).
>
> A third path (c) is to **introduce it as app-local first and extract to
> platform later** when a second app needs it. Pragmatic when there's
> uncertainty about reusability; the migration cost is real but bounded."

Wait for the answer. Don't pre-implement either side while the question is
open. If the user is ambivalent, recommend (c) — local first, extract
later — and capture the trigger that would justify extraction (e.g. "extract
when a second app requests events with registrations").

### Step 3 — Document the choice

Whichever path is picked:

- If **platform module**: register it in the platform module registry
  table below + add an ADR if the decision is non-obvious (different
  domain, novel pattern, deferred from a more obvious option). Update
  `ARCHITECTURE.md`.
- If **app-local**: add a one-line note to the app's TODO so the
  extraction trigger isn't forgotten. If the feature later moves to
  platform, the source-of-truth migration goes through a cutover
  migration (template: `apps/aikikan/aikikan-server/migrations/0009_cutover_to_platform_sessions.sql`).

### Anti-patterns to refuse

- **Silently defaulting to one side without asking.** Even if reuse seems
  obvious, the user must know that decision is being made.
- **Duplicating a capability** that already exists in platform (e.g.
  building a private `events` table when `services + service_sessions`
  fits, or a private payment table when `splitpay` covers it).
- **Pre-extracting** to platform "just in case", before a second consumer
  exists. Reusable abstractions ossify when no one else uses them yet.
- **Hiding app-local code in `platform/`** because it's "easier to
  organize there". Locating code wrong is a much higher long-term cost
  than picking the longer initial path.

## Modular monolith architecture

`platform-core` is a single Docker container running one Node process that hosts all
horizontal capabilities. It listens on **port 3000**. NGINX routes
`/api/{auth,users,payments,notifications,catalog,basket,tenants,apps,audit,subscriptions}/*`
to a single `platform_core` upstream.

### Module list

| Module | Path | Schema | DB role |
|---|---|---|---|
| auth | `platform/auth/` | `platform_auth` | `svc_platform_auth` |
| payments | `platform/payments/` | `platform_payments` | `svc_platform_payments` |
| notifications | `platform/notifications/` | `platform_notifications` | `svc_platform_notifications` |
| catalog | `platform/catalog/` | `platform_catalog` | `svc_platform_catalog` |
| basket | `platform/basket/` | — (Redis-only) | — |
| tenant-config | `platform/tenant-config/` | `platform_tenants` | `svc_platform_tenants` |
| subscriptions | `platform/subscriptions/` | `platform_subscriptions` | `svc_platform_subscriptions` |

### Entry point — `platform/core/src/server.js`

Boot order:

1. Load env (compose-injected vars)
2. Create one Pool per module, each bound to its dedicated role:
   `createPool('postgres://svc_platform_<module>:...@postgres:5432/apphub')`
3. Run module migrations sequentially (each module exports `runMigrations(superuserUrl)`)
4. Create the root Fastify app; register `helmet`, `cors`, `rate-limit`, `appGuard`,
   `sensible` once
5. For each module: `await module.register({ app, db: pools[module], redis, logger: logger.child({ module }) })`
6. `app.listen({ port: 3000, host: '0.0.0.0' })`

### Module contract

Every module exports from `platform/<module>/src/index.js`:

```js
export async function register({ app, db, redis, logger }) {
  // register routes under the module's prefix
  // never reach into another module's pool, repository, or service
}

export async function runMigrations(superuserUrl) {
  // apply migrations/*.sql against the module's schema
}
```

### Cross-module communication

A module **must not** import internals from another module. Permitted channels:

1. **HTTP** — call the module's own public API as an external client would
2. **Events** — publish/subscribe via `redis.publish('platform.events', …)` from
   `@apphub/platform-sdk`
3. **Shared SDK** — utilities exposed by `@apphub/platform-sdk` (DB helpers, JWT guard, errors)

This rule is what keeps the monolith ready to split.

### Splitting a module back to its own container

When a module needs independent scaling, splitting it is a 4-step operation:

1. Add `platform/<module>/src/server.js` that imports `register` and runs its own listener
2. Add `platform/<module>/Dockerfile` (workspace-context multi-stage)
3. Add a new service in `docker-compose.yml` and a new upstream in
   `infra/nginx/conf.d/upstream.conf`
4. Repoint `/api/<module>/` in `infra/nginx/snippets/platform-routes.conf` to the new upstream

Zero changes to business logic. The dedicated DB role is already what it would be in a
separate container.

## Naming conventions

- Files: `kebab-case.js` / `kebab-case.jsx`
- Functions / variables: `camelCase`
- Database columns: `snake_case`
- Environment variables: `SCREAMING_SNAKE_CASE`
- API routes: `/v1/resource-name` (kebab, versioned)
- Platform schemas: `platform_<modulo>` (prefix `platform_`); role `svc_platform_<modulo>`
- App schemas: `app_<app>` (single schema per app, prefix `app_`); role `svc_app_<app>`.
  See ADR 013.

## Slash commands

Comandos imperativos paso-a-paso viven en archivos individuales bajo
`.claude/commands/` (lazy-loaded por Claude Code — solo entran a contexto
cuando el usuario los invoca). El espíritu y precedencia de cada uno es:

El flujo canónico para construir un app nuevo desde un prototipo HTML
hasta un portal con admin configurable es:

```
/bootstrap-app → /html-to-jsx → /importa → /implementa → /add-admin-config
  (scaffolding)   (HTML → JSX)  (JSX → split)  (backend)   (config dinámica)
```

| Slash | Cuándo invocarlo | Archivo |
|---|---|---|
| `/bootstrap-app <name>` | Crear portal landing-only para un app nuevo, con dev + prod + CI completos | [.claude/commands/bootstrap-app.md](.claude/commands/bootstrap-app.md) |
| `/html-to-jsx <name>` | Convertir `<name>-landing.html` prototype a un único `Landing.jsx` monolítico (preservación 1:1) | [.claude/commands/html-to-jsx.md](.claude/commands/html-to-jsx.md) |
| `/importa <name>` | Partir `Landing.jsx` monolítico en estructura canónica (`data/` + `components/` + `views/` + `lib/` + `hooks/`) y wirea forms públicos | [.claude/commands/importa.md](.claude/commands/importa.md) |
| `/implementa <name>` | Generar los microservicios derivados del prototipo importado (REUSE / EXTEND / IMPLEMENT / CREATE) | [.claude/commands/implementa.md](.claude/commands/implementa.md) |
| `/add-admin-config <name>` | Descubrir parámetros configurables en la landing y exponerlos en `/admin/<feature>` (precedencia: calculadora js-electric, commit `beb7c0b`) | [.claude/commands/add-admin-config.md](.claude/commands/add-admin-config.md) |

Cada paso es opcional según de dónde vengas:
- Si ya tienes el JSX a mano (caso aulavera, aikikan), saltas
  `/html-to-jsx` y vas directo a `/importa`.
- Si el app es marketing puro y reutiliza todo de `platform/`, puede que
  `/implementa` sea casi no-op (solo seed) y vayas directo a
  `/add-admin-config`.

Para añadir un comando nuevo: crea `.claude/commands/<name>.md` con
frontmatter `description:` y opcional `argument-hint:`, y añade una
entrada a la tabla anterior.

## Where to start when adding a new app

1. `cp -r apps/__app-template__/ apps/my-app/` — rename dirs, update `package.json` names
2. Assign ports: frontend at 5176+, services at 3030+
3. Register in DB: `INSERT INTO platform_tenants.apps ...`
4. Create PostgreSQL schema: `infra/postgres/init/0N_my_app_schema.sql`
5. Add services to `docker-compose.yml`
6. Add NGINX server block `infra/nginx/conf.d/my-app.conf` with
   `include /etc/nginx/snippets/platform-routes.conf`
7. Add `/etc/hosts` entry: `127.0.0.1 myapp.hulkstein.local`

## Platform module registry

apphub ships **two monolith containers**, each hosting a coherent domain.
See [ADR 004](docs/adr/004-domain-separated-monolith-containers.md) for the rationale.
Before adding any new horizontal capability, check whether it already exists in one of them.

### platform-core (port 3000) — horizontal infrastructure

| Capability | Module | Schema | DB role | Status |
|---|---|---|---|---|
| Auth (email/password + OAuth) | `platform/auth` | `platform_auth` | `svc_platform_auth` | ✅ Implemented |
| Stripe payments | `platform/payments` | `platform_payments` | `svc_platform_payments` | 🔧 Skeleton |
| Email / push notifications | `platform/notifications` | `platform_notifications` | `svc_platform_notifications` | ✅ Implemented |
| App & tenant registry | `platform/tenant-config` | `platform_tenants` | `svc_platform_tenants` | ✅ Implemented |
| Stripe Connect (split payments) | `platform/splitpay` | `splitpay_core` | `splitpay` (shared) | ✅ Implemented |
| Object storage (S3/MinIO presigned URLs) | `platform/storage` | `platform_storage` | `svc_platform_storage` | ✅ Implemented |
| Leads (landing contact form, lead CRM) | `platform/leads` | `platform_leads` | `svc_platform_leads` | ✅ Implemented |
| Donations (one-shot + recurring + fiscal Ley 49/2002 + AEAT 182) | `platform/donations` | `platform_donations` | `svc_platform_donations` | ✅ Implemented |
| Inquiries (per-tenant contact form, email-only V1) | `platform/inquiries` | `platform_inquiries` | `svc_platform_inquiries` | ✅ Implemented |

### platform-marketplace (port 3100) — marketplace transactions

| Capability | Module | Schema | DB role | Status |
|---|---|---|---|---|
| Orders (persistent ledger) | `platform/orders` | `platform_orders` | `svc_platform_orders` | ✅ Implemented |
| Inventory (stock by SKU) | `platform/inventory` | `platform_inventory` | `svc_platform_inventory` | ✅ Implemented |
| Reviews (verified + replies) | `platform/reviews` | `platform_reviews` | `svc_platform_reviews` | ✅ Implemented |
| Messaging (buyer ↔ vendor) | `platform/messaging` | `platform_messaging` | `svc_platform_messaging` | ✅ Implemented |
| Shipping (zones, rates, tracking) | `platform/shipping` | `platform_shipping` | `svc_platform_shipping` | ✅ Implemented |
| Disputes (operational, pre-chargeback) | `platform/disputes` | `platform_disputes` | `svc_platform_disputes` | ✅ Implemented |
| Product & service catalogue | `platform/catalog` | `platform_catalog` | `svc_platform_catalog` | ✅ Implemented |
| Shopping cart (Redis-only) | `platform/basket` | — | — | ✅ Implemented |

### platform-restaurant (port 3200) — restaurant operations

| Capability | Module | Schema | DB role | Status |
|---|---|---|---|---|
| F&B menu (modifiers, allergens, availability windows, 86-list) | `platform/menu` | `platform_menu` | `svc_platform_menu` | ✅ Implemented |
| Reservations + waitlist | `platform/reservations` | `platform_reservations` | `svc_platform_reservations` | ✅ Implemented |
| Floor plan / tables / sections | `platform/floor-plan` | `platform_floor_plan` | `svc_platform_floor_plan` | ✅ Implemented |
| Kitchen Display System | `platform/kds` | `platform_kds` | `svc_platform_kds` | ✅ Implemented |
| POS bills / split / tips / mixed payments | `platform/pos` | `platform_pos` | `svc_platform_pos` | ✅ Implemented |
| Delivery dispatch (riders, zones, GPS, fleet) | `platform/delivery-dispatch` | `platform_delivery_dispatch` | `svc_platform_delivery_dispatch` | ✅ Implemented |

### platform-appointments (port 3300) — appointment / scheduling

| Capability | Module | Schema | DB role | Status |
|---|---|---|---|---|
| Bookable services catalog (duration, buffers, modality) | `platform/services` | `platform_services` | `svc_platform_services` | ✅ Implemented |
| Resources — practitioners, rooms, equipment, schedules | `platform/resources` | `platform_resources` | `svc_platform_resources` | ✅ Implemented |
| Bookings — appointment FSM, recurrence, reschedule, waitlist | `platform/bookings` | `platform_bookings` | `svc_platform_bookings` | ✅ Implemented |
| Availability engine — slot computation + atomic Redis holds | `platform/availability` | `platform_availability` | `svc_platform_availability` | ✅ Implemented |
| Intake forms — pre-appointment questionnaires + signatures | `platform/intake-forms` | `platform_intake_forms` | `svc_platform_intake_forms` | ✅ Implemented |
| Telehealth — video room provisioning + tokens | `platform/telehealth` | `platform_telehealth` | `svc_platform_telehealth` | ✅ Implemented |
| Packages — prepaid session bundles, balance + expiry | `platform/packages` | `platform_packages` | `svc_platform_packages` | ✅ Implemented |
| Practitioner payouts — commissions, accruals, periodic close | `platform/practitioner-payouts` | `platform_practitioner_payouts` | `svc_platform_practitioner_payouts` | ✅ Implemented |

### platform-scheduler (port 3400) — single-runner cron

Cron-as-a-service container that polls Postgres + Redis and publishes events to
the other 4 monoliths. Runs as `replicas: 1` to guarantee exactly-once. Each
job uses Postgres advisory locks to skip overlapping ticks. Has its own role
`svc_platform_scheduler` with `BYPASSRLS` and minimal cross-schema GRANTs.
No public NGINX route in V1; admin endpoints (`/v1/scheduler/jobs`,
`/v1/scheduler/runs`, `/v1/scheduler/jobs/:name/run`) are reachable only over
the docker network. See [ADR 007](docs/adr/007-platform-scheduler.md).

| Job | Cron | Effect |
|---|---|---|
| `availability-hold-purge` | `* * * * *` | DELETE expired holds |
| `booking-reminders` | `*/5 * * * *` | publish `booking.reminder.due` (T-24h, T-2h) |
| `booking-recurrence-expander` | `0 * * * *` | materialize recurrent bookings 30 days ahead |
| `reservation-reminders` | `*/5 * * * *` | publish `reservation.reminder.due` |
| `package-expiry-warning` | `0 8 * * *` | publish `package.expiring` (T-30d, T-7d) |
| `package-expiry-transition` | `30 0 * * *` | flip active → expired |
| `practitioner-payout-close` | `0 2 * * *` | publish `payout.period_due` per schedule |
| `dispute-sla` | `*/30 * * * *` | publish `dispute.sla_breached` (>48h no vendor reply) |
| `basket-abandoned` | `0 * * * *` | publish `basket.abandoned` for idle baskets |

### Planned

| Capability | Module | Status |
|---|---|---|
| Subscriptions / recurring billing | `platform/subscriptions` | 📋 Planned (slot reserved in platform-core) |

**OAuth providers supported by the `auth` module:** Google (`credential` id_token), Facebook (`accessToken`).
Routes: `POST /v1/auth/oauth/google`, `POST /v1/auth/oauth/facebook`.

## Where to start when adding a new platform module

1. **Check the registry above first** — if a skeleton exists, implement it rather than scaffolding a new module.
2. Copy any existing implemented module (e.g. `platform/auth/`) as a template.
3. Add the dedicated DB role and schema to `infra/postgres/init/01_platform_schemas.sql`.
4. Export `register({ app, db, redis, logger })` and `runMigrations(superuserUrl)` from
   `platform/<svc>/src/index.js`.
5. Register the module in `platform/core/src/server.js`: create the module's Pool with its
   own role URL, call `await module.runMigrations(MIGRATION_DATABASE_URL)`, then
   `await module.register(deps)`.
6. Add `DATABASE_URL_<SVC>` and `SVC_PLATFORM_<SVC>_DB_PASSWORD` to the `platform-core`
   service in `docker-compose.yml`.
7. Add a route prefix in `infra/nginx/snippets/platform-routes.conf` pointing at the
   `platform_core` upstream.
8. Update the platform module registry above and `ARCHITECTURE.md`.

## Environment variables

All secrets live in `.env` (never committed). See `.env.example` for required keys.
Platform-wide secrets use the prefix `PLATFORM_`. App-specific secrets use the app
prefix (e.g. `SPLITPAY_` for split-pay services).

## Module-level runtime config (DB-backed, encrypted)

Each module of `platform-core` exposes an `/v1/<module>/admin/config` (or
`…/oauth-providers`, etc.) surface that console uses to bootstrap
the module without redeploys. Secrets (Stripe keys, OAuth client_secret,
Resend API key, S3 access keys) are stored in dedicated `*.config` /
`*.settings` / `*.oauth_providers` tables, encrypted at rest with AES-256-GCM
via `@apphub/platform-sdk/crypto`. The master key is `PLATFORM_CONFIG_ENCRYPTION_KEY`
(32 bytes hex). Each module's runtime resolves config in this order: DB row →
env var → throw. **All admin endpoints require `requireRole('super_admin', 'staff')`.**

When you add a new module that needs runtime-configurable secrets:
1. Add a `<schema>.config` table with `key TEXT PK CHECK(...)` + `encrypted_value BYTEA`
   + `plain_value TEXT` (for non-secret settings).
2. Add a `repositories/config.repository.js` using `encryptSecret`/`decryptSecret`.
3. Add `routes/admin.routes.js` with `fastify.addHook('onRequest', requireRole('super_admin', 'staff'))`
   and GET/PATCH endpoints.
4. Register it in `src/index.js` under `/v1/<module>/admin`.
5. Refactor the module's runtime to read from the new repo with env fallback.
6. Add a section to console's sidebar + view under
   `apps/console/console-portal/src/views/staff/config/`.
