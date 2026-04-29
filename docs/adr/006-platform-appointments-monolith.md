# ADR 006 — `platform-appointments`: fourth monolith for scheduling workloads

## Status

Accepted — 2026-04-29.

## Context

`platform-core` (auth/notifications/payments/tenant-config/splitpay), `platform-marketplace`
(orders/inventory/reviews/messaging/shipping/disputes/catalog/basket) and
`platform-restaurant` (menu/reservations/floor-plan/kds/pos/delivery-dispatch) cover
horizontal infra, e-commerce transactions and F&B operations respectively.

Appointment/scheduling apps — clinics, dental practices, hair salons, physiotherapists,
lawyers, mechanics, coaches, spas, etc. — share a different operational core that none
of those three monoliths model adequately:

- **Bookable service catalog** — duration, pre/post buffers, modality (in-person /
  telehealth / at-home / hybrid), cancellation policy, age restrictions. Different
  from `platform-marketplace/catalog` (a product-with-price model).
- **Resources** — practitioners (people), rooms, equipment, vehicles, each with
  weekly work hours, ad-hoc exceptions, and an N:M map to the services they can
  deliver. `platform-restaurant/floor-plan` models tables but not practitioners or
  the work-hour calendar.
- **Bookings** — distinct from `platform-marketplace/orders` (transactional
  ledger) and `platform-restaurant/reservations` (table reservations). An
  appointment is service × resource(s) × client × time slot, with its own FSM
  (requested→confirmed→reminded→checked_in→in_progress→completed) and recurrence.
- **Availability engine** — slot computation across work hours, exceptions,
  existing bookings, in-flight holds and buffers. Atomic concurrency control to
  prevent double booking under load.
- **Intake forms** — pre-appointment questionnaires, consent for medical/legal,
  signatures, attachments.
- **Telehealth** — video rooms, tokens with TTL, recording flags.
- **Packages** — prepaid bundles ("10 sesiones por 400€") with balance tracking,
  validity expiry, redemption on completion, refund on cancel/no-show.
- **Practitioner payouts** — commission per (practitioner, service), accrual at
  completion, reversal at cancellation, periodic close.

## Decision

Create `platform-appointments` (port 3300) as a fourth domain-separated monolith with
the same pattern as ADR 004 / ADR 005:

- Per-module Postgres schema + dedicated DB role.
- One Pool per module via `configurePool(db)` at orchestrator boot.
- Single Redis client; events to `platform.events` (cross-container fan-out).
- Shared `PLATFORM_JWT_SECRET` so tokens from `auth` are accepted with no round-trip.
- Module contract: `register({ app, db, redis, logger })` + `runMigrations(superuserUrl)`.
- NGINX routes
  `/api/{services,resources,bookings,availability,intake-forms,telehealth,packages,practitioner-payouts}/`
  → `platform_appointments`.

## Module collision avoidance

The orchestrator directory is `platform/appointments/`. The appointment-FSM module is
named `bookings/` rather than `appointments/` to avoid colliding with the orchestrator
directory and to keep the URL `/api/bookings/*` short and intuitive (Yoga Studio's
existing `/api/app/bookings/*` is a per-app route on a different subdomain — no clash).

## Why a separate container instead of folding into existing monoliths

- **Domain coherence** — scheduling is conceptually distinct from horizontal infra,
  e-commerce, or F&B. Mixing makes either the existing monoliths or the appointments
  domain harder to reason about.
- **Different traffic profile** — booking surges (lunch-hour clinic check-ins,
  pre-Christmas hair-salon rush) shouldn't compete for resources with marketplace
  checkouts or auth.
- **Compliance pressure (sanidad)** — even though clinical records sit in a future
  separate `platform-clinical`, intake forms here may carry health data; a separate
  container shrinks the audit perimeter when GDPR/HIPAA work begins.
- **Ready-to-split per module** — any of the 8 can be extracted to its own container
  with the standard 4-step procedure if scaling demands it.

## Cross-container event flow examples

- `splitpay.payment.completed` (from platform-core/splitpay) → may be tied to a
  package purchase → `package.purchased`.
- `booking.confirmed` →
  - `intake-forms` checks if the service requires a form, creates a pending
    `submission`, publishes `intake.requested` (consumed by
    `platform-core/notifications` to email the form link).
  - `telehealth` checks if the service modality is `telehealth`/`hybrid`, provisions
    a stub room, publishes `telehealth.room.created`.
- `booking.completed` →
  - `packages` decrements remaining sessions, publishes `package.exhausted` if zero.
  - `practitioner-payouts` accrues commission for each practitioner attached to the
    booking, splitting price evenly with rounding remainder on the first share.
- `booking.cancelled` / `booking.no_show` →
  - `packages` refunds the session.
  - `practitioner-payouts` reverses any matching accrual.

## Consequences

- Four monolith containers to operate; each independently scaled / restarted /
  deployed. Postgres + Redis remain shared.
- Existing apps (`yoga-studio`, `aikikan`, `splitpay`) are unchanged.
- A new restaurant or clinic app can compose:
  `platform-core` (auth, payments, notifications) +
  `platform-appointments` (catalog, schedule, FSM, payouts) +
  any app-specific UI on its own subdomain.
- Module list deliberately covers a wide spectrum of business types — not all apps
  will use all 8. Apps that don't need `telehealth` simply ignore those routes;
  apps that don't sell prepaid bundles ignore `packages`. The cost of unused
  modules is one schema each (empty) and zero runtime requests.
