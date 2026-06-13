# Architecture

## Overview

AppHub is a multi-app meta-platform built as a monorepo of microservices. Multiple
independent apps (aikikan, split-pay, …) share a set of cross-cutting platform
services. Each app gets its own subdomain and its own app-specific microservices.

## Platform layers

```
                  ┌─────────────────────────────────────────────┐
                  │            Internet / CDN                    │
                  └────────────────────┬────────────────────────┘
                                       │
                  ┌────────────────────▼────────────────────────┐
                  │       NGINX  (conf.d/ subdomain routing)     │
                  │  hulkstein.local  aikikan.hulkstein.local  splitpay…│
                  └──────┬─────────────┬────────────────┬───────┘
                         │             │                │
              ┌──────────▼──┐  ┌───────▼────┐  ┌───────▼──────┐
              │  AppHub      │  │   Aikikan   │  │ Split Pay    │
              │  portal:5173 │  │ portal:5176 │  │ portal:5175  │
              └─────────────┘  └───────┬─────┘  └──────┬───────┘
                                       │ /api/app/*     │ /api/app/*
                              ┌────────▼──────┐ ┌───────▼──────┐
                              │ aikikan-server│ │   splitpay   │
                              │ 3030          │ │ 3020         │
                              └───────────────┘ └──────────────┘
                                       │                │
              /api/auth, /api/payments, /api/orders, /api/menu, /api/bookings, …
        ┌───────────────────────────────────────────────────────────────────┐
        │                                                                     │
┌───────▼─────────────────────────────────────────┐   ┌─────────────────────┐
│ platform-core:3000  (ADR 021 — ~35 módulos)      │   │ platform-scheduler   │
│ auth, notifications, payments, tenant-config,    │   │ :3400 (cron)         │
│ splitpay, storage, leads, donations, inquiries,  │   └─────────────────────┘
│ verifactu, chat, tpv, commerce  +  marketplace   │
│ (orders, inventory, reviews, messaging, shipping,│
│ disputes, catalog, basket)  +  restaurant (menu, │
│ reservations, floor-plan, kds, pos, delivery-    │
│ dispatch)  +  appointments (services, resources, │
│ bookings, availability, intake-forms, telehealth,│
│ packages, practitioner-payouts)                  │
└──────────────────────────────────────────────────┘
                                  │
                          shared Postgres + Redis (platform.events)
```

## Subdomain routing

| Subdomain | Local alias | App |
|---|---|---|
| `hulkstein.com` | `hulkstein.local` | AppHub admin portal |
| `splitpay.hulkstein.com` | `splitpay.hulkstein.local` | Split Pay |
| `aikikan.hulkstein.com` | `aikikan.hulkstein.local` | Aikikan (Aikido association) |
| `js-electric.hulkstein.com` | `js-electric.hulkstein.local` | JS Electric (marketing landing + lead inbox) |

### Route namespace convention

| URL prefix | Meaning | Served by | Present on |
|---|---|---|---|
| `/api/auth/` | Platform auth | platform-core | All subdomains |
| `/api/payments/` | Platform payments | platform-core | All subdomains |
| `/api/notifications/` | Platform notifications | platform-core | All subdomains |
| `/api/tenants/` | Tenant registry | platform-core | All subdomains |
| `/api/splitpay/` | Stripe Connect | platform-core | All subdomains |
| `/api/storage/` | Object storage (MinIO/S3 presigned URLs) | platform-core | All subdomains |
| `/api/leads/` | Public lead-capture + staff CRM | platform-core | Hulkstein landing |
| `/api/donations/` | Donations (one-shot + recurring + fiscal) | platform-core | All subdomains |
| `/api/orders/` | Orders ledger | platform-core | All subdomains |
| `/api/inventory/` | Stock per SKU | platform-core | All subdomains |
| `/api/reviews/` | Reviews + replies | platform-core | All subdomains |
| `/api/messages/` | Buyer ↔ vendor chat | platform-core | All subdomains |
| `/api/shipping/` | Shipments + tracking + EasyPost rate-shop/labels/pickups + addresses | platform-core | All subdomains |
| `/api/disputes/` | Operational disputes | platform-core | All subdomains |
| `/api/catalog/` | Product catalogue | platform-core | All subdomains |
| `/api/basket/` | Shopping cart (Redis) | platform-core | All subdomains |
| `/api/menu/` | F&B menu | platform-core | All subdomains |
| `/api/reservations/` | Reservations + waitlist | platform-core | All subdomains |
| `/api/floor-plan/` | Tables + sections | platform-core | All subdomains |
| `/api/kds/` | Kitchen Display System | platform-core | All subdomains |
| `/api/pos/` | POS bills + split + tips | platform-core | All subdomains |
| `/api/delivery-dispatch/` | Riders + delivery zones | platform-core | All subdomains |
| `/api/app/...` | App-specific routes | (per-app service) | Only that subdomain |
| `/` | App frontend | (per-app portal) | Only that subdomain |

NGINX uses a hybrid configuration:

- **Static infrastructure** (`nginx.conf`, `conf.d/upstream.conf`, `snippets/`) is bind-mounted
  read-only from the host. These rarely change and are version-controlled via git.
- **Per-subdomain server blocks** live in **Redis** (hash `nginx:configs`, one field per
  subdomain). A sidecar inside the NGINX container polls Redis every 2s, renders each field
  to `/etc/nginx/conf.d/sites/<subdomain>.conf`, and triggers `nginx -s reload` on change.

When staff registers a new app from console (`POST /v1/apps`), `platform-core` writes
the rendered server block to the Redis hash. Every NGINX replica in the cluster picks it up
within ~2s without manual reload, host-side ops, or filesystem coordination between nodes.

See [ADR 003 — Dynamic NGINX routing via Redis sidecar](docs/adr/003-dynamic-nginx-routing.md)
for the rationale, alternatives considered (Docker Configs, OpenResty, NGINX Plus, K8s Ingress),
and operational details (bootstrap, debugging, tunables, migration to Kubernetes).

## Identity model — JWT claims (single-tenant collapse, ADR 020)

```
platform/auth  issues JWTs with:
  sub           →  user UUID
  app_id        →  which app   (aikikan | split-pay | …) — the customer boundary
  tenant_id     →  the app's single tenant (derived from app_id, 1 app = 1 tenant)
  role          →  user role within that app
  email
  (sub_tenant_id is NO LONGER emitted — reserved, always NULL)
```

Every app-specific service registers the `appGuard` plugin from `@apphub/platform-sdk`.
The guard reads `EXPECTED_APP_ID` from the environment and returns `403 APP_MISMATCH` if
the token's `app_id` does not match. Platform services set `EXPECTED_APP_ID=platform`.

## Multi-tenancy model (collapsed — ADR 020)

```
Platform (AppHub)
  └── App (aikikan, split-pay, …)           app_id          ← effective customer boundary
        └── Tenant (exactly one per app)     tenant_id uuid  ← derived from app_id
              └── (sub-tenant reserved)       sub_tenant_id   ← always NULL
                    └── End users
```

- `app_id` is set at login from the request body and verified on every service call.
- `tenant_id` is the app's single tenant — resolved from `app_id` (`resolveAppTenant`)
  when a caller doesn't supply it; provisioning rejects a second tenant per app.
- `sub_tenant_id` is **reserved (always NULL)** — subtenancy was collapsed away.
- The columns, RLS policies and `app_id + tenant_id` scoping are **physically kept** so
  multi-tenancy can be reintroduced per app later (app-local schema, or re-exposing
  `tenant_id` in that app's JWT). Row-level security still enforces `app_id + tenant_id`.

## PostgreSQL schema isolation

One PostgreSQL instance, one schema per service. Each service connects with its own
dedicated PostgreSQL role — never the shared superuser. The superuser is only used
by `migrate.js` via `MIGRATION_DATABASE_URL`.

```
PostgreSQL instance
│
│ ── platform-core modules ──
├── platform_auth                 (platform/auth)            role: svc_platform_auth
├── platform_payments             (platform/payments)        role: svc_platform_payments
├── platform_notifications        (platform/notifications)   role: svc_platform_notifications
├── platform_tenants              (platform/tenant-config)   role: svc_platform_tenants
├── splitpay_core                 (platform/splitpay)        role: splitpay (shared, legacy)
├── platform_storage              (platform/storage)         role: svc_platform_storage
├── platform_leads                (platform/leads)           role: svc_platform_leads
├── platform_donations            (platform/donations)       role: svc_platform_donations
├── platform_inquiries            (platform/inquiries)       role: svc_platform_inquiries
├── platform_verifactu            (platform/verifactu)       role: svc_platform_verifactu
├── platform_chat                 (platform/chat)            role: svc_platform_chat
│
│ ── platform-core modules ──
├── platform_orders               (platform/orders)          role: svc_platform_orders
├── platform_inventory            (platform/inventory)       role: svc_platform_inventory
├── platform_reviews              (platform/reviews)         role: svc_platform_reviews
├── platform_messaging            (platform/messaging)       role: svc_platform_messaging
├── platform_shipping             (platform/shipping)        role: svc_platform_shipping
├── platform_disputes             (platform/disputes)        role: svc_platform_disputes
├── platform_catalog              (platform/catalog)         role: svc_platform_catalog
│   (basket has no schema — Redis-only)
│
│ ── platform-core modules ──
├── platform_menu                 (platform/menu)            role: svc_platform_menu
├── platform_reservations         (platform/reservations)    role: svc_platform_reservations
├── platform_floor_plan           (platform/floor-plan)      role: svc_platform_floor_plan
├── platform_kds                  (platform/kds)             role: svc_platform_kds
├── platform_pos                  (platform/pos)             role: svc_platform_pos
├── platform_delivery_dispatch    (platform/delivery-dispatch) role: svc_platform_delivery_dispatch
│
│ ── App-specific schemas ──
├── app_aikikan                    (apps/aikikan/aikikan-server)  role: svc_app_aikikan
└── … (one per app — apps without app-specific domain like js-electric have no schema)
```

**Apps without an app-specific schema.** Not every app needs a backend.
Marketing-site apps (current example: `js-electric`) live as portal-only
deployments that REUSE platform modules — typically `platform/inquiries`
for the contact form and `platform/auth` for an embedded admin inbox. No
`app_<name>` schema, no `<name>-server` container. Admin views live inside
the app's own portal (see memory `feedback_app_admin_in_own_portal.md`),
not in `packages/tenant-console-ui/`. When/if the app later grows
app-specific data (CMS for projects, blog posts, etc.), that's the trigger
to introduce `app_<name>` per ADR 013.

Cross-schema queries are never allowed. Roles and grants are defined in
`infra/postgres/init/01_platform_schemas.sql`.

## Event bus

Services communicate asynchronously via Redis Pub/Sub. Events are published to a channel
named `{appId}.events` using `publish()` from `@apphub/platform-sdk/redis.js`. Consumers
subscribe to the same channel in their startup hook.

Cross-app subscribers (modules en `platform-core` que sirven a más de un
app, p.ej. `platform/donations`) usan **`psubscribe('*.events')`** y
filtran por `metadata.*` para identificar los eventos relevantes —
patrón inspirado en cómo splitpay enruta sus webhooks de Stripe a la
app correcta vía `metadata.app_id`.

Eventos clave emitidos por el dominio dinero:

| Origen | Tipo | Cuándo | Consumido por |
|---|---|---|---|
| `platform/splitpay` | `splitpay.checkout.completed`, `splitpay.invoice.paid`, `splitpay.invoice.payment_failed`, `splitpay.subscription.updated`, `splitpay.subscription.deleted` | webhook Stripe correspondiente | Cada app que cobra (aikikan-server, `platform/donations`, …) |
| `platform/donations` | `donation.completed`, `donation.recurring.charged`, `donation.recurring.failed`, `donation.recurring.cancelled`, `donation.refunded`, `donation.certificate.ready` | tras reconciliar el webhook de splitpay | `platform/notifications` (emails al donante) + apps suscritas |
| `platform/chat` | `chat.conversation.created`, `chat.message.created`, `chat.mention.created`, `chat.support.assigned`, `chat.message.reported`, `chat.support.sla_breached` | tras persistir la escritura correspondiente (los dos últimos los emite `platform-scheduler`) | `platform/notifications` (push al destinatario, vía `userId`→`push_devices`) |
| `platform-scheduler` → `platform/chat` | `chat.scheduled.due` | cuando llega la hora de un mensaje programado | el consumidor de `platform/chat` entrega el mensaje (flip a `sent` + fan-out) |
| `platform/pos` | `pos.bill.paid` (enriquecido: payments[], unitPriceCents, metadata.deviceId), `pos.bill.cancelled` | al pagarse/cancelarse una cuenta | `platform/kds` (comanda) + `platform/tpv` (billing fact + imputación de efectivo + auto-emisión) |
| `platform/tpv` | `tpv.session.opened/closed/reopened`, `tpv.cash.moved`, `tpv.receipt.issued`, `tpv.receipt.voided`, `tpv.receipt.send_requested`, `tpv.zreport.generated` | operación de caja / emisión fiscal | `platform/verifactu` (registro encadenado + QR) · futuros: notifications (email recibo), inventory (restock) |
| `platform/verifactu` | `verifactu.registro.created`, `verifactu.registro.failed` | tras encadenar (o fallar) el registro de facturación | `platform/tpv` (completa QR/estado fiscal del recibo o abono) |
| `platform-scheduler` → `platform/verifactu` | `verifactu.remision.due`, `verifactu.remision.dlq_alert` | registros pendientes/reintentables de remitir, o entradas en DLQ | `platform/verifactu` drena la cola (mTLS + SOAP a la AEAT) · notifications (alerta DLQ) |
| `platform/orders`, `platform/donations` → `platform/verifactu` | `order.completed`, `donation.created` | venta/donación completada | `platform/verifactu` (registro de alta con dedupe por order_id/donation_id; POS va vía la cadena TPV) |
| `platform/payments` → `platform/commerce` | `payment.succeeded`, `payment.failed` | se cobra/falla un pago enlazado a un checkout | `platform/commerce` casa el checkout y emite `commerce.purchase.paid` |
| `platform/commerce` → `platform/packages`, `platform/bookings` | `commerce.purchase.paid` | checkout pagado (kind=package/booking) | `packages` crea el bono · `bookings` confirma la reserva (cada uno escribe su esquema) |
| `platform-scheduler` → `platform/tpv` | `tpv.session.force_closed` | sesión de caja abierta más allá de la ventana de autocierre | apps/portales TPV (aviso al manager) |
| `platform/notifications` | `email.inbound.received` + el evento de la ruta/token (`inquiry.reply.received`, `lead.email.received`, …) | al ingerir y enrutar un correo entrante (Resend Inbound) | `platform/inquiries` (respuesta → timeline), `platform/leads` (leads@ → lead), cualquier módulo con regla en `inbound_routes` |
| `platform-scheduler` → `platform/notifications` | `notifications.inbound.purge_due` | diario 05:15 (`notifications-inbound-purge`) | el consumidor de notifications borra `inbound_emails` caducados + objetos S3 + reply tokens expirados |

### Inbound email (Resend Inbound)

`platform/notifications` también **recibe** correo. Los registros MX del
dominio de recepción (p.ej. `reply.hulkstein.com`, grey-cloud en Cloudflare)
apuntan a Resend; Resend dispara `email.received` en el mismo webhook
(`POST /v1/notifications/webhooks/resend`, ahora con verificación **Svix HMAC**
sobre el raw body cuando `resend_webhook_secret` es un `whsec_…`). El payload
trae solo metadatos: el pipeline (`inbound.service.js`) recupera el contenido
vía la Receiving API (`GET /emails/receiving/{id}`), descarga los adjuntos
(política de tipos/tamaño por config, dedup sha256) y los persiste en el bucket
S3 compartido vía `@apphub/platform-sdk/storage` bajo `inbound/<emailId>/…` —
metadatos en `platform_notifications.inbound_attachments`, nunca tocando el
esquema de storage.

El enrutado publica eventos en `platform.events` (las fronteras de módulo se
mantienen): primero los **reply tokens** plus-addressed (`reply+<token>@…`,
acuñados con `mintReplyAddress()` al enviar un email que quiere respuesta
en-plataforma, p.ej. la confirmación de inquiry), después las reglas
`inbound_routes` (dirección exacta > catch-all de dominio), y por último el
fallback configurable. Gates previos: bloqueo/allowlist de remitentes,
detección de auto-replies (anti mail-loop), rate-limit por remitente.
FSM: `received → fetched → routed | unrouted | archived | quarantined | failed`,
con bandeja staff + reprocess en `/v1/notifications/admin/inbound*` y purga
GDPR/retención vía scheduler. El envío saliente por Resend no cambia: la
recepción solo añade MX; SPF/DKIM/DMARC de envío intactos.

### Real-time delivery (chat)

`platform/chat` añade el **primer gateway WebSocket** de la plataforma
(`GET /v1/chat/ws`, vía `@fastify/websocket`). Además del bus de negocio
`platform.events`, el módulo publica *frames* de tiempo real en
`chat:rt:{appId}:{tenantId}`; cada instancia de `platform-core` mantiene un
suscriptor (`psubscribe chat:rt:*`) que reenvía cada frame a los sockets
conectados localmente cuyo usuario figura en `recipientUserIds`. Así la
entrega funciona **navegador-a-navegador** incluso con varias réplicas. El
*envío* de mensajes siempre va por el POST REST (una única ruta de escritura
auditable); el socket sólo transporta entrega + typing + presencia. Presencia
y typing son efímeros (claves Redis con TTL). Ver [ADR 014](docs/adr/014-chat-module-and-websocket-gateway.md).

Además del gateway, `platform/chat` corre un **consumidor de `platform.events`**
(como `notifications`) para los flujos dirigidos por tiempo: `platform-scheduler`
publica `chat.scheduled.due` y el consumidor del módulo realiza la entrega real
del mensaje programado (manteniendo la ruta de escritura dentro del módulo). Los
jobs `chat-ephemeral-purge` y `chat-retention-purge` operan por DELETE/UPDATE
directo sobre `platform_chat` (rol `svc_platform_scheduler` con grants), y
`chat-support-sla` marca y publica brechas de SLA de soporte.

## Idempotency

All Stripe API calls carry an `Idempotency-Key` derived from the internal operation ID.
Keys are stored in Redis with a 24-hour TTL to prevent duplicate charges on network retries.

## Monorepo tooling

- **pnpm workspaces** — shared `node_modules`, no duplication
- **Turborepo** — incremental builds and test runs
- **Docker Compose** — identical environment in local, CI, and staging

## Container topology

| Docker service | What runs inside | Ports |
|---|---|---|
| `platform-core` | Modular monolith: auth + notifications + payments + tenant-config + splitpay + storage + leads + donations + inquiries + verifactu + chat + tpv + commerce | 3000 |
| `platform-core` | Modular monolith: orders + inventory + reviews + messaging + shipping + disputes + catalog + basket | 3100 |
| `platform-core` | Modular monolith: menu + reservations + floor-plan + kds + pos + delivery-dispatch | 3200 |
| `platform-core` | Modular monolith: services + resources + bookings + availability + intake-forms + telehealth + packages + practitioner-payouts | 3300 |
| `platform-scheduler` | Single-runner cron for all 4 monoliths (9 jobs: hold purge, reminders, recurrence expander, expiry warnings, payout close, SLA breach, abandoned cart) | 3400 |
| `portals` | All frontends in one container ([ADR 017](docs/adr/017-unified-portals-container.md)): dev = N Vite processes, prod = nginx-alpine, one port per portal in both | 5173, 5175–5184 |
| `postgres` | PostgreSQL 16 | 5432 |
| `redis` | Redis 7 | 6379 |
| `minio` | S3-compatible object store (MinIO) | 9000 (API), 9001 (console) |
| `nginx` | NGINX gateway | 8080 |

The **four monolith containers** (`platform-core`, `platform-core`,
`platform-core` and `platform-core`) follow the same pattern: each owns a
domain, exposes a single port, hosts its modules in-process, runs each module's migrations
on boot, and shares the same Postgres + Redis instances. Cross-container communication is
by Redis events (`platform.events` channel) and shared `PLATFORM_JWT_SECRET` so JWTs are
accepted on all of them. See [ADR 004](docs/adr/004-domain-separated-monolith-containers.md)
for the rationale, [ADR 005](docs/adr/005-platform-core-monolith.md) for the
restaurant split, and [ADR 006](docs/adr/006-platform-core-monolith.md) for the
appointments split. The `tpv` module (point-of-sale) is hosted inside `platform-core`
for operational economy but keeps its own `server.js` + `Dockerfile` ready-to-split —
see [ADR 015](docs/adr/015-platform-tpv-monolith.md) /
[ADR 016](docs/adr/016-tpv-folded-into-platform-core.md).

## Port allocation

| Range | Owner |
|---|---|
| 3000–3005 | Platform services |
| 3006–3009 | Reserved for future platform services |
| 3020–3029 | Split Pay app services |
| 3030 | apps-servers (single orchestrator hosting every app-specific server — aikikan, aulavera, …; ADR 018) |
| 3031–3099 | Reserved (re-split of individual app servers if scaling demands it) |
| 3100 | platform-core |
| 3200 | platform-core |
| 3300 | platform-core |
| 3400 | platform-scheduler |
| 3500+ | Future domain monoliths (3500 reserved for platform-tpv if tpv is split back out, ADR 016) |
| 5173, 5175–5184 | Portals (single `portals` container — one port per frontend: 5173 apphub-admin, 5175 splitpay, 5176 aikikan, 5177 console, 5178 tenant-console, 5179 aulavera, 5180 js-electric, 5181 macabeo, 5182 verifactu, 5183 tpv, 5184 luciapassardi) |
| 5185+ | Future app portals (new server block + port in the `portals` container, ADR 017) |

## Architecture Decision Records

ADRs are stored in `docs/adr/`. Current decisions:

| # | Decision |
|---|---|
| 001 | Use PostgreSQL schemas instead of separate databases per service |
| 002 | Three-level identity: app_id + tenant_id + sub_tenant_id |
| 003 | Dynamic NGINX routing via Redis sidecar |
| 004 | Domain-separated monolith containers (platform-core + platform-core) |
| 005 | platform-core: third domain monolith for restaurant operations |
| 006 | platform-core: fourth domain monolith for appointment / scheduling |
| 007 | platform-scheduler: single-runner cron container for the 4 monoliths |
| 008 | Object storage: MinIO + storage module of platform-core (presigned PUT/GET) |
| 009 | reviews verified-purchase via HTTP loopback to orders |
| 010 | Real-time in messaging deferred (polling now, WebSocket later) |
| 011 | Calendar integrations (Google / Outlook two-way sync) deferred |
| 012 | Tenant Console multi-host routing |
| 013 | App architecture: monolith per app + unified schema naming |
| 014 | chat module + the platform's first WebSocket gateway |
| 015 | platform-tpv: fifth domain monolith for point-of-sale operations (container superseded by 016) |
| 016 | tpv folded into platform-core (kept ready-to-split) |
| 017 | Single portals container for all frontends (port-per-portal) |
| 018 | apps-servers: single orchestrator for app-specific servers (per-scope guard) |
