# ADR 007 — `platform-scheduler`: single-runner cron for the 4 monoliths

## Status

Accepted — 2026-04-30.

## Context

`TODO.md` lists **scheduler/cron centralizado** as priority #1 because it
unblocks features in ≥5 modules: booking/reservation reminders (T-24h / T-2h),
RRULE recurrence expansion, expired availability-hold cleanup, package
expiry warnings (T-30d / T-7d) and `active → expired` transitions, periodic
practitioner payout closure, dispute SLA breach detection, and abandoned-cart
detection on baskets.

Until this ADR, no centralized scheduler existed in the platform monoliths.
Yoga-studio uses `node-cron` inside its own PM2 container, but that's not
visible to the rest of the platform.

## Decision

Run a fifth domain-separated monolith **`platform-scheduler`** on port 3400,
with the same module-monolith conventions (Fastify orchestrator + Dockerfile +
its own DB role + `register/runMigrations` patterns) as the other four. Each
cron job is a tiny ESM module under `platform/scheduler/src/jobs/` that
exports `meta = { name, cron, description }` and `run({ db, redis, publish, logger })`.

## Why a separate container instead of a `scheduler/` module of `platform-core`

1. **Single-runner constraint**. A cron tick must fire exactly once across the
   cluster. `platform-core` is built to scale horizontally for login spikes
   (auth) and event fan-out (notifications). Mounting cron inside it forces
   either `replicas: 1` for the whole monolith — losing horizontal scale for
   auth — or a distributed lock for every tick. A dedicated container with
   `replicas: 1` is the simplest correct answer.
2. **Blast radius**. A poorly-indexed `SELECT * FROM bookings WHERE …` in a
   cron job that lives inside `platform-core` saturates the same pool that
   serves login. Isolating cron in its own container keeps the auth pool healthy.
3. **Cross-schema reads without contaminating other roles**. The scheduler
   needs `SELECT/UPDATE` on six other schemas. As a module of `platform-core`,
   those GRANTs would land on `svc_platform_core`, turning the auth runtime
   role into a horizontal super-role. With its own role
   `svc_platform_scheduler` and `BYPASSRLS`, the privileges live in one
   migration and don't affect the other modules' isolation.
4. **Pattern consistency**. Four monoliths already follow the
   "domain = container" rule (ADR 004 onwards). Cron-as-a-service is a new
   horizontal domain — the fifth container, not the eleventh module of
   `platform-core`.
5. **Fail-on-deploy aislado**. A bad cron deploy doesn't take down the
   critical path of auth or payments.

## Decisions tomadas

| Decisión | Valor | Razón |
|---|---|---|
| Contenedor | nuevo `platform-scheduler` | Aislamiento single-runner, blast radius |
| Puerto | 3400 | Continúa secuencia 3000/3100/3200/3300 |
| Réplicas | 1 (sin `deploy.replicas`) | exactly-once sin lock distribuido |
| Lock distribuido | No (V1); Redis SET NX EX cuando llegue cluster | Simplicidad |
| HTTP público | No — sin `upstream` ni `location` en NGINX | Solo polea + publica |
| Endpoint admin | Sí (interno) `/health` + `/v1/scheduler/{jobs,runs}` + manual trigger | Debug + console |
| Librería cron | `node-cron@3` (ya en pnpm-lock por yoga-studio) | Sintaxis crontab estándar |
| Locks intra-job | Postgres `pg_try_advisory_lock(hashtext('job-name'))` | Evita solapamientos |
| Idempotencia | Columnas `*_sent_at` y stamp en mismo UPDATE que `RETURNING` | Re-run no duplica eventos |
| Cross-módulos | Solo Redis events (ningún HTTP cross-container) | Patrón ya establecido |
| Auth | `appGuard` + `requireRole('staff')` en endpoints admin | Voragine-console autentica para disparar manualmente |
| Postgres | Misma instancia, schema `platform_scheduler` + rol `svc_platform_scheduler` (`BYPASSRLS`) | Auditoría + cross-schema sin set_config |

## Idempotencia y locks

Cada job hace `UPDATE … SET *_sent_at = now() … WHERE *_sent_at IS NULL …
RETURNING …` para que el siguiente tick no re-emita. Si un job tarda más que
su intervalo, `pg_try_advisory_lock` hace que el siguiente tick salte con
`status='skipped_locked'` en `platform_scheduler.runs`.

## Auditoría

`platform_scheduler.runs` registra cada tick: `started_at`, `finished_at`,
`status` (`running|success|error|skipped_locked`), `rows_affected`, `error`.
Voragine-console puede listar runs y, en futuro, mostrar dashboards.

## Eventos publicados (canal `platform.events`)

- `booking.reminder.due` — payload: `{appId, tenantId, bookingId, serviceId, clientUserId, clientEmail, clientPhone, clientName, startsAt, endsAt, window: 't_minus_24h'|'t_minus_2h'}`
- `reservation.reminder.due` — payload análogo para platform-restaurant
- `package.expiring` — payload: `{appId, tenantId, packageId, clientUserId, serviceId, remainingSessions, totalSessions, expiresAt, window: 't_minus_30d'|'t_minus_7d'}`
- `package.expired` — payload: `{appId, tenantId, packageId, clientUserId, serviceId, remainingSessions, expiresAt}`
- `payout.period_due` — payload: `{appId, tenantId, scheduleId, practitionerId, period, periodStart, periodEnd}`
- `dispute.sla_breached` — payload: `{appId, tenantId, disputeId, orderId, buyerUserId, openedAt, slaHours}`
- `basket.abandoned` — payload: `{appId, tenantId, userId, itemCount, idleSeconds, basketKey}`

## Consequences

- **Producción**: 1 contenedor extra (~80 MB RAM). Sin cambios en
  escalabilidad de `platform-core`/marketplace/restaurant/appointments.
- **Operaciones**: para reiniciar un job basta con `POST /v1/scheduler/jobs/:name/run`
  desde console, o `docker compose restart platform-scheduler` para
  reset total. Si el contenedor cae, los datos no se corrompen — sólo se
  acumulan retrasos en recordatorios.
- **Coste de añadir un nuevo job**: copy-paste de un archivo en
  `src/jobs/`, registro en `src/jobs/index.js`, opcionalmente nueva columna
  `*_sent_at` en el módulo cliente para idempotencia.

## Alcance NO incluido (V1)

- Cluster con réplicas — añadir Redis distributed lock cuando haga falta.
- UI en console para listar `runs` y disparar.
- Cron expressions configurables por tenant — todos los jobs son globales.
- Retries con backoff exponencial — un fallo queda con `status='error'` en
  `runs`; el siguiente tick reintenta en su intervalo.
- Métricas Prometheus — solo logs estructurados pino. Forman parte del
  trabajo transversal de Observability listado en `TODO.md`.
