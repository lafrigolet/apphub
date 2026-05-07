# ADR 013 — App architecture: monolith per app + unified schema naming

**Status:** Accepted
**Date:** 2026-05-02
**Supersedes (partially):** the per-feature microservice layout that yoga-studio
inherited from before this ADR.

## Context

AppHub has two qualitatively different bodies of code:

1. **Platform** — capabilities that any app on the platform can reuse: auth,
   payments, notifications, storage, the marketplace stack, the appointments
   stack, etc. These already follow a strict modular layout — one schema per
   module, one role per module, one unit of migration. The reason is real:
   any module may eventually be extracted to its own container, and the
   modular split is what keeps that 4-step operation cheap (CLAUDE.md regla 4).

2. **Apps** — code specific to a single product surface (aikikan, future yoga
   studios, future split-pay product, …). This code is, by hypothesis, **not
   reusable across apps**. Modular boundaries here pay no dividend; they
   only add overhead — extra schemas, extra roles, extra GRANTs, extra
   cross-module event glue, and a bigger runbook for "extract this to its
   own container" that you will never use.

The previous default for apps was to mirror the platform pattern (e.g.
yoga-studio became 5 schemas + 8 services). In hindsight this was overkill
for app-internal code. The question this ADR answers is: **what's the
correct architecture for app-specific code, and how do we name the
schemas/roles uniformly across both planes?**

## Decision

### Two architectural modes

| Plane | Schema | Role | Unit of deploy | When to use |
|---|---|---|---|---|
| **Platform** | `platform_<modulo>` | `svc_platform_<modulo>` | the module's monolith container | for any cross-cutting capability that ≥2 apps will (or could) reuse |
| **App** | `app_<app>` | `svc_app_<app>` | the app's monolith container | for code that belongs to a single app and is not anticipated to be reused |

Naming is unified — no exceptions allowed for new code. Legacy schemas
(`splitpay_core`, `yoga_users`, `yoga_classes`, `yoga_bookings`,
`yoga_bonuses`, `yoga_reporting`) remain as-is; they are not refactored
under this ADR. A future ADR may revisit them when there is a concrete
trigger.

### Multi-tenant isolation is unchanged

In **both** planes, every domain table carries `(app_id, tenant_id,
sub_tenant_id)` and RLS isolates rows by:

```sql
USING (
  app_id    = current_setting('app.app_id',    true)
  AND tenant_id = current_setting('app.tenant_id', true)::uuid
)
```

The `withTenantTransaction(pool, appId, tenantId, subTenantId, fn)` helper
from `@apphub/platform-sdk/db` sets the context per transaction. **Tenant
isolation lives at the row level, not at the schema level**, in BOTH planes.
The schema split in `platform_*` is about modularity (extractability), not
about tenant isolation.

### App monolith layout

A new app `apps/<app>/<app>-server/` contains all the app's domain code in
one tree:

```
apps/aikikan/aikikan-server/
  src/
    routes/
      members.routes.js
      events.routes.js          ← when this dominio shows up, just a folder
      dues.routes.js
    services/...
    repositories/...
    events/                     ← event subscribers (user.revoked, …)
    lib/{env,logger,db,redis,migrate}.js
    app.js
    server.js
  migrations/
    0001_init.sql               ← creates app_aikikan.members, RLS, …
    0002_…sql
  Dockerfile
  package.json
```

One Pool, one role (`svc_app_<app>`), one migration sequence. Different
domains live in **folders**, not in **schemas**. Discipline of the folder
layout is what makes future extraction (when justified by evidence) viable.

### Boundary rule reaffirmed

The app monolith talks to `platform_*` ONLY via:
1. The platform module's public HTTP API (`/api/<module>/...`).
2. Redis pub/sub on `platform:events` (using the SDK's `subscribe()` /
   `publish()`).
3. Shared utilities exposed by `@apphub/platform-sdk`.

It NEVER reads or writes a `platform_*` schema with SQL directly. That
rule is what keeps the platform reusable. It applies to both legacy
(yoga-studio) and new (aikikan) apps.

### Scaling

When an app needs more throughput, replicate the whole `<app>-server`
container behind the gateway. No per-feature granularity inside the app at
the schema level. The five operational cautions below apply.

## Consequences

### Operational cautions (apply to every app monolith)

1. **Stateless container**. JWT for auth, Redis for caches and rate-limit
   counters, no in-process state. Without this, replicas diverge.

2. **DB connection pooling**. Each replica opens its own pg.Pool. At ≥5
   replicas, put PgBouncer in front of Postgres or you saturate
   `max_connections` quickly.

3. **Cron / background jobs**. Either route them through `platform-scheduler`
   (already exists, advisory-lock-protected, single-runner) or, if the job
   must live inside the app, use `pg_advisory_lock(<job_name_hash>)` so
   only one replica runs per tick. The default of "any replica runs cron"
   gives N× duplicate emails / events.

4. **Migrations as deploy step, not boot**. Race between replicas if all
   try to migrate on startup. Run the migrations container once, then
   start the app replicas. Or wrap migrations with `pg_advisory_lock`.

5. **Code organized by domain folder**. Even with a shared schema, keep
   `src/routes/<dominio>/`, `src/services/<dominio>/` separated by
   concern. This is what makes the eventual "extract this dominio to a
   platform module" extraction tractable when (or if) it's needed.

### Trade-offs explicitly accepted

- **One DB role per app, not per dominio**. An attacker (or careless code)
  with the role `svc_app_<app>` can touch any table in `app_<app>`. The
  schema-level access control of `platform_<modulo>` is gone here. Trade
  for productivity (JOINs, transactions across the dominio); enforce
  read-only-by-domain access at the application layer if/when needed
  (views, code reviews, tests).

- **One migration sequence per app**. Two features touching the same table
  must coordinate. This is process discipline, not architecture.

- **Replicating the whole container scales the whole app uniformly**, even
  if the bottleneck is one specific dominio. Acceptable until usage
  evidence says otherwise.

### Apps classification (as of this ADR)

| App | Architecture | Notes |
|---|---|---|
| `aikikan` | **app-monolith** (this ADR) | First app to adopt. `app_aikikan` schema, `svc_app_aikikan` role, `apps/aikikan/aikikan-server` container. |
| `yoga-studio` | **legacy multi-schema** | 5 schemas (`yoga_users`, `yoga_classes`, `yoga_bookings`, `yoga_bonuses`, `yoga_reporting`) + multiple containers. NOT refactored under this ADR. |
| `split-pay` (the app surface) | undecided | When/if it grows app-specific UI/domain beyond the platform module, will adopt the new pattern as `app_split_pay`. |
| `voragine-console` | n/a | Pure UI on top of `platform_*` modules. No app-domain schema needed. |
| `portal` | n/a | Pure UI. No app-domain schema. |
| Future apps | **app-monolith** | Default going forward. |

### Trigger to revisit (legacy)

Yoga-studio's 5-schema layout will be reconsidered if **any** of:
- The 8 yoga services consume more aggregate ops budget than is justified
  by their feature pace.
- A feature naturally crosses two yoga schemas often enough to make the
  cross-module event glue painful.
- A yoga module turns out to be reusable by another app — at which point
  it should be **extracted to platform** (not kept as-is), upgrading to
  `platform_<modulo>` proper.

Until one of those happens, yoga-studio stays.

### `splitpay_core` (legacy module name)

The `splitpay_core` schema is a platform module that pre-dates the
naming convention. It SHOULD be `platform_splitpay`. We keep it as-is
under this ADR — the rename has cost (touches every reference, role,
migration, init SQL) and zero benefit until something else forces a
visit. Documented as legacy debt; revisit when next touched for an
unrelated reason.

## See also

- `CLAUDE.md` — naming conventions section + critical rules section,
  updated to reflect this ADR.
- `infra/postgres/init/15_app_aikikan_schema.sql` — first instance of the
  `app_<app>` pattern provisioned at cluster init time.
- `apps/aikikan/aikikan-server/` — first app monolith built under this
  pattern.
- ADR 004 — domain-separated monolith containers (the platform side).
