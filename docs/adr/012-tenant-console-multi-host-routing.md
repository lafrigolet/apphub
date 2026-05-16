# ADR 012 — Tenant Console multi-host routing

**Status:** Accepted (tenant-console Fase 4)
**Date:** 2026-05-02

## Context

The tenant-console-portal is a single deployment that serves *every* tenant.
Each tenant has a unique `subdomain` (column on `platform_tenants.tenants`),
and we want `<subdomain>.apphub.{local,com}` to land the user inside their
own console.

Two earlier design choices set the constraints:

- **One container per portal.** The platform runs one `tenant-console-portal`
  service, not one per tenant. The shell figures out *which* tenant from the
  user's JWT (`tenant_id` claim).
- **NGINX sidecar reads server blocks from Redis** (`infra/nginx/sidecar.sh`).
  Apps already register their server blocks dynamically via
  `writeAppNginxConfig` — we follow the same pattern for tenants.

## Decision

1. **One Redis hash field per tenant subdomain.** When a tenant is created
   (`tenants.service.createTenant`), platform-core writes
   `nginx:configs[tenant--<subdomain>] = <rendered server block>`. The block
   listens on `<subdomain>.hulkstein.local` + `<subdomain>.hulkstein.com` and
   proxies `/` to the static `tenant_console_portal` upstream. We namespace
   the Redis hash field with `tenant--` so app subdomains (top-level
   subdomains of the platform itself: yoga, splitpay, …) and tenant
   subdomains (per-customer) can't collide.

2. **Backfill on platform-core boot.** `tenant-config` runs
   `backfillTenantNginxConfigs()` after registration so a freshly-cleared
   Redis re-acquires the full subdomain map without manual intervention.
   Idempotent — `HSET` is a no-op when the field already matches.

3. **Public subdomain → tenant lookup.** New endpoint
   `GET /v1/tenants/by-subdomain/:subdomain` returns
   `{ tenantId, appId, displayName, status }` and is mounted as `public`
   (no JWT). The tenant-console-portal calls it on first mount to derive
   the host context — this drives the LoginView header ("Iniciar sesión en
   <Acme>") and the post-login mismatch banner.

4. **Login flow.** The user logs in at `<subdomain>.apphub.{local,com}`
   with their email + password against the existing
   `POST /v1/auth/login`. The JWT carries `app_id` + `tenant_id` from the
   user's row. If the JWT's tenant differs from the host's tenant, the
   shell renders a soft warning banner with a one-click redirect to the
   correct subdomain. We deliberately do NOT hard-redirect — the
   one-click escape preserves the URL bar and the user's mental model.

5. **Cutover from voragine-console.** voragine-console-portal is
   staff-only as of this ADR. When a JWT with `role !== 'staff'` lands
   there, the shell renders a `TenantHandoff` view that surfaces the
   tenant's subdomain and a CTA. Users keep a "Cerrar sesión" escape
   hatch. We avoid `window.replace` so back/forward navigation stays
   sensible.

## Consequences

- **Single shared upstream.** All tenant subdomains proxy to the same
  `tenant_console_portal` upstream — no per-tenant frontend container.
  Scaling tenants is just DB rows + Redis hash entries.
- **JWT carries the tenant.** Same JWT works at both
  `tenant-console.hulkstein.local` (the generic entry) and any
  `<subdomain>.hulkstein.local`. The mismatch banner addresses the rare case
  where a user logs in on the wrong host.
- **Subdomains are routing only.** Knowing the subdomain ≠ being
  authenticated as that tenant. A user at `acme.hulkstein.local` whose JWT
  is for `bastardo` will see Acme's login screen but, after login, will
  load Bastardo's manifests (with the warning banner). The JWT is the
  authoritative tenant binding; subdomains are just signposts.
- **Operator playbook for "tenant routes to nothing":**
  1. Confirm the row exists (`platform_tenants.tenants.subdomain`).
  2. Check Redis hash: `HGET nginx:configs tenant--<subdomain>`.
  3. If empty, restart `platform-core` — backfill re-publishes.
  4. Sidecar reload happens within `POLL_INTERVAL` (default 2 s).
- **What we did NOT do:**
  - **Per-tenant container.** Overkill for a SaaS where all tenants
    share the same code.
  - **Wildcard server_name regex.** Conflicts with app subdomains
    (`yoga.*`, `splitpay.*`, …); explicit registration per tenant keeps
    "is this subdomain mine?" decidable from Redis.
  - **Hard redirect from voragine-console.** Breaks deep links and
    clipboard ergonomics for the rare case where staff legitimately
    needs to inspect a tenant URL.

## See also

- `platform/tenant-config/src/services/nginx-config.service.js` — render
  + publish logic for both app and tenant templates.
- `infra/nginx/sidecar.sh` — Redis polling + nginx reload.
- `apps/tenant-console/tenant-console-portal/src/shell/lib/context.jsx` —
  host detection + mismatch detection.
- `apps/voragine-console/voragine-console-portal/src/App.jsx` — handoff
  view for non-staff JWTs.
