# ADR 002 — Two-level tenancy (tenant_id + sub_tenant_id) from day one

**Date**: 2025-04  
**Status**: Accepted

## Context

The platform needs to support:

- Simple single-tenant apps (ecommerce, portfolio sites)
- Marketplace apps where the tenant's clients are themselves merchants
- SaaS apps where the tenant's clients are organisations with their own users

Adding a second isolation level after launch requires a data migration across every table.

## Decision

Every database table includes two columns from the start:

```sql
tenant_id     uuid NOT NULL,   -- always present
sub_tenant_id uuid             -- nullable: only apps that need it use it
```

Row-level security policies check both:

```sql
USING (
  tenant_id = current_setting('app.tenant_id', true)::uuid
  AND (
    sub_tenant_id IS NULL
    OR sub_tenant_id = current_setting('app.sub_tenant_id', true)::uuid
  )
)
```

When `sub_tenant_id` is `NULL` in a row, it belongs to the root tenant and is
accessible to any request that has the matching `tenant_id`, regardless of whether
a `sub_tenant_id` is set in the session.

## Consequences

**Positive:**
- Apps that only need one level pay no runtime cost (the column is just `NULL`)
- Marketplace and SaaS apps can enable the second level with no schema migration
- A single RLS policy covers both cases

**Negative:**
- Every query plan carries a two-column predicate instead of one
- Developers must remember that `NULL` sub_tenant_id means "root tenant resource",
  not "no isolation"

## What is explicitly not supported

A third level (e.g. `sub_sub_tenant_id`) is not modelled. If a use case genuinely
requires three levels, the correct solution is a graph-based permission model, not
a deeper column hierarchy.
