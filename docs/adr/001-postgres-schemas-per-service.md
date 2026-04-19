# ADR 001 — PostgreSQL schemas instead of separate databases per service

**Date**: 2025-04  
**Status**: Accepted

## Context

Each microservice needs data isolation. The options considered were:

1. One PostgreSQL instance per service (full isolation, maximum operational cost)
2. One database per service within a shared PostgreSQL instance
3. One schema per service within a shared database (chosen)

## Decision

Use a single PostgreSQL instance with one schema per microservice.

Each service connects with a dedicated PostgreSQL role that only has `USAGE` on its
own schema and no access to other schemas. Row-level security enforces identity isolation
(app_id + tenant_id + sub_tenant_id) within each schema.

### Schema naming convention

- Platform services use the prefix `platform_`: `platform_auth`, `platform_payments`,
  `platform_notifications`, `platform_catalog`, `platform_tenants`
- App-specific services use the app prefix: `yoga_classes`, `yoga_bookings`, `splitpay_core`

### Current schema inventory

| Schema | Service | Owner role |
|---|---|---|
| `platform_auth` | `platform/auth` | `svc_platform_auth` |
| `platform_payments` | `platform/payments` | `svc_platform_payments` |
| `platform_notifications` | `platform/notifications` | `svc_platform_notifications` |
| `platform_catalog` | `platform/catalog` | `svc_platform_catalog` |
| `platform_tenants` | `platform/tenant-config` | `svc_platform_tenants` |
| `yoga_users` | `yoga-studio/yoga-users` | `svc_yoga_users` |
| `yoga_classes` | `yoga-studio/yoga-classes` | `svc_yoga_classes` |
| `yoga_bookings` | `yoga-studio/yoga-bookings` | `svc_yoga_bookings` |
| `yoga_bonuses` | `yoga-studio/yoga-bonuses` | `svc_yoga_bonuses` |
| `yoga_reporting` | `yoga-studio/yoga-reporting` | `svc_yoga_reporting` |
| `splitpay_core` | `split-pay/splitpay-core` | `svc_splitpay_core` |

## Consequences

**Positive:**
- Single backup and restore operation covers all services
- Single connection pool to manage and monitor
- Migrating a hot schema to its own instance later requires only a connection string change
- Transactional DDL means migrations are safe across a single DB
- Cheaper infrastructure at early stage

**Negative:**
- A runaway query in one service can consume shared PostgreSQL resources
- A schema migration that locks a table affects the whole DB server's connection pool
- All services must use the same PostgreSQL major version

## Mitigation

- Set `statement_timeout` and `lock_timeout` per service role to limit blast radius
- Use `pg_bouncer` if connection count becomes a concern
- Extract high-volume schemas to their own instance when `pg_stat_statements` shows
  consistent >10ms average query times under load
