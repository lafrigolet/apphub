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
own schema and no access to other schemas. Row-level security enforces tenant isolation
within each schema.

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
- Use `pg_bouncer` or `pgpool` if connection count becomes a concern
- Extract high-volume schemas (e.g. `payments`) to their own instance when
  `pg_stat_statements` shows consistent >10ms average query times under load
