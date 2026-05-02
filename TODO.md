# TODO — Estado real de cada módulo y qué falta para producción

> Resumen ejecutivo: **todos los módulos arrancan, registran rutas y persisten datos**.
> Lo que falta no es "código que falla" sino **integraciones externas reales,
> ML/HTTP cross-container, autorización fina, scheduling/cron y observabilidad**.

Última actualización: 2026-04-30.

## platform-core (port 3000)

### `auth` — ✅ funcional, gaps menores
- [x] Email/password, JWT, refresh, password reset, RLS
- [x] OAuth Google + Facebook
- **Falta**:
  - [ ] **MFA/TOTP** — no hay segundo factor
  - [ ] **Apple Sign-In, Microsoft, GitHub** — solo Google y Facebook
  - [ ] **Magic-link / passwordless**
  - [ ] **Account lockout policy configurable por tenant** (hoy es global)
  - [ ] **Auditoría de inicios de sesión** (tabla `login_attempts` con éxito/fallo, IP, user-agent)
  - [ ] **CAPTCHA en register/login** tras N fallos
  - [ ] **Email verification** — registro acepta cualquier email sin confirmar

### `payments` — 🔧 esqueleto
- [x] Schema y rutas básicas
- **Falta**:
  - [ ] Integración real con Stripe PaymentIntents fuera de splitpay
  - [ ] **Webhooks Stripe** verificados — el endpoint existe en splitpay, pero `payments` propio no maneja eventos sin split (suscripciones, one-shot)
  - [ ] **Checkout sessions** estilo Stripe Checkout
  - [ ] **Refund flow** completo con motivos
  - [ ] **3D Secure / SCA** cumplimiento
  - [ ] **Apple Pay / Google Pay** wrappers
  - [ ] **Multi-currency** con FX
  - [ ] **Idempotency keys** persistidos en DB (hoy solo Redis 24h)

### `notifications` — ✅ funcional, gaps de canales
- [x] Email vía SendGrid (con fallback log en dev)
- [x] Event consumer para `user.registered`, `auth.password_reset_requested`
- **Falta**:
  - [x] **SMS** (Twilio) — Phase 0+1 wired (commits d2ba91d, b38af3d)
  - [x] **Push notifications** — FCM HTTP v1 (Android + iOS vía APNs key + Web Push) con OAuth2 token cacheado, dev-stub fallback, registro de devices vía `POST /v1/notifications/devices`, sender wrappers para reminders + booking.confirmed, garbage-collect automático de tokens UNREGISTERED. APNs nativo se reservan keys (team_id/key_id/bundle_id/p8) para integración HTTP/2 directa futura.
  - [ ] **WhatsApp Business API**
  - [x] **Plantillas editables** desde voragine-console (CRUD por staff)
  - [x] **i18n** de plantillas (`(key, channel, locale)` UNIQUE + fallback a `'es'` + 8 plantillas seed en `en` + `default_locale` per-tenant + locale per-row en bookings/reservations + cadena de resolución en scheduler)
  - [ ] **Bounce/complaint handling** (webhooks SendGrid → suprimir destinatarios)
  - [x] **Rate limiting por usuario** — Redis-counter por `(user, event, channel)` con ventanas hora/día configurables desde voragine-console
  - [x] **Digest mode** — `digest_mode` config (`off`/`daily`); allowlist de eventos no urgentes encolados en Redis (`nd:digest:<userId>`) y vaciados por el job `notification-digest` del scheduler (cron `0 9 * * *`) que publica `notifications.digest.flush`; el consumer compone un email único por usuario y limpia.
  - [x] **Suscripción a más eventos**: `booking.confirmed/reminded/rescheduled/cancelled`, `reservation.created/cancelled`, `package.exhausted`, `payout.paid` — senders email+sms + plantillas seed (es/en) + 8 plantillas adicionales

### `tenant-config` — ✅ funcional
- [x] Apps + tenants + sub-tenants
- [x] NGINX config dinámica via Redis sidecar
- **Falta**:
  - [ ] **Onboarding wizard end-to-end** (DNS automation real, no solo aliases locales)
  - [ ] **Per-tenant feature flags** (qué módulos puede usar este tenant)
  - [ ] **Quotas / billing tiers**
  - [ ] **Soft-delete + GDPR data export**
  - [ ] **DNS verification** para subdomains custom

### `splitpay` — ✅ funcional
- [x] Stripe Connect, split rules, refund proporcional, webhooks
- **Falta**:
  - [ ] **Marketplace MCC compliance** (detalles del KYC enhanced)
  - [ ] **Connected account dashboard** embebido
  - [ ] **Cross-border payouts** con moneda diferente
  - [ ] **Tax reporting** (1099 US, modelo 347 ES)

## platform-marketplace (port 3100)

### `orders` — ✅ funcional para MVP
- [x] FSM completo, idempotencia, eventos
- **Falta**:
  - [ ] **Llamada real a `splitpay`** para crear PaymentIntent en checkout (hoy es teórico)
  - [ ] **Cálculo de impuestos por jurisdicción** (TaxJar/Avalara o tabla propia)
  - [ ] **Promociones / códigos descuento**
  - [ ] **Multi-vendor splits** (subdividir un order entre N vendors con `splitpay`)
  - [x] **Order modifications** — tabla `order_modifications` (RLS) + endpoints `GET /orders/:id/modifications`, `PUT /orders/:id/shipping-address`, `POST /orders/:id/notes`. Solo mutables en `pending`/`paid`.
  - [x] **Email notifications** — senders `sendOrderPaidEmail/Shipped/Delivered/Cancelled/Refunded` + plantillas seed (es/en) + hidratación de `buyerEmail` via cross-schema GRANT desde `orders` a `platform_auth.users`.

### `inventory` — ✅ funcional
- [x] Stock per SKU, FSM reserve/release/commit, threshold alerts
- **Falta**:
  - [ ] **Stock por warehouse/ubicación** (hoy plano por tenant)
  - [ ] **Backorder support** con cola de espera
  - [ ] **Forecast/replenishment** sugerencias
  - [x] **Variants** — cada variante es su propio SKU con `parent_sku` + `option_values` JSONB y `display_name`. Endpoints `GET/POST /v1/inventory/:sku/variants`. UNIQUE `(app_id, tenant_id, parent_sku, option_values::text)` para evitar combinaciones duplicadas; reserve/release/commit siguen siendo per-SKU sin cambios al FSM.
  - [ ] **Bundle SKUs** (kits que decrementan varios SKUs al vender)

### `reviews` — ✅ funcional
- [x] CRUD, replies, agregados, evento `review.*`
- [x] Verified-purchase check via HTTP a orders (ADR 009) — `verified_purchase` boolean + filtro `verifiedOnly` + `verified_count` en agregados
- **Falta**:
  - [ ] **Moderación con ML** (toxicidad, spam) — solo manual `pending → published`
  - [x] **Photo/video uploads** — tabla `review_media` referencia `platform_storage.objects.id`; endpoints `GET/POST /v1/reviews/:id/media`, `DELETE /:id/media/:mediaId`. Solo el autor (o staff) puede adjuntar.
  - [x] **Helpful/unhelpful voting** — tabla `review_votes` con UNIQUE `(review_id, voter_user_id)`; agregados `helpful_count`/`unhelpful_count` en la fila review; endpoints `PUT/DELETE /v1/reviews/:id/vote`. No permite votar tu propia review.
  - [x] **Schema.org JSON-LD** para SEO — endpoint público `GET /v1/reviews/jsonld?targetType&targetId` que devuelve un objeto Schema.org Product+AggregateRating+Review listo para `<script type="application/ld+json">`.

### `messaging` — ✅ funcional
- [x] Threads, mensajes, attachments, mark read, ACL buyer/vendor/staff
- **Falta**:
  - [ ] **WebSocket / SSE real-time** — diferido a propósito; ADR 010 fija el diseño (Redis Pub/Sub broadcaster + sticky sessions nginx + ruta `GET /v1/messages/threads/:id/stream` con catch-up vía `?since=<messageId>`). REST/polling sigue como camino canónico hasta que typing/presence/live-receipts se prioricen.
  - [ ] **Typing indicators, presence**
  - [x] **Attachments** persistidos en object storage — tabla `message_attachments` (RLS) referenciando `platform_storage.objects.id` con `kind` (image/video/file) + `display_order`; endpoints `GET/POST /v1/messages/threads/:id/messages/:mid/attachments`, `DELETE …/:attachmentId`. La columna JSON `messages.attachments` se mantiene por compat con clientes antiguos.
  - [ ] **Search** en mensajes (Postgres full-text o Elastic)
  - [ ] **Auto-archive** de threads inactivos
  - [ ] **Translation** automática para chat cross-language

### `shipping` — ✅ funcional pero stub de carriers
- [x] Zones, rates, shipments, tracking events, FSM
- **Falta**:
  - [ ] **Integración con carriers reales** (UPS, FedEx, Correos, GLS, SEUR, DHL) — hoy todo manual
  - [ ] **Etiquetas EasyPost/Sendcloud** generación de PDF
  - [x] **Webhook receivers** — `POST /v1/shipping/webhooks/:carrier` (público) con HMAC-SHA256 verificado para EasyPost contra `easypost_webhook_secret`; tabla `carrier_webhook_events` con UNIQUE `(carrier, event_external_id)` para idempotencia; transición automática del shipment cuando el carrier reporta `in_transit`/`delivered`/`returned`.
  - [x] **Multi-package shipments** — tabla `shipment_packages` (RLS) con auto-numbering por shipment + endpoints `GET/POST /v1/shipping/shipments/:id/packages`. Cada paquete con su propio `tracking_code`/dimensiones/peso/status.
  - [x] **Returns/RMA flow** — tablas `returns` + `return_items` (RLS, cascade) con FSM `requested → approved → label_issued → shipped → received → restocked → refunded` (+ `rejected` y `cancelled`). Endpoints `POST /v1/shipping/returns`, `GET`, `:id`, `:id/{approve,reject,cancel,issue-label,shipped,receive,restock,refund}`. Eventos `return.<status>`; `restock` publica `inventory.restock.requested` por SKU recibido en condición `new`/`open_box`; `refund` publica `return.refund.requested` para que splitpay emita el reintegro Stripe.
  - [x] **Insurance, signature required** — columnas `insurance_amount_cents`/`insurance_currency`/`signature_required` en shipments y aceptadas en `POST /v1/shipping/shipments`.

### `disputes` — ✅ funcional
- [x] FSM, mensajes, evidencia, escalation `splitpay.chargeback.created`
- **Falta**:
  - [ ] **SLA timer** (auto-escalate si vendor no responde en 48h)
  - [x] **Auto-refund** integration — `resolve(resolved_buyer)` con `resolution_amount_cents > 0` publica `dispute.refund.requested` (que splitpay consume); `refund_requested_at` previene doble disparo idempotentemente.
  - [x] **Stripe dispute API** sync bidireccional — entrante: `splitpay.chargeback.created` persiste `stripe_dispute_id` en disputes; saliente: `POST /v1/disputes/:id/submit-to-stripe` publica `dispute.evidence.submit` con la evidencia interna que splitpay reenvía a Stripe.
  - [ ] **Templated responses** para vendors

### `catalog` — ✅ funcional pero básico
- [x] CRUD productos
- **Falta**:
  - [ ] **Variants** (talla, color, material) como SKUs derivados
  - [ ] **Bundles** y combos
  - [ ] **Pricing rules** (precio por volumen, promo)
  - [ ] **Search** (Postgres FTS o Elastic)
  - [ ] **Category tree** con jerarquía
  - [x] **Image gallery** — tabla `item_images` con `object_id` (platform_storage) + `display_order`; endpoints `GET/POST /v1/items/:id/images`, `DELETE /:id/images/:imageId`. CDN queda como URL pública del bucket.
  - [ ] **Inventory link** automático al crear producto
  - [x] **Import/export CSV** — `GET /v1/items/export.csv`, `POST /v1/items/import.csv { csv }` con parser de quoted-strings; devuelve `{rowsTotal, inserted, updated, errors}`. Match por `id` para update.
  - [x] **Versioning + draft/published** — columnas `status` (draft|published|archived) + `version_number` + tabla `item_versions` (snapshot append-only); endpoints `PATCH /v1/items/:id/status`, `GET /v1/items/:id/versions`. Snapshot al transicionar a `published`.

### `basket` — ✅ funcional
- [x] Redis-only, expiración, items
- **Falta**:
  - [x] **Merge** carritos — `POST /v1/basket/merge { guestUserId }` suma cantidades item-a-item y borra el guest basket.
  - [ ] **Validación de precio/disponibilidad** en checkout (re-leer catálogo)
  - [x] **Promociones aplicadas** — engine puro `evaluate(basket, promo)` con `percent` (basis points), `fixed_amount`, `free_shipping`; restricciones `minSubtotalCents` + `expiresAt` + `enabled`. Promo store Redis (`basket:promo:<app>:<tenant>:<CODE>`). Endpoints: `GET /v1/basket/summary`, `POST/DELETE /v1/basket/promo`, CRUD staff/admin `GET/PUT/DELETE /v1/basket/promos[/:code]`. La promo aplicada se persiste en el JSON del basket; `summary` la auto-revoca si la definición se deshabilita/borra.
  - [x] **Saved-for-later** — Redis paralelo `basket:saved:…` + endpoints `GET /v1/basket/saved`, `POST /v1/basket/saved`, `POST /v1/basket/saved/:itemId/move-back`, `DELETE /v1/basket/saved/:itemId`.
  - [x] **Abandoned-cart events** — `basket.abandoned` ya emitido por scheduler + ahora hidrata `buyerEmail` via GRANT a auth + plantilla email + sender wired en notifications consumer.

## platform-restaurant (port 3200)

### `menu` — ✅ funcional
- [x] Modifiers, allergens, availability windows, 86-list, eventos
- **Falta**:
  - [x] **Photo upload** a object storage — `photo_object_id` cableado vía `platform/storage` (ADR 008)
  - [ ] **Multi-idioma** menu items (ES/EN/CA/…)
  - [ ] **Nutritional info** + calorías
  - [ ] **Dynamic pricing** (happy hour, surge)
  - [ ] **POS integration** para sync precios

### `reservations` — ✅ funcional
- [x] FSM, waitlist, service hours, blackouts
- **Falta**:
  - [ ] **Auto-asignación de mesa** desde `floor-plan` al confirmar
  - [ ] **No-show tracking** con tarjeta de garantía (Stripe SetupIntent)
  - [ ] **SMS reminders** vía `notifications` (canal SMS no existe aún)
  - [ ] **Suscripción a `notifications`** para recordatorios T-24h y T-2h (no hay scheduler)
  - [ ] **Walk-in vs reservation** diferenciación más rica

### `floor-plan` — ✅ funcional
- [x] Sections, tables, FSM, combine, audit
- **Falta**:
  - [ ] **Editor visual** (drag-drop) — hoy solo coords numéricas
  - [ ] **Heatmap de uso** para análisis
  - [ ] **QR-code generation** por mesa para pedido en mesa
  - [ ] **Auto-table assignment** algoritmo respetando preferencias

### `kds` — ✅ funcional
- [x] Stations, ticket FSM, coursing, eventos
- **Falta**:
  - [ ] **Coursing inteligente** (entrantes salen juntos, principales con offset)
  - [ ] **WebSocket push** a las pantallas — hoy polling
  - [ ] **Bump-bar hardware** integration (USB/Bluetooth)
  - [ ] **Recall ticket** (rectificación)
  - [ ] **Print kitchen ticket** a impresora térmica (ESC/POS)
  - [ ] **Time-to-serve metrics** y alertas si se retrasa

### `pos` — ✅ funcional con bug-fix recién aplicado
- [x] Bills, items, split (equal/percent/amounts), tips, FSM
- **Falta**:
  - [ ] **Llamada real a `payments`/`splitpay`** al hacer payBill — hoy guarda registro pero no cobra
  - [ ] **Cash drawer / opening / closing** flujo
  - [ ] **Print bill** ESC/POS
  - [ ] **Tip pool** distribution rules → liquidación (existe `practitioner-payouts` para sanidad pero no para hostelería)
  - [ ] **Receipt fiscal** firmado para España (TicketBai/VeriFactu/SII)
  - [ ] **Refund flow** post-payment

### `delivery-dispatch` — ✅ funcional pero stub de carriers
- [x] Zones, riders, deliveries, FSM, GPS ping
- **Falta**:
  - [ ] **Integración real con Glovo/UberEats/JustEat/Deliveroo** APIs
  - [ ] **Webhook receivers** para tracking
  - [ ] **Routing optimization** (asignación rider más cercano)
  - [ ] **Live map** con WebSocket para el cliente
  - [ ] **Push notifications** al rider via app móvil
  - [ ] **Polígono geográfico** para zone matching real (hoy es JSON sin lookup)
  - [ ] **ETA calculation** con tráfico real

## platform-appointments (port 3300)

### `services` — ✅ funcional
- [x] CRUD, modality, buffers, cancellation policy
- **Falta**:
  - [ ] **Multi-idioma** name/description
  - [x] **Photo gallery** — tabla `service_images` referenciando `platform_storage.objects.id` con `display_order`; endpoints `GET/POST /v1/services/:id/images`, `DELETE /:id/images/:imageId`.
  - [x] **Pricing tiers** (precio según día/hora) — tabla `service_pricing_tiers` con `days_of_week` + `start_minute`/`end_minute`; engine puro `resolvePrice` (especificidad + ventana más corta gana); endpoint `GET /v1/services/:id/quote?at=<iso>`.
  - [ ] **Bundling con `packages`** automatizado

### `resources` — ✅ funcional
- [x] Practitioners/rooms/equipment, work hours, exceptions, N:M services
- **Falta**:
  - [ ] **Round-robin / load-balancing** entre profesionales (hoy se elige uno)
  - [ ] **Skill matrix** (no todos hacen todo aunque ofrezcan el mismo servicio)
  - [ ] **Vacation request workflow** (request → approve → exception)
  - [ ] **Calendar integrations** (Google Calendar / Outlook two-way sync) — diferido a propósito; ADR 011 fija el diseño (módulo `platform/calendar-sync` con OAuth + webhook receiver + sync engine + token refresher en scheduler). No se complica la plataforma hasta que la demanda lo justifique.

### `bookings` — ✅ funcional con FSM completo
- [x] FSM, recurrence skeleton, reschedule, waitlist, audit
- **Falta**:
  - [x] **Recurrence engine real** — `platform-scheduler/booking-recurrence-expander.job.js` (cron `0 * * * *`) materializa instancias 30 días vista (ADR 007).
  - [x] **Llamada a `availability.holdSlot`** dentro de `createBooking` — `holdId` opcional consumido atómicamente + `insertBookingAtomic` con guard `tstzrange && tstzrange` (commit `c7f547c`).
  - [x] **Reminders schedule** (T-24h, T-2h) — `platform-scheduler/booking-reminders.job.js` (cron `*/5 * * * *`) emite `booking.reminder.due` con `clientEmail`/`clientPhone`/`locale` resueltos.
  - [ ] **No-show tarjeta de garantía** integración con `payments`
  - [ ] **Resource conflict detection** al crear (validación cruzada con `availability`)
  - [x] **Cancellation policy enforcement** — `cancelBooking` lee `services.cancellation_policy` JSONB (`freeUpToMinutes`, `feePercent` / `feeFlatCents`, `graceMinutesAfterCreate`), calcula `feeCents` y publica `booking.fee.charged` para que payments/splitpay cobre. Staff puede saltar con `{ skipPolicy: true }`.

### `availability` — ✅ funcional
- [x] Slot computation, atomic holds via tstzrange
- **Falta**:
  - [x] **Caché Redis** del slot grid — clave `availability:slots:<app>:<tenant>:v<version>:<sigParams>` con TTL 60s; cada hold/release bumpea `availability:rv:<resource>` invalidando la versión.
  - [ ] **Multi-resource consolidation** (cita que requiere médico + sala simultáneos)
  - [x] **Capacity > 1** — `services.capacity` y `resources.capacity` se respetan; `slotCapacity = min(...)`; los slots ahora exponen `capacity` y `remaining` en la respuesta. Bookings/holds suman vs el cap; `exceptions` siguen siendo hard-block.
  - [ ] **Time-zone awareness** (hoy todo UTC; importa para tenants multi-país)
  - [ ] **Hold cleanup background job** (cron) en lugar de cleanup oportunista
  - [x] **Step granularity configurable** por servicio — nueva columna `services.step_minutes` (default 15) leída por `availability.listSlots`.

### `intake-forms` — ✅ funcional
- [x] Templates versioned, submissions, signatures, auto-create on booking.confirmed
- **Falta**:
  - [ ] **Form builder UI** (no hay frontend)
  - [ ] **File upload** para attachments del cliente (storage SDK ya disponible — kind `intake_attachment`)
  - [ ] **Conditional logic** (mostrar pregunta B si A=sí)
  - [x] **PDF export** del cuestionario rellenado — `GET /v1/intake-forms/submissions/:id/pdf` devuelve `application/pdf` generado por `@apphub/platform-sdk/simple-pdf` (Helvetica, multi-página, dep-free).
  - [x] **Digital signature provider real** — `signature_object_id` cableado vía `platform/storage` (kind `signature`, retention 7 años, ADR 008). Para integraciones DocuSign/SignNow real, pendiente.
  - [ ] **HIPAA/GDPR compliance** audit trail completo de accesos a datos clínicos

### `telehealth` — 🔧 stub provider
- [x] Schema, FSM, tokens, auto-provision on booking.confirmed
- **Falta CRÍTICO**:
  - [ ] **Integración real con proveedor** (Daily.co / Twilio Video / Jitsi self-hosted / LiveKit) — hoy genera URLs `telehealth.local` que no existen
  - [ ] **Recording** real con storage encriptado
  - [ ] **Pre-call check** (mic/camera test page)
  - [ ] **Waiting room** para que el médico admita al paciente
  - [ ] **Screen share** para explicar resultados
  - [ ] **Compliance**: cifrado E2E para sanidad, retention policy de grabaciones

### `packages` — ✅ funcional
- [x] Templates, purchase, redeem on booking.completed, refund on cancel
- **Falta**:
  - [ ] **Llamada real a `payments`** al comprar — hoy guarda `price_paid_cents` pero no cobra
  - [x] **Expiry warning emails** (T-30d, T-7d) — `platform-scheduler/package-expiry-warning.job.js` (cron `0 8 * * *`) emite `package.expiring`; el consumer envía email + (opcional) digest.
  - [x] **Family sharing** — tabla `package_authorized_users` (UNIQUE `(package_id, user_id)`); endpoints `GET/POST /v1/packages/purchases/:id/authorized-users`, `DELETE …/:userId`. `redeem()` acepta tanto al owner como a cualquier autorizado.
  - [x] **Transfer / gifting** entre usuarios — `POST /v1/packages/purchases/:id/transfer { toUserId, kind: 'transfer'|'gift', message? }` cambia ownership atómicamente y registra log en `package_transfers`. Lista vía `GET …/transfers`.
  - [x] **Renewal automático** opcional — flags `auto_renew_default` (template) y `auto_renew` + `renewed_from` (purchase). Endpoints `PUT /v1/packages/purchases/:id/auto-renew` y `POST /:id/renew` (clona el template a una purchase nueva). El cron de renovación automática queda como work-item futuro pero la mecánica está lista.

### `practitioner-payouts` — ✅ funcional
- [x] Rules, accruals, close period, mark paid
- **Falta**:
  - [ ] **Integración con `splitpay`** para liquidación automática (hoy se marca paid manualmente con `external_ref`)
  - [x] **Scheduling automático** (cierre de quincena/mes via cron) — `platform-scheduler/practitioner-payout-close.job.js` (cron `0 2 * * *`) emite `payout.period_due` por schedule del tenant.
  - [x] **PDF report descargable** por profesional — `GET /v1/practitioner-payouts/payouts/:id/pdf` (`application/pdf`) con cabecera del periodo + tabla de devengos, generado por `@apphub/platform-sdk/simple-pdf`.
  - [ ] **Tax withholding** (IRPF en España)
  - [ ] **1099/Modelo 347** generation
  - [ ] **Adjustment workflow** (correcciones aprobadas)

## Trabajo transversal que falta en TODA la plataforma

| Área | Estado | Prioridad |
|---|---|---|
| **Scheduler/cron centralizado** | ✅ implementado (`platform-scheduler` port 3400, ADR 007) | — |
| **Object storage** (S3/R2/MinIO) | ✅ implementado (MinIO + `platform/storage`, ADR 008). 2/12 consumidores cableados (`menu`, `intake-forms`); 10 pendientes |
| **WebSocket gateway** para tiempo real | ❌ no hay (ADR 010 deferido) | media — KDS, delivery tracking, messaging, telehealth waiting room |
| **Email/SMS templates editables por tenant** | ✅ DB-backed editables + i18n (ver `notifications`) | — |
| **Observability** (Prometheus + Grafana + Loki) | ❌ solo logs pino | media |
| **Distributed tracing** (OpenTelemetry) | ❌ no | media |
| **Audit log centralizado** cross-módulos | parcial (algunos tienen audit propio) | media |
| **HTTP transport entre contenedores** con auth | ❌ todo Redis events | media |
| **Tests E2E** entre los 4 monoliths | ❌ solo unit + integration por módulo | media |
| **Backup/restore** automatizado de Postgres | ❌ no | alta producción |
| **i18n** | parcial (notifications via `(key,channel,locale)` UNIQUE; resto del UI todavía hardcoded) | alta para mercado ES |
| **Frontend para staff** (voragine-console) | parcial — `staff/*` cubierto, suficiente para roadmap actual | media |
| **Frontend para tenants** (tenant-console nueva) | ❌ no existe; ver bloque dedicado abajo | alta |

## tenant-console (frontend per-tenant, modular)

Consola de administración que cada tenant accede en su `<tenant>.apphub.com` (o
custom domain). voragine-console se queda **únicamente con `staff/*`** — el rol
`owner`/`admin` deja de servirse desde allí cuando esta nueva app esté
operativa. Se monta dinámicamente: cada `platform/<modulo>` aporta un
**manifest** con `dashboardCards` + `sidebar` + `routes`; el shell carga sólo
los manifests cuyo `capability` está en `apps.enabled_modules` del tenant.

UX híbrida — dashboard de cards (resumen + atajos) en `/`, sidebar agrupado
por categoría operativa (Negocio · Operaciones · Comercial · Conversaciones ·
Configuración) para navegación profunda. La metáfora "microservicio" no se
filtra al usuario.

### Fase 0 — Fundaciones (un commit)
- [ ] Migración `tenant-config/000N_app_enabled_modules.sql` — añade
  `enabled_modules TEXT[] NOT NULL DEFAULT '{}'` a `platform_tenants.apps` y
  semilla los sets actuales (`yoga-studio`, `aikikan`, `split-pay`, `bastardo`).
- [ ] Endpoint `GET /v1/apps/:appId` ya devuelve la fila — añadir
  `enabled_modules` al payload (campo nuevo en el DTO).
- [ ] Bootstrap del app `apps/tenant-console/tenant-console-portal/` (puerto
  5178) siguiendo el flow "Bootstrap app `<name>`" de CLAUDE.md.
- [ ] Upstream NGINX + server block dinámico (sidecar Redis) cuando se
  registre el app en `platform_tenants.apps`.

### Fase 1 — Shell genérico
- [ ] `src/shell/` con: `App.jsx`, `Sidebar.jsx`, `Topbar.jsx`,
  `DashboardGrid.jsx`, `lib/{api,auth,context,icons}`, `ManifestLoader.jsx`.
- [ ] Sidebar renderiza por categorías predefinidas (Negocio · Operaciones ·
  Comercial · Conversaciones · Configuración + Inicio). Categorías sin módulos
  activos no se renderizan.
- [ ] DashboardGrid invoca `manifest.dashboardCards[].summary(api)` en paralelo
  con `Promise.allSettled`; cards con error se renderizan en estado de fallo
  sin tirar el resto.
- [ ] Lazy-load por manifest (Vite code-split). Un manifest cuyo módulo no está
  en `enabled_modules` no se carga.
- [ ] Carga del idioma per-tenant desde `tenant.default_locale` (ya existe la
  columna).

### Fase 2 — Migración del rol tenant existente
**No tocar voragine-console** — solo replicar las views ahí presentes en la
nueva app, manteniendo voragine-console intacto hasta que la migración sea
1:1. Las vistas a portar:
- [ ] `views/tenant/Overview.jsx` → manifest `tenants` (Inicio).
- [ ] `views/tenant/Settings.jsx` → manifest `tenants` (Configuración ·
  Identidad). Ya incluye `default_locale`.
- [ ] `views/tenant/Admins.jsx` → manifest `auth` (Configuración ·
  Administradores).
- [ ] `views/tenant/Email.jsx` (que ya usa `EmailDomainsManager.jsx`
  compartido) → manifest `notifications` (Configuración · Email domains).
- [ ] `views/tenant/Splitpay.jsx` → manifest `splitpay` (solo si
  `app.splitpay_enabled`).
- [ ] `views/tenant/Audit.jsx` → manifest `audit` (Configuración).
- [ ] `views/tenant/Danger.jsx` → manifest `tenants` (Configuración · Zona
  peligrosa).

`EmailDomainsManager.jsx` ya está extraído a `components/`; copiarlo / mover
al shell de tenant-console como pieza compartida con voragine-console (vía
`packages/`?) — decisión a tomar al portarlo.

### Fase 3 — Manifests nuevos por módulo (orden por valor/coste)
- [ ] `notifications` — Plantillas editables per-tenant (cuando exista la
  feature DB-side; hoy son globales). Email domains ya cubierto.
- [ ] `basket` — CRUD de promo codes (`Comercial · Promociones`). Reusa los
  endpoints `GET/PUT/DELETE /v1/basket/promos[/:code]` ya existentes.
- [ ] `services` — editor con tabs (Identidad · Pricing tiers · Cancelación ·
  Galería de imágenes). Conecta a las features de `appointments` (commit
  `290114d`).
- [ ] `bookings` — listado de reservas con filtros + detalle + acciones
  (cancel con cancellation policy enforcement, reschedule).
- [ ] `availability` — slot grid visualizado (read-only por ahora).
- [ ] `packages` — CRUD plantillas + auditoría de transfers / family sharing
  / auto-renew (read-only para staff/owner; las acciones las hace el cliente
  desde el portal del cliente).
- [ ] `orders` — listado + detalle + modifications log + buttons (cambiar
  status, cambiar dirección, añadir nota).
- [ ] `inventory` — listado SKU + variants editor (compacto).
- [ ] `shipping` — devoluciones (Operaciones · Devoluciones), shipments,
  multi-package, log de webhook receivers (read-only).
- [ ] `disputes` — listado + detalle + botón "Submit evidence to Stripe"
  (consume el endpoint `POST /v1/disputes/:id/submit-to-stripe`).
- [ ] `reviews` — moderación (`pending → published/hidden`).
- [ ] `messaging` — listado de threads (real-time queda en ADR 010 deferido).
- [ ] `catalog` — listado + editor de items + image gallery + import/export
  CSV (botones que pegan a los endpoints existentes).
- [ ] `intake-forms` — listado de submissions + descarga PDF (endpoint
  ya existe).
- [ ] `practitioner-payouts` — listado + descarga PDF + filtro por periodo.
- [ ] `telehealth` — listado de salas activas (read-only).
- [ ] `splitpay` — heredada de voragine-console; mismo flujo de Stripe Connect
  pero scopeado al propio tenant (sin `?tenantId=…` query).

### Fase 4 — Despliegue + cutover
- [ ] DNS / nginx multi-host: cada tenant servido en
  `<tenant.subdomain>.apphub.com` redirige a tenant-console-portal.
- [ ] Login flow per-tenant: el JWT válido en voragine-console como
  `owner`/`admin` debe valer en tenant-console (mismo `appGuard`, mismo JWT
  secret).
- [ ] Cutover: voragine-console deja de servir el rol owner/admin (App.jsx
  branch para `role !== 'staff'` redirige a `<tenant>.apphub.com`).
- [ ] Documentación: ADR-012 con la decisión de la consola separada.

### Decisiones diferidas (cuando hagan falta)
- **Custom domains de tenants** — hoy `subdomain.apphub.com`; cuando un tenant
  quiera `admin.bastardo.com`, ya está la columna `tenants.custom_domain`.
- **Per-tenant feature flags** (subset de `enabled_modules` desactivable per
  tenant) — `enabled_modules` cubre el caso "qué módulos tiene el app"; el
  override per-tenant es trabajo aparte que ya está en TODO de
  `tenant-config`.
- **Sub-tenants** — estructura ya soportada en JWT; la UI de cambiar de
  sub-tenant entra como pieza del shell cuando el primer tenant la pida.

## Top 10 prioridades por impacto

1. [x] **Scheduler/cron** — desbloquea recurrencias, recordatorios, expiry, close-period en 5+ módulos
2. [x] **Object storage** — MinIO + `platform/storage` cableado (ADR 008); 2/12 consumidores cableados (`menu`, `intake-forms`); 10 pendientes
3. [ ] **`payments` real** — `pos.payBill`, `packages.purchase`, `bookings.deposit` no cobran
4. [ ] **`telehealth` provider real** — el stub no funciona en producción
5. [x] **SMS channel en `notifications`** — recordatorios de citas/reservas.
   Twilio cliente con dev-stub fallback, configuración en voragine-console
   (Account SID + API Key + Messaging Service SID), `templates UNIQUE(key,channel)`,
   plantillas SMS sembradas para `booking.reminder.due` y `reservation.reminder.due`,
   columnas `phone_*` en `platform_auth.users`, event-consumer enchufa SMS cuando
   el payload trae `clientPhone`/`guestPhone` (los jobs `booking-reminders` y
   `reservation-reminders` del scheduler ya los hidratan). Smoke-test endpoint
   `POST /v1/notifications/admin/sms/test`.
6. [ ] **Carriers reales en `shipping`/`delivery-dispatch`**
7. [x] **`reviews` verified-purchase HTTP cross-container** — ADR 009; `verified_purchase` flag + `verifiedOnly` filter + `verified_count` aggregate
8. [x] **Recurrence expander en `bookings`** — `platform-scheduler` lo materializa (ADR 007)
9. [x] **Hold-on-create en `bookings.create`** (evitar double-booking) — `holdId`
   opcional consumido atómicamente dentro de la transacción + `insertBookingAtomic`
   con `tstzrange && tstzrange` por recurso como red de seguridad. 409 cuando
   el slot ya está tomado o el hold no coincide. Tests unit (5 nuevos) +
   integration (overlap rechazado, cancelado libera slot).
10. [x] **Email templates editables + i18n** en `notifications`. Plantillas
    ya editables desde `voragine-console > Configuración > Plantillas`. i18n:
    columna `locale` en `templates` con UNIQUE `(key, channel, locale)` y
    fallback a `'es'` cuando el locale pedido no existe. 8 plantillas
    sembradas en `en` (6 email + 2 sms). Senders aceptan `locale` opcional;
    el event-consumer lo extrae de `event.payload.locale`. UI: filtro por
    locale + botón "+ Locale" para clonar una plantilla a otro idioma + edit
    form con campo `locale`.
