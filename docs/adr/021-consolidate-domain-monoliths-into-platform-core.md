# ADR 021 — Consolidate the domain monoliths into platform-core

## Status

Accepted — 2026-06-13. Supersedes the **deployment** decision of
[ADR 004](004-domain-separated-monolith-containers.md). Everything else in
ADR 004 (per-domain *module* grouping, schema-per-module, dedicated DB roles,
Redis-event cross-domain comms) stands — only the container packaging changes.

## Context

ADR 004 shipped three domain monoliths as separate containers:
`platform-marketplace` (3100), `platform-restaurant` (3200),
`platform-appointments` (3300), alongside `platform-core` (3000) and
`platform-scheduler` (3400). At current scale operating one container per
domain is not worth the cost:

- Three extra Node processes, image builds, healthchecks, log streams and
  deploy units on a single Hetzner box, for traffic far below any level that
  would need independent scaling.
- The three orchestrators were architecturally identical to `platform-core`'s
  boot (same plugins, same module contract) — no domain-specific middleware,
  no extra listeners, no cron. Pure duplication.
- Cross-domain communication already rides Redis events on `platform.events`;
  there were no load-bearing cross-container HTTP calls (the lone
  `reviews → orders` verify call soft-fails and is now an in-process loopback).

The modular-monolith contract (`register({app,db,redis,logger})` +
`runMigrations`) makes relocating a module a pure wiring change: zero
business-logic edits.

## Decision

Host the **22 modules** of marketplace + restaurant + appointments directly
inside **`platform-core`** (now ~35 modules total), and delete the three
orchestrator containers. `platform-scheduler` stays separate (single-runner
cron, exactly-once guarantee).

What this keeps intact:

- Each module keeps its own schema + dedicated DB role + one `Pool` (CLAUDE.md
  #11). `platform-core`'s boot loop reconciles roles via `ensureModuleRole`.
- NGINX route prefixes are unchanged; the `/api/<module>/` routes simply proxy
  to `platform_core` now (the `platform_marketplace|restaurant|appointments`
  upstreams were removed, same as `platform_tpv` in ADR 016).
- The per-module `platform/<module>/` directories are untouched and remain
  individually ready-to-split (the contract is the same); only the three
  domain *orchestrator* dirs were deleted.

## Consequences

- One fewer concern at deploy time: 2 platform monoliths (`platform-core` +
  `platform-scheduler`) instead of 5. `deploy/services.json`, both compose
  files, and the NGINX upstreams shrink accordingly.
- `platform-core` boots slower and uses more memory: it now runs ~34 module
  migrations and opens ~34 Pools sequentially at startup. Accepted — that is
  the point of the consolidation at this scale.
- Process-level isolation between domains is gone; real isolation remains at
  the **schema + DB role + RLS** layer (unchanged).
- **Reversible:** re-splitting a domain back out is the same 4-step wiring ADR
  004 described — add a `server.js`+`Dockerfile`, a compose service, an NGINX
  upstream, and repoint the routes. No business logic moves.

## Alternatives considered

- **Keep ADR 004 as-is** — rejected: the per-container cost is real today and
  the independent-scaling benefit is hypothetical.
- **Collapse the scheduler too** — rejected: the scheduler needs `replicas: 1`
  + advisory locks for exactly-once cron; folding it into the multi-replica
  web process would break that guarantee.
