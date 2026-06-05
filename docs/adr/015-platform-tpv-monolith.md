# ADR 015 — `platform-tpv`: fifth monolith for point-of-sale operations

## Status

Accepted — 2026-06-05.

## Context

Several apps need to operate as a physical point of sale (TPV): charging in person
for dojo fees and merchandising (aikikan), courses and materials (aulavera), and any
future retail vertical. An inventory of the existing platform showed:

- `platform/pos` (platform-restaurant) already implements the **bill engine** —
  bills, line items, mixed payments (card/cash/wallet/voucher/external), splits,
  tips — and is only weakly coupled to the restaurant domain (`table_id`/`table_code`
  are optional with no FK; items reference catalog by textual SKU; the only F&B
  artefact is the `fire`-to-KDS flow, which generic consumers simply ignore).
- `platform/payments`, `platform/catalog`, `platform/inventory`, `platform/splitpay`
  and `platform/notifications` cover card charging/refunds, product catalog, stock,
  split charging and receipt email respectively.
- **Nothing** covers the operational and fiscal layer of a till: terminal devices,
  cash sessions/shifts, cash movements, blind counts (arqueo), sequential receipt
  numbering with immutable snapshots, full invoices, credit notes, X/Z reports, and
  the Veri*Factu registration mandatory in Spain since 2026.

Those gaps were catalogued in [docs/use-cases/tpv.md](../use-cases/tpv.md). Per the
"Adding new functionality" decision tree, the user chose: **new platform module
`platform/tpv`**, generic (no single consuming app), full V1 scope including the
Veri*Factu integration.

## Decision

Create `platform-tpv` (port 3500) as a fifth domain-separated monolith following the
ADR 004 pattern, initially hosting a single module `platform/tpv`:

- Schema `platform_tpv`, role `svc_platform_tpv`, own Pool, own migrations.
- Module contract: `register({ app, db, redis, logger })` + `runMigrations(superuserUrl)`.
- NGINX route `/api/tpv/` → upstream `platform_tpv`.
- Scheduler job `tpv-session-autoclose` in `platform-scheduler` (force-close stale
  cash sessions).
- Entities: `tpv_devices`, `cash_sessions`, `cash_counts`, `cash_movements`,
  `number_series`, `receipts`, `receipt_lines`, `credit_notes`, `z_reports`,
  `config` — all with `(app_id, tenant_id, sub_tenant_id)` + RLS.

`platform/tpv` **reuses, never duplicates**: the bill/payment engine stays in
`platform/pos`; tpv consumes `pos.bill.paid` / `pos.bill.cancelled` events and the
TPV frontend talks to `/api/pos/*` directly for opening/charging bills. Card
charging and refunds go through `platform/payments`; stock through
`platform/inventory`; fiscal registration through `platform/verifactu` via the
events `tpv.receipt.issued` / `tpv.receipt.voided`.

## Why a separate container instead of folding into existing monoliths

- **Not platform-core** — established feedback: new domains are added as parallel
  monolith containers, not as modules of platform-core; tpv is a business domain
  (till operations), not horizontal infrastructure.
- **Not platform-restaurant** — tpv is deliberately generic (any app can run a
  till); placing it next to menu/kds/floor-plan would signal F&B coupling that the
  module explicitly avoids, and restaurant traffic patterns (service-hour spikes)
  shouldn't gate a dojo's quiet front desk.
- **Not platform-marketplace** — e-commerce checkout and physical till share
  concepts but not flows: cash handling, shift closing and sequential fiscal
  numbering have no marketplace counterpart.
- **Room to grow** — the retail-presence domain has natural future modules
  (customer-facing display, hardware bridge for ESC/POS printing and cash-drawer
  kick-out, loyalty at till) that would join this container.

## Cross-container event flow

- `pos.bill.paid` (platform-restaurant) → tpv attributes `cash` payments to the
  device's open session and issues a receipt (`tpv.receipt.issued`).
- `tpv.receipt.issued` → `platform/verifactu` appends the chained billing record
  (huella) and returns/exposes the QR; `platform/notifications` emails the receipt
  when requested.
- `tpv.receipt.voided` (credit note) → `platform/verifactu` records the
  annulment/rectification; `platform/inventory` restocks by SKU.
- `tpv.session.force_closed` ← `platform-scheduler` job `tpv-session-autoclose`.

## Veri*Factu dependency

`platform/verifactu` is a skeleton (hash chain / signature / SOAP / QR stubbed
pending AEAT specs). The integration is therefore event-driven from day one: tpv
emits `tpv.receipt.issued` / `tpv.receipt.voided` with the full fiscal payload and
does not block on verifactu's response. The till operates now; the fiscal module
completes in parallel. Spanish go-live requires closing that work.

## Consequences

- Five monolith containers (+ scheduler) to operate; Postgres + Redis remain shared.
- Port 3500 assigned; `/api/tpv/` namespace reserved.
- `platform/pos` keeps its scope: bill engine. Its use-case catalog sections on cash
  drawer (§9), fiscal documents (§11), refunds (§13) and X/Z reports (§16) are now
  owned by `platform/tpv` — noted in [docs/use-cases/pos.md](../use-cases/pos.md).
- Receipt snapshots are immutable and numbered without gaps (Postgres sequence rows
  under `FOR UPDATE`, never Redis) — this is the foundation the fiscal layer builds
  on and must not be relaxed.
- Offline mode (local queue, pre-reserved number ranges per device) is explicitly
  deferred to V2.

## Alternatives considered

- **Extend `platform/pos`** — cheapest path and the bill engine is already generic,
  but it would weld till/fiscal operations into the restaurant container and grow
  pos beyond a single coherent responsibility. Rejected by the user in favour of a
  clean orchestration module.
- **App-local first (ADR 013 style)** — viable if only one app needed a till, but
  the stated intent is a generic capability for all apps; extraction later would
  move fiscal numbering state, which is the worst kind of data to migrate.
