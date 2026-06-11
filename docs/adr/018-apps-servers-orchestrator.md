# ADR 018 — `apps-servers`: single orchestrator for all app-specific servers

## Status

Accepted — 2026-06-06. Refines the deployment model of ADR 013 (the app
architecture — one schema `app_<app>`, one role `svc_app_<app>`, row-level
tenancy — is unchanged).

## Context

Each app-specific server (aikikan-server :3030, aulavera-server :3031) ran
as its own container: one Node process, image, compose service ×2, CI entry
and healthcheck per app. Following the consolidation of frontends (ADR 017)
and tpv (ADR 016), the same operational-economy argument applies — and the
platform already had the right tool: the module contract
(`register({ app, db, redis, logger })` + `runMigrations`) used by every
platform monolith.

The one real obstacle was security: the SDK's `appGuard` is a
`fastify-plugin` (hooks apply process-wide) that validates a single
`EXPECTED_APP_ID` per process. Hosting two apps behind one guard would
either reject one app's tokens or — with `EXPECTED_APP_ID=platform` —
accept ANY app's token on every route, violating CLAUDE.md rule 2 (an
aikikan token must never read aulavera data).

## Decision

**From now on, every app-specific server ships as a module of the
`apps-servers` container** (`apps/apps-servers/`, port 3030):

- One Fastify process; cross-cutting plugins (helmet/cors/rate-limit/
  sensible) registered once; one Pool per app bound to its `svc_app_<app>`
  role; shared Redis client (pub/sub subscribers keep their own
  connections).
- Each app-server exports the standard module contract from
  `src/index.js`. Its routes stay fully prefixed (`/v1/<app>/*`), so the
  gateway seed blocks don't change — both upstreams now point at
  `apps-servers:3030`.
- **Per-scope guard**: the SDK gains `makeAppGuardHook(expectedAppId)`
  (the extracted core of `appGuard`) and `ensureIdentityDecorator`. Each
  module wraps its routes in an encapsulated Fastify scope with
  `scope.addHook('preHandler', makeAppGuardHook('<app>'))` — a token from
  another app gets `403 APP_MISMATCH` (verified e2e). The global `appGuard`
  is NOT registered in this orchestrator.
- App constants (`APP_ID` in services/event handlers) are now literals
  instead of `env.EXPECTED_APP_ID` — container env is shared across
  modules, so per-app values cannot live in process env.
- Redis event subscribers move from each app's `server.js` into its
  `register()` (closed via `onClose`), with a `subscribe: false` escape
  hatch for integration tests.
- Each app keeps `src/server.js` + `src/app.js` (standalone factory) +
  `Dockerfile` as **ready-to-split artifacts** (same criterion as ADR 016):
  re-extracting an app to its own container is the standard 4-step split.

## Consequences

- Containers: N app-servers → 1. `deploy/services.json`: one `apps-servers`
  entry (image `apphub-apps-servers`) whose paths cover every hosted app.
- Coarser deploy/restart granularity for app backends (one process). RAM
  drops (one Node runtime instead of N).
- The orchestrator deliberately does NOT set `EXPECTED_APP_ID`; each app's
  `env.js` keeps its own default for standalone mode.
- New apps: add the workspace dep + a `moduleDescriptor` line in
  `apps/apps-servers/src/server.js`, `DATABASE_URL_<APP>` in env/compose,
  COPYs in the apps-servers Dockerfile, and the app's path glob in
  `deploy/services.json`. No new container, no new upstream port.
- `aikikan-server`/`aulavera-server` containers are removed; the deploy's
  `--remove-orphans` cleans them on the next prod deploy.

## Alternatives considered

- **Multi-process container** (the portals/ADR 017 pattern; PM2 precedent
  from Yoga Studio) — zero refactor, but keeps N runtimes and leaves the
  per-app guard problem unsolved only because processes stay isolated.
  Rejected by the user in favour of the architecturally consistent option.
- **Keep one container per app** — correct at independent-scaling scale;
  pure overhead on a single box.
