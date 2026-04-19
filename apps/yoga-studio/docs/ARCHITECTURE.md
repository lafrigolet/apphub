# Architecture · Yoga Studio App

> Part of the AppHub multi-app platform

---

## Overview

Yoga Studio is one of the apps hosted on AppHub. It lives under `apps/yoga-studio/` in
the monorepo. The app gets its own subdomain (`yoga.apphub.com` / `yoga.apphub.local`)
and its own set of domain-specific microservices. Cross-cutting concerns (auth, payments,
notifications, catalog, basket) are handled by the shared `platform/` services.

```
yoga.apphub.local:8080
       │
       ├── /api/auth/…          → platform/auth          :3000  ← login, register, JWT
       ├── /api/payments/…      → platform/payments       :3001  ← checkout, webhooks
       ├── /api/notifications/… → platform/notifications  :3002  ← broadcast, email
       ├── /api/catalog/…       → platform/catalog        :3003
       ├── /api/basket/…        → platform/basket         :3004
       ├── /api/tenants/…       → platform/tenant-config  :3005
       │
       ├── /api/app/users/…     → yoga-users              :3011
       ├── /api/app/classes/…   → yoga-classes            :3012
       ├── /api/app/bookings/…  → yoga-bookings           :3013
       ├── /api/app/bonuses/…   → yoga-bonuses            :3014
       ├── /api/app/reports/…   → yoga-reporting          :3017
       │
       └── /                    → yoga-portal             :5174
```

---

## App-specific services

All yoga services are Fastify/JavaScript (ESM) microservices. They share:

- `@apphub/platform-sdk` — `appGuard`, `setTenantContext`, `publish`, `createLogger`
- `EXPECTED_APP_ID=yoga-studio` — the guard rejects tokens issued for other apps
- Redis Pub/Sub event bus on channel `yoga-studio.events`

| Service | Port | Schema | Responsibility |
|---|---|---|---|
| yoga-users | 3011 | `yoga_users` | User profiles, preferences, class history |
| yoga-classes | 3012 | `yoga_classes` | Class catalogue, schedules, rooms |
| yoga-bookings | 3013 | `yoga_bookings` | Reservations, cancellations, waiting list |
| yoga-bonuses | 3014 | `yoga_bonuses` | Credit bundles, activation, deduction |
| yoga-reporting | 3017 | `yoga_reporting` | Attendance metrics, ratings, exports |

Auth, payments, and notifications are handled by the shared platform services (ports 3000–3002).

---

## Identity

Yoga users authenticate via `platform/auth` with `app_id: "yoga-studio"` in the login
body. The issued JWT contains:

```json
{
  "sub": "user-uuid",
  "app_id": "yoga-studio",
  "tenant_id": "tenant-uuid",
  "sub_tenant_id": "location-uuid-or-null",
  "role": "alumno",
  "email": "user@yoga.es"
}
```

The `sub_tenant_id` is used when a tenant (franchise group) has multiple locations.
A booking at location A is invisible to a user authenticated for location B.

---

## Event bus

Services communicate asynchronously via Redis Pub/Sub. The channel is `yoga-studio.events`.

| Event | Producer | Consumers |
|---|---|---|
| `booking.created` | yoga-bookings | yoga-notifications*, yoga-reporting, yoga-bonuses |
| `booking.cancelled` | yoga-bookings | yoga-notifications*, yoga-reporting, yoga-bonuses |
| `booking.attended` | yoga-bookings | yoga-reporting |
| `no-show.detected` | yoga-bookings | yoga-bonuses, yoga-reporting |
| `bonus.expiring-soon` | yoga-bonuses | yoga-notifications* |
| `payment.completed` | platform/payments | yoga-bonuses |

\* notification delivery is handled by `platform/notifications` — yoga services publish
the event, the platform service sends the email/push.

---

## Database isolation

Each service owns exactly one PostgreSQL schema. Cross-schema queries are never allowed.

```
yoga_users.*      — only yoga-users reads/writes this
yoga_classes.*    — only yoga-classes reads/writes this
yoga_bookings.*   — only yoga-bookings reads/writes this
yoga_bonuses.*    — only yoga-bonuses reads/writes this
yoga_reporting.*  — only yoga-reporting reads/writes this
```

RLS policies enforce `app_id = 'yoga-studio'` AND `tenant_id` AND optionally
`sub_tenant_id` on every table.

---

## Service directory structure

```
apps/yoga-studio/{service}/
├── src/
│   ├── routes/          # Fastify route handlers
│   ├── services/        # Business logic
│   ├── repositories/    # SQL queries
│   ├── lib/             # db.js, env.js, logger.js, redis.js
│   ├── plugins/         # app-guard registration
│   ├── __tests__/       # Vitest test files
│   └── app.js           # Fastify app factory
├── migrations/          # SQL migration files (immutable)
├── Dockerfile
└── package.json
```

---

## Local development

```bash
# Start everything
docker compose up -d

# Hit the yoga portal
open http://yoga.apphub.local:8080

# Run all yoga tests (238 tests across 5 services)
pnpm --filter "@yoga-studio/*" test
```

Requires `/etc/hosts` entry: `127.0.0.1 yoga.apphub.local`
