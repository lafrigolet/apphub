# ADR 005 — `platform-restaurant`: third monolith container for restaurant operations

## Status

Accepted — 2026-04-29.

## Context

`platform-core` covers horizontal infrastructure (auth / payments / notifications /
tenant-config / splitpay). `platform-marketplace` covers transactional commerce
(orders / inventory / reviews / messaging / shipping / disputes / catalog / basket).

Restaurant apps need **operational F&B primitives** that don't fit either domain:

- **Menu** with modifiers ("punto de la carne"), allergens, availability windows
  (desayunos 08-12 vs cena 20-24), course types, and an **86-list** (out-of-stock today,
  not a stock decrement). `catalog` models a product with a price — a restaurant menu
  is a different beast.
- **Reservations** with waitlist, no-show policy, guarantee deposits, service hours.
- **Floor plan** — rooms, tables, real-time table state, table-combine for groups.
- **Kitchen Display System** — tickets routed to stations, coursing, bump-bar workflow.
- **POS** — open ticket per table, add items during the meal, split bill, tips, cash/card
  mixed payments. Different from `orders/checkout` which assumes a one-shot transaction.
- **Delivery dispatch** — riders, zones, GPS ping, integration with external fleets
  (Glovo/Uber Eats/Just Eat/Deliveroo) on top of generic `shipping`.

## Decision

Create a **third domain-separated monolith container `platform-restaurant`** (port 3200)
hosting the 6 modules above. Same pattern as ADR 004:

- Per-module Postgres schema + dedicated DB role.
- One Pool per module, configured at orchestrator boot via `configurePool(db)`.
- Single Redis client shared across modules; events published to `platform.events`
  channel so they cross to `platform-core` and `platform-marketplace` transparently.
- Shared `PLATFORM_JWT_SECRET` so JWTs from `auth` are accepted without round-trip.
- Each module exports `register({app, db, redis, logger})` + `runMigrations(superuserUrl)`.
- NGINX routes `/api/{menu,reservations,floor-plan,kds,pos,delivery-dispatch}/*` to a
  single `platform_restaurant` upstream.

## Why a separate container instead of folding into `platform-core` or `platform-marketplace`

- **Domain coherence** — F&B operations are conceptually distinct from horizontal
  infra (`platform-core`) and from generic e-commerce (`platform-marketplace`).
- **Blast radius** — a bug or memory leak in `kds` (under heavy lunch-rush load) must
  not take down `auth`.
- **Independent scaling** — kitchen displays and POS terminals have a very different
  traffic profile from the auth service or from a marketplace storefront.
- **Ready-to-split per module** — if `kds` or `pos` outgrows the monolith, splitting
  it into its own container is a 4-step operation (own `server.js`, own Dockerfile,
  new compose service, repoint NGINX). Zero changes to business logic.

## Cross-container event flow examples

- `order.paid` (from `platform-marketplace/orders` or `pos.bill.paid` from
  `platform-restaurant/pos`) →
  - `kds` fires kitchen tickets per (course, station)
  - `delivery-dispatch` creates a pending delivery if `fulfillmentMethod = 'delivery'`
  - `inventory` (in marketplace) commits stock
- `kds.ticket.picked_up` → potentially advances `delivery.dispatched`.
- `reservation.created` → `notifications` (in core) sends a confirmation email.
- `reservation.confirmed` → `floor-plan` may pre-mark a table as `reserved`.

## Alternatives considered

1. **Add the 6 modules to `platform-marketplace`** — rejected. The marketplace monolith
   would balloon to 14 modules and merge two semantically different domains.
2. **One container per module (6 new containers)** — rejected. Operational overhead
   is disproportionate for the early stage; the modules will mostly co-deploy together
   in any restaurant tenant.
3. **A single `apps/restaurant-template/` app stack** — rejected. These are reusable
   horizontal capabilities for any restaurant app (single brand, multi-brand, dark
   kitchens). They belong on the platform side.

## Consequences

- Three monolith containers to operate. Each can be scaled, restarted and rolled out
  independently. The Postgres + Redis instances are still shared.
- `platform-core` and `platform-marketplace` are unchanged.
- Restaurant apps consume `/api/menu/*`, `/api/reservations/*`, `/api/floor-plan/*`,
  `/api/kds/*`, `/api/pos/*`, `/api/delivery-dispatch/*` from any subdomain
  (via NGINX `platform-routes.conf`).
- The "ready to split" property is preserved per-module: any of the 6 can be extracted
  to its own container without business-logic changes.
