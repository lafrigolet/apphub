# ADR 002 — Three-level identity: app_id + tenant_id + sub_tenant_id

**Date**: 2025-04 (revised 2026-04)  
**Status**: Accepted

## Context

AppHub hosts multiple independent apps. Each app has its own set of tenants (deployments),
and each tenant may optionally have sub-tenants (e.g. franchise locations within a yoga
franchise group). The platform needs to support:

- Multiple apps sharing the same PostgreSQL instance without data leakage between them
- Simple single-tenant apps (one yoga studio, one e-commerce store)
- Multi-tenant apps where the tenant's clients are organisations with their own users
- SaaS apps where a tenant has sub-units (franchise branches, sub-organisations)

Adding any of these isolation axes after launch requires a data migration across every table.

## Decision

### JWT identity — three claims

Every JWT issued by `platform/auth` carries three identity claims:

```json
{
  "sub": "user-uuid",
  "app_id": "yoga-studio",
  "tenant_id": "tenant-uuid",
  "sub_tenant_id": "sub-tenant-uuid-or-null"
}
```

| Claim | Meaning | Nullable? |
|---|---|---|
| `app_id` | Which app this user belongs to | No |
| `tenant_id` | Which deployment of that app | No |
| `sub_tenant_id` | Sub-unit within the tenant | Yes |

### Database columns

Every database table includes three columns from the start:

```sql
app_id        text NOT NULL,       -- always present
tenant_id     uuid NOT NULL,       -- always present
sub_tenant_id uuid                 -- nullable: only apps that need it use it
```

### RLS policies

Row-level security policies check all three axes:

```sql
USING (
  app_id    = current_setting('app.app_id',    true)
  AND tenant_id = current_setting('app.tenant_id', true)::uuid
  AND (
    sub_tenant_id IS NULL
    OR sub_tenant_id = current_setting('app.sub_tenant_id', true)::uuid
  )
)
```

When `sub_tenant_id` is `NULL` in a row, it belongs to the root tenant and is
accessible to any request that has the matching `app_id` and `tenant_id`, regardless
of whether a `sub_tenant_id` is set in the session.

### Service-level enforcement — `appGuard`

Every service registers the `appGuard` plugin from `@apphub/platform-sdk`. It:

1. Verifies the JWT signature using `PLATFORM_JWT_SECRET`.
2. Checks `payload.app_id === process.env.EXPECTED_APP_ID`. Returns `403 APP_MISMATCH`
   if not (platform services use `EXPECTED_APP_ID=platform`).
3. Sets `req.identity = { userId, appId, tenantId, subTenantId, role, email }`.

This is defence-in-depth on top of NGINX subdomain routing. A yoga JWT presented to a
split-pay service endpoint returns 403 at the service level even if NGINX routes it.

### Session context — `setTenantContext`

Before any tenant-scoped query, call `setTenantContext` from `platform-sdk`:

```js
await setTenantContext(client, req.identity.appId, req.identity.tenantId, req.identity.subTenantId)
```

This sets all three PostgreSQL session variables:

```sql
SELECT set_config('app.app_id',        'yoga-studio',    true);
SELECT set_config('app.tenant_id',     'tenant-uuid',    true);
SELECT set_config('app.sub_tenant_id', 'location-uuid',  true);
```

## Consequences

**Positive:**
- Apps that only need one level pay no runtime cost (`sub_tenant_id` is just `NULL`)
- Multi-level tenancy can be enabled per-app with no schema migration
- A single RLS policy covers all cases
- Cross-app data leakage is prevented at both the service layer (`appGuard`) and the DB
  layer (RLS on `app_id`)

**Negative:**
- Every query plan carries a three-column predicate instead of one
- Developers must remember that `NULL` sub_tenant_id means "root tenant resource",
  not "no isolation"
- `app_id` is a text column (not uuid) for human readability — slightly wider than an int

## What is explicitly not supported

A fourth level (e.g. `sub_sub_tenant_id`) is not modelled. If a use case genuinely
requires four levels, the correct solution is a graph-based permission model, not
a deeper column hierarchy.
