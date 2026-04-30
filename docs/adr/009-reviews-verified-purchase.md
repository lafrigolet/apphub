# ADR 009 — `reviews` verified-purchase via HTTP loopback to `orders`

## Status

Accepted — 2026-04-29.

## Context

`platform/reviews` accepts an optional `orderId` on review creation but, until
now, did nothing with it. Any caller could claim "I bought this" by posting
any UUID. `TODO.md` priority #7 — "`reviews` verified-purchase HTTP
cross-container".

`reviews` lives inside `platform-marketplace` (port 3100) alongside the module
that actually owns orders (`platform/orders`, schema `platform_orders`,
role `svc_platform_orders`). They share a process today, but **CLAUDE.md rule
13** forbids `platform/reviews` from importing internals of `platform/orders`
or reading another module's schema with its own DB role. The two modules must
communicate through one of: HTTP, Redis events, or `@apphub/platform-sdk`.

We picked HTTP because the verified-purchase check is synchronous (the answer
must be in hand before INSERT) and the payload is a single GET — no
event-sourcing needed.

## Decision

Add an `orders-client.js` lib inside `platform/reviews` that performs an HTTP
GET against `${PLATFORM_MARKETPLACE_URL}/api/orders/:id` using the *same JWT*
the user sent on `POST /v1/reviews`, then persist the boolean result on the
review row.

```
client                  reviews module          orders module           DB
  │                          │                        │                  │
  │  POST /v1/reviews        │                        │                  │
  │ ──────────────────────►  │                        │                  │
  │  (JWT, orderId=O1)       │                        │                  │
  │                          │  GET /v1/orders/O1     │                  │
  │                          │  Authorization: <JWT>  │                  │
  │                          │ ─────────────────────► │                  │
  │                          │                        │  SELECT … WHERE  │
  │                          │                        │ ───────────────► │
  │                          │                        │                  │
  │                          │  { buyer_user_id, status }                │
  │                          │ ◄───────────────────── │                  │
  │                          │                                           │
  │                          │  INSERT review (verified_purchase=true)   │
  │                          │ ─────────────────────────────────────────►│
  │                          │                                           │
  │  201 review              │                                           │
  │ ◄────────────────────── │                                            │
```

### Persistence

`platform_reviews.reviews.verified_purchase BOOLEAN NOT NULL DEFAULT FALSE`,
plus a partial index for the common "show me only verified reviews of this
product" query:

```sql
CREATE INDEX idx_reviews_target_verified
  ON platform_reviews.reviews (app_id, tenant_id, target_type, target_id)
  WHERE verified_purchase = TRUE AND status = 'published';
```

### Tenant isolation

`/api/orders/:id` is itself protected by RLS scoped on `(app_id, tenant_id)`
of the JWT. The reviews module never has to forge cross-tenant access —
forwarding the user's own JWT means orders only returns rows the user is
allowed to see anyway. Cross-tenant orderId injection therefore returns 404
just like any other access denial.

### Soft-fail

If orders is down, slow (`AbortSignal.timeout(2000)`), or returns 5xx, we log
and proceed with `verified_purchase=false`. A user-visible action must never
be blocked by an internal-network hiccup. Worst case the badge is missing on
that one review until the user resubmits.

A review created with `verified_purchase=false` is **not** retried — the user
can edit/recreate the review and a fresh check runs. We don't background-poll
because the JWT has expired by then.

### Reads

- `GET /v1/reviews?verifiedOnly=true` — partial-index-backed filter.
- `GET /v1/reviews/aggregate` returns `verifiedCount` alongside `count` and
  the rating histogram, so a UI can show "4.8 ★ — 312 reviews (288 verified)".

## Alternatives considered

1. **Redis event `order.paid`** consumed by reviews to keep a local mirror of
   `(user_id, order_id, paid_at)` rows. Lower latency reads, but burdens
   reviews with another table, RLS, eventual consistency, and reconciliation
   cron. Overkill for a single-shot synchronous check on review creation.

2. **Direct cross-schema SELECT** from reviews using a special "marketplace
   read-only" DB role. Forbidden by CLAUDE.md rule 13 — destroys the
   ready-to-split property of the monolith.

3. **Stripe webhook** as the source of truth (`payment_intent.succeeded`) →
   stamp `verified_purchase` later. Doesn't help: we need the verdict at INSERT
   time so the user sees the badge immediately.

4. **In-process function call** — fast, but breaks the module boundary and
   would have to be rewritten the moment marketplace splits from core.

## Consequences

### Good

- Module boundary preserved — `platform/reviews` and `platform/orders` could
  be split into separate containers tomorrow with zero code change (only
  `PLATFORM_MARKETPLACE_URL` would shift from `localhost:3100` to a real DNS
  name).
- Tenant isolation is enforced *by orders* — reviews can't accidentally leak
  cross-tenant data even if the JWT layer were bypassed.
- The badge is set at write-time, so reads are O(1) — no fan-out join.

### Bad

- One extra HTTP hop on every `POST /v1/reviews`. With orderless reviews this
  is skipped; with an orderId it adds one localhost round-trip (~5 ms in
  benchmarks). Acceptable for a non-hot-path operation.
- Soft-fail means a transient orders outage produces some `verified_purchase=false`
  rows that *should* have been true. Resubmission re-checks; no automated
  reconciliation job is provided in V1 (added to `TODO.md` if the failure
  rate proves non-trivial).

## Implementation

- `platform/reviews/migrations/0002_verified_purchase.sql` — column + partial index.
- `platform/reviews/src/lib/orders-client.js` — `fetchOrder` with 2 s timeout
  + `isVerifiedPurchase(orderId, expectedBuyerUserId, jwt)`.
- `platform/reviews/src/lib/env.js` — `PLATFORM_MARKETPLACE_URL` (default
  `http://localhost:3100`).
- `platform/reviews/src/services/reviews.service.js` — `createReview` calls
  `isVerifiedPurchase` before opening the tenant transaction.
- `platform/reviews/src/repositories/reviews.repository.js` — `insert` accepts
  `verifiedPurchase`; `listByTarget` accepts `verifiedOnly`; `aggregate`
  returns `verified_count`.
- `platform/reviews/src/routes/reviews.routes.js` — `listQuery` accepts
  `verifiedOnly`; `ctxFromRequest` forwards the raw JWT.

Tests: 17 unit tests for `orders-client.js`, 18 service tests, 21 integration
tests (6 new for verified-purchase). All green.

## Production notes

- Status set considered "purchased": `paid`, `fulfilled`, `shipped`,
  `delivered`, `completed`. `pending`, `cancelled`, `refunded` → `verified=false`.
- The JWT is forwarded as-is; we never mint a service token for this path.
  This means a user who can read the order can also vouch for the review —
  the right user model.
- When marketplace splits, `PLATFORM_MARKETPLACE_URL` becomes the public
  upstream of the orders service. NGINX already routes `/api/orders/` to the
  marketplace upstream so no routing change is needed.
