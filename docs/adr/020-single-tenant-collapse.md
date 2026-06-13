# ADR 020 — Single-tenant collapse: `tenant_id` derived from `app_id`, `sub_tenant_id` reserved

## Status

Accepted — 2026-06-13.

## Context

The platform was built for SaaS multi-tenancy: one `app_id` (a product) serving
many `tenant_id` (customer deployments), each optionally split into
`sub_tenant_id` (sub-units). In practice that shape is never used:

- Every real product (`aikikan`, `aulavera`, `luciapassardi`, `tpv`,
  `js-electric`, …) is a **distinct brand/product with exactly one tenant**.
  We spin up a new `app_id` per customer, not a new tenant under a shared app.
- `sub_tenant_id` is NULL in every seed and exercised by no test.
- The only multi-tenant data was the `console` seed's 12 demo tenants, used
  solely to populate the staff tenant-management UI.

So `app_id` already *is* the customer boundary, and the `tenant_id` /
`sub_tenant_id` axes add management overhead (a tenant-management UI, a
two-level bootstrap, `subTenantId` threaded through every call) with no benefit.

A full physical removal (drop the columns from ~156 tables, delete ~160 RLS
policies, rebuild 7 composite PKs, rewrite ~800 files) was rejected: weeks of
high-risk, hard-to-reverse churn that would also make reintroducing
platform-level multi-tenancy a from-scratch project.

## Decision

**Collapse to a single tenant per app at the identity and management layers,
keeping the database physically multi-tenant-capable.**

- **Keep intact:** `tenant_id` / `sub_tenant_id` columns, all RLS policies,
  composite PKs, and the `app_id + tenant_id` query scoping. The JWT still
  carries `tenant_id` (RLS depends on it).
- **`tenant_id` becomes derived, not an input:** each app has exactly one
  tenant. Where callers used to pass it, they may omit it and the platform
  resolves it from `app_id` via `resolveAppTenant(appId)`
  (`platform/auth/src/services/auth.service.js`, mirrors `resolveUserTenant`).
  `tenant-config` rejects provisioning a second tenant for an app.
- **`sub_tenant_id` becomes reserved (always NULL):** the JWT (`auth` + OAuth)
  no longer emits it; the guard forces `req.identity.subTenantId = null`; code
  writes NULL to the columns and exposes no subtenant selector.
- **Every new app gets an initial `super_admin`** (`PLATFORM_DEFAULT_SUPERADMIN_EMAIL`,
  default `luisarturo.frigolet@gmail.com`) provisioned during bootstrap with
  email activation (reuses the owner magic-link path; new internal route
  `POST /internal/auth/users`).
- **Console** reframes "Tenants" → "Cuentas" (per-customer management); "Apps"
  stays the technical registry.

## Consequences

- **Reversible & cheap.** ~15–25 files changed; no data migration, no dropped
  columns, no RLS edits. The DB stays exactly as capable as before.
- **Reintroducing multi-tenancy is per-app and bounded.** An app that later
  needs it can do so (a) **app-local** — its own `app_<app>` schema/server
  models tenants/subtenants independently (ADR 013), or (b) **platform-level** —
  re-expose `tenant_id` in that app's JWT and resume threading it. Neither
  requires undoing this ADR globally.
- **Trigger to revisit:** the first app that genuinely needs one product to
  serve multiple isolated customers through the *shared platform modules*
  (payments, orders, tpv, …) rather than its own schema.
