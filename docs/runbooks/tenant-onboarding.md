# Tenant onboarding

How to bring a new tenant onto the platform — from the staff click in
voragine-console to the moment the owner is operating their workspace.

> Distinct from [`platform-bootstrap.md`](platform-bootstrap.md), which
> creates the **first super_admin** on a fresh database. This runbook
> covers the **per-tenant** flow that happens many times across the life
> of the platform.
>
> Design rationale and edge cases live in
> [`../design/tenant-bootstrap.md`](../design/tenant-bootstrap.md). This
> doc is the operating manual; if the two ever conflict, the design doc
> wins for *intent*, the code wins for *current behaviour*.

## Two phases

The flow is split deliberately so staff and owner work asynchronously:

| Phase | Actor | Where | Duration |
|---|---|---|---|
| **A — Provisioning** | staff (`super_admin` / `staff`) | voragine-console | seconds (atomic) |
| **B — Onboarding** | owner | their tenant subdomain | minutes to days |

Phase A leaves the tenant *operational but pending activation*. Phase B is
self-paced by the owner and persists progress between sessions.

---

## Phase A — staff provisions the tenant

### A.1 Open the wizard

In voragine-console (`https://voragine-console.apphub.com`), as
`super_admin` or `staff`:

- **Sidebar → Tenants** → button **"Bootstrap nuevo tenant"** (top right), or
- **Sidebar → Onboarding** → same button at the top.

This opens the wizard modal. Distinct from the legacy "Nuevo tenant"
button — the legacy flow only inserts a row in `platform_tenants.tenants`;
the bootstrap flow creates everything (app, tenant, owner, magic-link)
in one go.

### A.2 Fill the form

Five collapsible sections; required fields are marked with `*`:

| Section | Required | Optional | Notes |
|---|---|---|---|
| **App** | `appId`, `displayName`, `subdomain` | `enabledModules` | Toggle "App existente" / "Nueva app". For an existing app, just pick from the dropdown — the rest is read from the registry. |
| **Identidad del tenant** | `displayName`, `subdomain`, `contactEmail` | `legalName`, `cif`, `country`, `contactPhone`, `address`, `defaultLocale` | `subdomain` auto-derives from `displayName` (slugified, editable). |
| **Owner** | `email`, `displayName` | — | No password — the owner sets one via magic-link. |
| **Subscripción a la plataforma** | — | `period`, `amountCents`, `currency`, `stripePriceId`, `billingEmail` | All optional. Without `stripePriceId` the owner sees "subscripción no configurada — contacta soporte" until staff completes it. |
| **Feature flags** | — | `splitpayEnabled`, `customDomain` | Defaults applied per app. |

Submit calls `POST /v1/tenants/bootstrap`.

### A.3 Confirmation screen

If the request succeeds, the modal switches to a confirmation that shows
the magic-link URL. **Copy it now if you want a fallback** — the same URL
was emailed to the owner, but if email delivery fails, this is the only
client-facing copy.

The link looks like
`https://<tenant.subdomain>.apphub.com/activate?token=<plaintext>` and is
valid for 7 days, single-use.

### A.4 If you need to re-emit or revoke

**Sidebar → Onboarding** lists every tenant whose `bootstrap_completed_at`
is still NULL.

- **Reenviar** — invalidates previous tokens, emits a new one, copies the
  fresh URL to the clipboard, and re-publishes the email.
- **Revocar** — hard-deletes tenant + owner + tokens + the NGINX
  config in Redis. Allowed only while `owner_activated_at IS NULL` (returns
  409 once the owner has activated). Use **archivar** in TenantDetail
  instead for already-active tenants.

Each action is audit-logged in `platform_tenants.audit_log`.

---

## Phase B — owner activates and configures

### B.1 Receive the email

The owner receives "Bienvenido a `<App>` — activa tu cuenta" with a CTA
linking to `https://<tenant.subdomain>.apphub.com/activate?token=…`.

### B.2 Activate

Clicking the link lands on the `/activate` page (served by tenant-console
for the tenant subdomain, or by the app portal — e.g. aikikan — for app
subdomains). The page shows a single form:

- New password (≥ 8 chars).
- Confirm password.

Submitting calls `POST /v1/auth/activate`. On success, the backend:

1. Sets `password_hash`.
2. Flips `pending_activation = false`, `owner_activated_at = now()`.
3. Marks the token consumed.
4. Returns `accessToken` + `refreshToken` (same shape as `/v1/auth/login`).
5. Publishes `tenant.activated` (notifications sends a "Cuenta activa"
   email).

The page redirects to `/` (or `/consola?bootstrap=welcome` for portals
that route admins to a console). The owner is now logged in.

**Replay or expiry:**

- Reusing the same token → 410 `TOKEN_USED`.
- Past 7 days → 410 `TOKEN_EXPIRED`.
- The page shows the message and a CTA to ask staff for a fresh link.

### B.3 Complete the checklist

The first dashboard the owner sees is **"Configura tu cuenta"** instead of
the usual cards grid. The shell renders this whenever
`tenant.bootstrap_completed_at IS NULL`. Steps:

| # | Key | Required | What "done" means |
|---|---|---|---|
| 1 | `identity` | ✅ | `legal_name` + `cif` + `country` + `address` filled |
| 2 | `password` | ✅ | `password_hash IS NOT NULL` (already done after activate) |
| 3 | `subscription` | ✅ | `subscription_status IN ('active','trial')` |
| 4 | `splitpay-connect` | only if `app.splitpay_enabled` | `tenants.stripe_status = 'VERIFIED'` |
| 5 | `admins` | optional | ≥ 1 user with `role='admin'` besides the owner |
| 6 | `email-domains` | optional | ≥ 1 verified domain in `platform_notifications.email_domains` *(not yet derived — see "Known gaps" below)* |
| 7 | `custom-domain` | optional | `tenants.custom_domain IS NOT NULL` *(no DNS verification yet)* |
| 8 | `modules` | optional | `apps.enabled_modules` is non-empty |
| 9 | `first-data` | optional | ≥ 1 row in the app's main table *(not yet derived)* |

Each pending step shows a CTA that navigates to the relevant view in the
console (`tenants-settings`, `splitpay`, `notifications-emails`, …).

The owner can **Minimize** the panel; it returns on every refresh while
any required step is still pending.

When all required steps reach `done`, the backend writes
`bootstrap_completed_at` (write-once — even if the subscription later
falls to `past_due`, the panel does not reappear; a separate dashboard
banner handles regression).

### B.4 What the owner gets after completion

The dashboard switches from the bootstrap panel to the regular grid of
module cards. Standard tenant-console behaviour from here on.

---

## Edge cases and operational notes

### Magic-link delivery fails

The bootstrap response includes the URL; staff can paste it manually into
chat/email. The "Reenviar" button on Onboarding view is the canonical
recovery path and invalidates any previous tokens.

### Owner email was wrong

While `owner_activated_at IS NULL`, staff can edit the email via the
existing `PATCH /v1/auth/users/:id` (no UI yet), then "Reenviar" to send
the new magic-link to the corrected address. Once the owner has activated,
changing the email is a separate flow (not implemented).

### Tenant abandoned in Phase A

Use **Revocar** from Onboarding view. Allowed only before activation.

### Tenant abandoned in Phase B

Visible in Onboarding view with `bootstrap_started_at` showing days
elapsed. There is no automatic reminder yet (see "Known gaps"); follow up
manually or wait for the feature.

### Subscription regresses to `past_due` mid-Phase B

Step 3 flips back to `pending`, **but** the panel does not reappear
because `bootstrap_completed_at` is write-once. A separate billing banner
in the dashboard handles this signal.

### Bootstrapping an entirely new app (no portal container yet)

Today's NGINX template publishes a config pointing to `<subdomain>_portal`.
If that container doesn't exist (a brand-new app from scratch, not from
the bootstrap.sh roster), nginx fails to reload and silently keeps serving
the previous config. Workarounds:

- Provision the container (`docker compose up -d <app>-portal`) **before**
  running the bootstrap, **or**
- Run the `Implementa <app>` command flow described in
  [`/CLAUDE.md`](../../CLAUDE.md), which scaffolds the containers first.

A more automatic solution is queued in
[`/TODO.md`](../../TODO.md#tenant-bootstrap-provisioning--onboarding).

---

## Known gaps

These work but with caveats — track in [`/TODO.md`](../../TODO.md):

- **OAuth on `/activate`** — only password is implemented. Continuing with
  Google / Facebook is in the design but not wired.
- **DNS verification for custom domains** — the step marks done by column
  presence, not by checking the actual DNS record.
- **Steps `email-domains` and `first-data` always `pending`** — the
  derivation events are not wired yet.
- **Automatic reminders at 24 h / 72 h post-bootstrap** — the
  `tenant.bootstrap_started` event is published but no scheduler job picks
  it up.
- **Brand-new apps without portal upstream** — see the edge case above.

---

## Reference — endpoints involved

All under `platform-core` (port 3000), proxied via NGINX at
`/api/tenants/tenants/...` and `/api/auth/...`:

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/v1/tenants/bootstrap` | staff | Phase A — atomic provisioning |
| `POST` | `/v1/auth/activate` | public | Phase B — consume magic-link |
| `GET`  | `/v1/tenants/:id/bootstrap` | tenant member | derived status |
| `POST` | `/v1/tenants/:id/resend-activation` | staff | new magic-link |
| `DELETE` | `/v1/tenants/:id/bootstrap` | staff | revoke pending tenant |
| `GET`  | `/v1/tenants/onboarding` | staff | list pending tenants |

Internal (within `platform-core`, no auth header — used by tenant-config
to avoid crossing schemas):

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/internal/auth/owners` | create pending owner + token |
| `POST` | `/internal/auth/owners/reissue` | new token, invalidate prior |
| `GET`  | `/internal/auth/owners/state?tenantId=` | password set, activated? |
| `GET`  | `/internal/auth/admins/count?tenantId=` | for `admins` step |
| `DELETE` | `/internal/auth/owners?tenantId=` | hard-delete pending owner |
