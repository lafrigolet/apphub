# ADR 016 — `tpv` folded into `platform-core` (supersedes the container decision of ADR 015)

## Status

Accepted — 2026-06-06. Supersedes the *deployment* decision of
[ADR 015](015-platform-tpv-monolith.md); everything else in ADR 015 (module
design, schema, events, REUSE of `platform/pos`, Veri*Factu feed) stands.

## Context

ADR 015 shipped `platform/tpv` as a fifth domain monolith (`platform-tpv`,
port 3500) hosting a single module. After the V1 landed, operating a whole
container for one module was judged not worth the cost at current scale:

- One more Node process, image build, healthcheck, log stream and deploy
  unit on a single Hetzner box — for a till that serves front-desk traffic
  (orders of magnitude below marketplace/restaurant peaks).
- The projected sibling modules for the container (customer display,
  hardware bridge, loyalty) don't exist yet; the "room to grow" argument
  was speculative — exactly the *pre-extracting* anti-pattern CLAUDE.md
  warns about, applied at the container level.

The module contract (`register({ app, db, redis, logger })` +
`runMigrations`) makes relocation a pure wiring change: zero business-logic
edits.

## Decision

Host the `tpv` module inside **`platform-core`** (12th module), keeping
everything that makes it independent:

- Same schema `platform_tpv`, same dedicated role `svc_platform_tpv`, own
  Pool (`DATABASE_URL_TPV`), own migrations — nothing about data isolation
  changes.
- NGINX `/api/tpv/` now proxies to the `platform_core` upstream; the
  `platform_tpv` upstream and the compose service are removed; port 3500
  is freed.
- Events are unchanged (`platform.events` via Redis): pos → tpv → verifactu
  works identically whether the consumers share a process or not. The
  scheduler job `tpv-session-autoclose` and its grants are untouched.
- `platform/tpv` **keeps its `src/server.js` and `Dockerfile`** as
  ready-to-split artifacts: re-extracting it to its own container is the
  standard 4-step split with step zero already done.

## New optional module hook: `enforceGrants(superuserUrl)`

Folding tpv into core surfaced a real conflict: core's boot runs
`ensureModuleRole`, which reconciles each module role with a uniform
`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES` — silently undoing
tpv's immutability REVOKEs (receipts/receipt_lines/cash_movements/
cash_counts/z_reports/credit_notes only allow column-scoped UPDATEs).
The module contract gains an **optional** third export:

```js
export async function enforceGrants(superuserUrl) { /* re-apply stricter grants */ }
```

The orchestrator calls it AFTER `ensureModuleRole` (order matters). Modules
without a stricter grant policy simply don't export it. tpv's implementation
lives in `platform/tpv/src/lib/grants.js` and is idempotent per boot.

## Consequences

- Back to four domain monoliths + scheduler; one less container to operate.
- platform-core's deploy unit now includes tpv (added to
  `deploy/services.json` paths — which were also backfilled with the
  missing leads/donations/inquiries/verifactu/chat globs).
- The "horizontal infrastructure" framing of platform-core loosens: tpv is
  a business domain hosted there for operational economy, not because it is
  infra. If till traffic or the retail-domain module family materialises,
  split it back out (ADR 015's container design remains the blueprint).
- Registry, topology and ports updated in CLAUDE.md / ARCHITECTURE.md /
  DEVELOPMENT.md.

## Alternatives considered

- **Keep the dedicated container** — correct at scale, premature today;
  rejected for operational cost.
- **Fold into platform-restaurant next to pos** — rejected again for the
  same reason as in ADR 015: tpv is deliberately app-generic and must not
  signal F&B coupling.
