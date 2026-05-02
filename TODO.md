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
| **Backup/restore** automatizado de Postgres | ❌ no — implementar ahora (ver subitems abajo) | alta producción |
| **Pool RO opcional** (`DATABASE_URL_RO` con fallback) | ❌ no — implementar ahora (subitems abajo) | baja hoy, deja el cluster trivial cuando llegue |
| **i18n** | parcial (notifications via `(key,channel,locale)` UNIQUE; resto del UI todavía hardcoded) | alta para mercado ES |
| **Frontend para staff** (voragine-console) | parcial — `staff/*` cubierto, suficiente para roadmap actual | media |
| **Frontend para tenants** (tenant-console nueva) | ❌ no existe; ver bloque dedicado abajo | alta |

### Pre-cluster: los dos cambios que sí hacemos ahora

Ambos quitan deuda de producción real y, cuando se decida activar el
bloque HA, reducen el coste de implementarlo de ~7 días a ~2-3.

**Backup/restore de Postgres — 3 niveles defense-in-depth (alta · producción)**

La estrategia es **3-2-1**: 3 copias, 2 tipos de soporte, 1 fuera de la
infraestructura primaria. Cada nivel cubre un modo de fallo distinto.

*Nivel 1 — PITR (Point-In-Time Recovery) continuo. RPO <1 min · RTO ~30 min.*
- [ ] Job en `platform-scheduler`: `postgres-basebackup` (cron `0 3 * * 0`,
  domingos 3am). Ejecuta `pg_basebackup -F tar -z` y sube al bucket
  `apphub-backups/postgres/<date>.tar.gz.enc` vía `@aws-sdk/client-s3`.
- [ ] WAL archiving continuo: configurar `archive_mode=on`,
  `archive_command='aws s3 cp %p s3://apphub-backups/wal/%f'`. Cubre el
  caso "DELETE sin WHERE hace 12h, restaurar al segundo previo".
- [ ] Retención: lifecycle rule en MinIO — basebackups 90 días, WAL 14
  días. Definir en `infra/minio/init/buckets.json`.

*Nivel 2 — Off-host volumétrico. RPO 24h · RTO ~1h.*
- [ ] El propio MinIO ya está fuera del proceso Postgres → cubre fallos
  del proceso DB. Asegurar que el bucket vive en **otro disco/volumen**
  que el data dir de Postgres (en `docker-compose.yml`, `minio_data` ya
  es volumen separado de `postgres_data` ✓).
- [ ] **Cuando se haga el split a varios hosts** (bloque HA), mover el
  bucket de backups a un host distinto del primary. Marcar dependencia
  cruzada en el ADR-017 ("cluster en una caja").

*Nivel 3 — DR del proveedor / cross-region. RPO 24h-7d · RTO horas.*
- [ ] **Hetzner Cloud Backups activados** en el panel (1 click, +20%
  coste del servidor). Snapshot semanal del disco entero, retención 7
  imágenes. Cubre "host se incendia / fs corruption / kernel panic".
- [ ] `mc mirror` daily del bucket `apphub-backups` → bucket externo
  (Backblaze B2 o AWS S3 Glacier). Cubre "cuenta Hetzner comprometida o
  región caída". ~$5/mes para decenas de GB. Diferible hasta primer
  cliente con SLA contractual, pero documentar la decisión cuando
  llegue.

*Cross-cutting (no opcional, audit blockers):*
- [ ] **Cifrado en reposo**: `pg_basebackup` → pipe `gpg -c` con clave
  AES-256 antes de subir; o usar SSE-S3 server-side encryption en el
  bucket. La clave/passphrase **nunca** en el mismo bucket — sólo en el
  secret manager (`PLATFORM_CONFIG_ENCRYPTION_KEY` ya existe; añadir
  `BACKUP_ENCRYPTION_KEY`).
- [ ] **Cifrado en tránsito**: TLS para todas las transferencias
  S3/MinIO. Hoy MinIO local usa HTTP en docker network — aceptable
  *dentro* del host; al hacer cross-region exigir HTTPS endpoint.
- [ ] **Inmutabilidad / object-lock** en el bucket de backups (MinIO
  soporta `mc retention set`). Un atacante con creds no puede borrar
  backups antes de que expiren. Auditor SOC 2 lo va a pedir.
- [ ] **Control de acceso**: rol IAM/MinIO `backup-writer` (solo
  PUT/HEAD), `backup-reader` (solo GET, restore-only), separados de las
  creds que usa la app. Nadie tiene DELETE excepto un job
  administrativo que pasa por el log.
- [ ] **Runbook `docs/runbooks/postgres-restore.md`**: cómo restaurar de
  un basebackup + replay de WAL hasta un timestamp dado, paso a paso,
  con un humano cronometrando. Sin runbook practicado, RTO real = 6×
  RTO teórico.
- [ ] **Smoke test mensual**: cron que descarga el último backup, lo
  restaura en un container efímero, ejecuta `SELECT count(*) FROM
  platform_tenants.tenants` y reporta. **Sin smoke test el backup no
  existe.** El reporte se archiva como evidencia para auditoría.
- [ ] **Política escrita**: `docs/policies/backup-recovery.md` con RPO
  y RTO declarados, frecuencias, retención, encargados. Una página.
  Lo va a pedir cualquier auditor literalmente palabra por palabra.

**Pool RO opcional con fallback (baja hoy, paga después)**
- [ ] `@apphub/platform-sdk/db`: añadir `createPoolRO(url)` que si la
  env var no está, devuelve el pool principal. Cambia 0 callers cuando
  no hay réplica.
- [ ] Cada `platform/<modulo>/src/server.js` (o el `register` del
  módulo) instancia `db` y `dbRo`, pasa ambos a las repos. Empezar por
  los read-paths más pesados (catalog list, audit log, dashboard
  summaries) y dejarlos como `dbRo`; el resto puede seguir usando `db`.
- [ ] `.env.example`: documentar `DATABASE_URL_RO` por módulo
  (`DATABASE_URL_RO_AUTH`, `DATABASE_URL_RO_CATALOG`, …) con default
  vacío = usa el primary.
- [ ] Cuando llegue el momento del cluster, el cambio total es: levantar
  el replica + setear las env vars. Cero refactor de código.

## Compliance baseline — preparación para auditoría

No tenemos auditor encima hoy, pero el primer cliente enterprise
(SOC 2 Type II), el primer auditor GDPR/AEPD, o cualquier inversor en
Series A pedirá los mismos controles. **Hacerlos progresivamente desde
ahora cuesta 5-10× menos que rehacerlos contra reloj cuando llegue el
deadline**. Todos son items pequeños sueltos — el valor compound viene
de tenerlos todos cuando suena el teléfono.

**Triggers que activan la auditoría real:**
- Primer cliente B2B enterprise con cuestionario CAIQ/SIG (SOC 2 Type II
  exigido); 6 meses prep, $15-50k/año al auditor.
- Inversor Series A: due-diligence técnica + pen-test.
- Denuncia GDPR a la AEPD: te toca demostrar Art. 32 (medidas técnicas
  apropiadas) en <30 días.
- Vendor con datos médicos pidiendo BAA HIPAA (telehealth).

**Política / documentación (cada doc = 1-2 páginas, no más)**
- [ ] `docs/policies/backup-recovery.md` — ya listado arriba. RPO/RTO
  declarados, frecuencias, encargado.
- [ ] `docs/policies/access-control.md` — quién tiene acceso a qué (DB
  superuser, Hetzner panel, MinIO admin, Stripe dashboard, GitHub repo
  admin). Revisión trimestral documentada.
- [ ] `docs/policies/incident-response.md` — qué se considera incidente,
  quién es on-call, cuándo se notifica al cliente (GDPR Art. 33: 72h
  para data breach), template de post-mortem.
- [ ] `docs/policies/data-retention.md` — qué se borra y cuándo. Hoy hay
  archived_at en tenants pero no purga real. Definir TTL por tipo de
  dato (audit log infinito, sessions 30d, logs 90d, …).
- [ ] `docs/policies/vendor-list.md` — sub-procesadores (Stripe,
  Hetzner, SendGrid, Twilio, etc.) con qué dato les llega y BAA/DPA
  firmado. GDPR Art. 28 lo exige nominalmente.

**Controles técnicos (palancas con código)**
- [ ] **Cifrado en reposo cubierto end-to-end**: ya lo está la DB de
  config (`PLATFORM_CONFIG_ENCRYPTION_KEY`); extender a backups
  (`BACKUP_ENCRYPTION_KEY`); auditar que no quedan secretos en plano
  en `.env` versionados o logs.
- [ ] **TLS interno entre containers** (cuando se haga el split de
  hosts): hoy es docker network, vale; en multi-host pasar a TLS o
  Tailscale/WireGuard. Documentar la decisión.
- [ ] **Audit log inmutable**: `platform_tenants.audit_log` ya existe
  pero permite UPDATE/DELETE al rol. Añadir `REVOKE UPDATE, DELETE` y
  particionar por mes para que la retención sea dropear partition.
- [ ] **MFA obligatoria para super_admin/staff**: `auth` ya tiene 2FA
  field; hacer enforced para roles privilegiados.
- [ ] **Logging de accesos administrativos**: cada acción de staff que
  toque datos de un tenant debe quedar en audit log con `actor_user_id`
  + `actor_role`. Mayoría hecho; auditar gaps.
- [ ] **Pen-test anual**: presupuesto reservado, $5-15k a una boutique
  (Cobalt, Bishop Fox para SOC 2, OWASP-aligned tester para EU). El
  reporte es deliverable obligatorio del SOC 2 Type II.
- [ ] **Vulnerability scanning continuo** de dependencias: GitHub
  Dependabot ya viene con repos pública; activarlo + Snyk/Trivy en CI
  para imágenes Docker. Auditor lo da por sentado.

**Procesos (los olvidados)**
- [ ] **Onboarding/offboarding de empleados**: checklist con accesos
  que se conceden/revocan. Hoy somos pocos; cuando seamos 5+ esto se
  pierde sin checklist.
- [ ] **Revisión trimestral de accesos**: alguien (yo) repasa quién
  tiene qué y firma. Bullet point en calendario.
- [ ] **Tabletop exercise anual**: simular un incidente (data breach,
  ransomware, fuga de creds) y ejecutar el incident-response. Lección
  aprendida → mejora del runbook. Auditor lo pregunta.
- [ ] **DPIA** (Data Protection Impact Assessment) para features
  sensibles: telehealth, intake-forms (datos médicos en algunos casos),
  practitioner-payouts (datos fiscales). Plantilla AEPD existe.

## HA / clustering de la infra compartida — **DIFERIDO hasta señal de necesidad**

Hoy `postgres`, `redis`, `nginx` y `minio` corren como single-instance en
`docker-compose.yml`. Este bloque queda **diferido**: la decisión es
**no** clusterizar antes de tiempo. Razones:
- No hay carga ni SLA que lo justifique (single-node aguanta órdenes de
  magnitud por encima del tráfico actual).
- HA en una sola caja no es HA real — si el host cae, todas las réplicas
  caen. La validación tiene valor, pero pequeño hasta que se trasladen a
  hosts separados (donde aparecen los problemas reales: DNS interno,
  latencia, particiones).
- Algunos cambios envejecen mal (migrar a Sentinel hoy puede chocar con
  un rewrite a Redis Cluster en V2).

**Triggers para activar este bloque** (cualquiera basta):
- p99 queries > 100 ms sostenido, o `tup_returned` creciendo > 50% mes a mes.
- Primer cliente con SLA contractual (>99.5%) o auditor pidiendo plan DR.
- Segundo incidente en 6 meses por single point of failure.
- > 50 tenants activos o > 1 GB/día de tráfico.

**Lo que SÍ hacemos ahora** (movido al bucket activo de "Trabajo
transversal" arriba): backup automatizado de Postgres a MinIO + pool RO
opcional con fallback. Esos dos quitan deuda de producción real y
dejan el cluster trivial cuando llegue la hora.

El detalle por componente queda capturado abajo como referencia para
cuando se reactive — no es trabajo en cola.

### Postgres — primary + standby (streaming replication)

- [ ] Añadir servicio `postgres-replica` en `docker-compose.yml` con la
  misma imagen `postgres:16-alpine`, su propio volumen
  (`postgres_replica_data`) y env `POSTGRES_PRIMARY_HOST=postgres`. Boot
  arranca con `pg_basebackup -h postgres -U replicator -D /var/lib/postgresql/data -X stream` antes de `docker-entrypoint`.
- [ ] Crear el rol `replicator` con `REPLICATION` en
  `infra/postgres/init/00_replication.sql`; añadir entrada en
  `pg_hba.conf` para la red `apphub_default`.
- [ ] Configurar el primary con `wal_level=replica`, `max_wal_senders=10`,
  `wal_keep_size=512MB`, `synchronous_commit=on`,
  `synchronous_standby_names='replica1'` (sync) o dejarlo async para
  empezar. Documentar tradeoff RPO en el ADR.
- [ ] Healthcheck del replica que verifica
  `SELECT pg_is_in_recovery()` y lag (`pg_last_wal_receive_lsn()` vs
  `pg_last_wal_replay_lsn()`).
- [ ] Variable `DATABASE_URL_RO` en cada módulo (read-only pool apuntando
  al replica). Empezar con un puñado de read-paths obvios (catalog
  list, audit log, dashboard summaries) para no acoplarlo todo en V1.
- [ ] Backup/restore: `pg_basebackup` → S3/MinIO desde un cron del
  scheduler; `wal-g` o `barman` se evalúan en V2. Archivar los WAL al
  bucket `apphub-backups`.
- [ ] Failover playbook: `pg_promote()` en el replica + repunte
  manual del `DATABASE_URL` master en `.env` y `docker compose up -d`.
  Failover automático (`patroni` / `pg_auto_failover`) queda fuera de
  V1; documentar que V1 es manual.
- [ ] ADR-013: "Postgres primary + 1 standby async". Recoge: por qué no
  multi-master, por qué async, qué se replica (todo el cluster),
  RPO/RTO esperados, hooks para pasar a sync.

### Redis — replication + Sentinel (HA con failover automático)

- [ ] Servicios `redis-replica` (1 instancia para empezar) y `sentinel`
  (mínimo 3 para quórum, todos en compose). Imagen `redis:7-alpine`.
- [ ] Config `redis.conf`: `replicaof redis 6379`, `replica-read-only yes`.
  Sentinel: `sentinel monitor apphub redis 6379 2`, `down-after-milliseconds 5000`,
  `failover-timeout 60000`, `parallel-syncs 1`.
- [ ] Healthcheck del replica que valida `INFO replication | grep role:slave`.
- [ ] Migrar todos los clientes `ioredis` a constructor Sentinel:
  `new Redis({ sentinels: [...], name: 'apphub' })`. Añadir
  `REDIS_SENTINELS` a `.env.example` (`redis:26379,sentinel-2:26379,sentinel-3:26379`).
  Mantener compat con `REDIS_URL` para entornos sin Sentinel (tests).
- [ ] Audit del uso actual de Redis: pub/sub (cross-module events),
  rate-limit (`@fastify/rate-limit`), nginx config hash, idempotency
  keys de Stripe, basket/holds. Verificar que cada uno tolera la
  pérdida transitoria durante el failover (re-suscribir pub/sub al
  reconnect, etc).
- [ ] Persistencia: AOF `everysec` + RDB cada 5 min, ambos al volumen
  por instancia. Reproducir el set en cada réplica para que fallback
  sin pérdida sea factible.
- [ ] ADR-014: "Redis replicación + Sentinel". Tradeoffs vs Cluster
  (sharding) — descartado para V1 porque ningún workload llega al
  límite de una instancia, complica pub/sub cross-slot, y forces a
  rewrite de todos los `KEYS`/`SCAN` patterns.

### NGINX — gateway activo/activo (multi-instance + LB del host)

- [ ] Replicar el servicio `nginx` a 2 instancias (`nginx-1`, `nginx-2`)
  con la misma config; el sidecar Redis-driven ya soporta múltiples
  consumidores del mismo hash, así que ambos convergen al mismo
  estado en <2s. Exponer puerto 8080 sólo desde un load balancer
  delante (HAProxy o un tercer NGINX en modo `stream`/`upstream`).
- [ ] Container `gateway-lb` (HAProxy o `nginx:alpine`) con healthchecks
  HTTP a `/health` de cada nginx; pesos iguales, `leastconn`. Stickiness
  no hace falta — todos los portales son JWT-stateless.
- [ ] Validar que la rate-limit zone (`limit_req zone=api`) sigue siendo
  útil siendo per-instance. Si se considera crítico aplicar el límite
  globalmente, mover el rate-limit a un middleware de Redis
  (`@fastify/rate-limit` + Redis store en cada monolito) y desactivar
  el de NGINX. Decisión: mantenerlo per-instance en V1; el
  rate-limit de los monolitos ya hace de cinturón global.
- [ ] WebSocket sticky: cuando WS entre (ADR 010 deferido), añadir
  `ip_hash` o `hash $arg_session_id consistent` en el LB para que la
  conexión persista a la misma nginx-N. Hoy no aplica.
- [ ] ADR-015: "NGINX gateway activo/activo". Recoge cómo ambos
  consumen del mismo hash Redis y por qué eso reemplaza el patrón
  master/standby (sidecar polling = consensus eventual sin coordinador).

### MinIO — distributed mode (4 nodos mínimo, erasure coding)

- [ ] Sustituir el servicio `minio` single-node por 4 servicios
  `minio-1` … `minio-4` con un volumen propio cada uno y arg
  `minio server http://minio-{1...4}/data`. MinIO requiere mínimo 4
  drives (en Docker, 4 contenedores) para erasure coding.
- [ ] Cliente apunta a un alias DNS round-robin
  (`minio-1,minio-2,minio-3,minio-4`) o a un mini-LB delante. La SDK
  `@aws-sdk/client-s3` reintenta sola en 503/IO, así que round-robin
  basta.
- [ ] Migración de datos: `mc mirror` desde la instancia single-node
  actual al cluster nuevo, antes de cambiar `OBJECT_STORAGE_ENDPOINT`
  en `.env`. Validar que `platform/storage` y los 2 consumidores
  (menu, intake-forms, reviews) siguen funcionando con presigned URLs.
- [ ] Healthcheck distribuido: `mc admin info`. Marcar el primer error
  como warning (cluster con un drive caído sigue sirviendo si el
  parity permite).
- [ ] Backup: lifecycle rules a un bucket secundario (cold) o
  cron `mc mirror minio backup-target/` por sched-platform.
- [ ] ADR-016: "MinIO distributed mode 4×1". Recoge la decisión de
  empezar con 4 nodos paritarios (EC:2) en vez de pasar directamente
  a 8 (EC:4); el upgrade es no-disruptivo via `mc admin decommission`.

### Cross-cutting

- [ ] `docker-compose.yml` crece bastante: separar en
  `docker-compose.yml` (apps + monolitos) +
  `docker-compose.infra.yml` (postgres replica, redis replica + 3
  sentinels, 4 minio, 2 nginx + LB). Documentar el orden de boot:
  `docker compose -f docker-compose.infra.yml up -d` antes del
  resto. Healthchecks + `depends_on: { condition: service_healthy }`
  garantizan que platform-core no arranca hasta que el primary
  postgres y el quórum sentinel estén verdes.
- [ ] Tests de chaos manuales: matar primary postgres, matar 1 nginx,
  matar 2 sentinels (mantener quórum), matar 1 minio (debe seguir
  sirviendo), verificar que la app sigue respondiendo. Documentar
  cada experimento en `docs/runbooks/`.
- [ ] Variables `.env.example` — añadir `DATABASE_URL_RO`,
  `REDIS_SENTINELS`, `OBJECT_STORAGE_ENDPOINTS` (lista). Mantener
  defaults single-node para que `pnpm dev` siga funcionando sin el
  cluster levantado.
- [ ] ADR-017: "Layout 'cluster en una caja'". Justifica por qué la V1
  HA arranca con todos los nodos en la misma máquina (validar
  topología, runbooks, healthchecks) antes de trasladarlos a hosts
  separados; el rewrite del compose-file ya deja la cuenta lista para
  hacer split en 2-3 hosts moviendo `services.<x>.networks` y
  exponiendo puertos.

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

### Fase 0 — Fundaciones (commit `90e1189`) ✅
- [x] Migración `platform/tenant-config/migrations/0006_app_enabled_modules.sql`
  — añade `enabled_modules TEXT[] NOT NULL DEFAULT '{}'` a `platform_tenants.apps`
  y semilla los sets actuales (`yoga-studio`, `aikikan`, `split-pay`,
  `voragine-console`).
- [x] Endpoint `GET /v1/apps/:appId` y `GET /v1/apps` devuelven `enabled_modules`
  en el payload. Nuevo `PUT /v1/apps/:appId/enabled-modules { modules: string[] }`
  para que staff edite el set sin tocar SQL.
- [x] Bootstrap del app `apps/tenant-console/tenant-console-portal/` (puerto 5178)
  con `package.json` / `vite.config.js` (allowedHosts incluye `.apphub.local`
  wildcard para per-tenant subdomains) / `Dockerfile` (dev + nginx-alpine prod).
- [x] Upstream NGINX (`infra/nginx/conf.d/upstream.conf` + `upstream.prod.conf`)
  y seed `infra/nginx/seed/tenant-console.conf`. Server block per-tenant ya se
  renderea dinámicamente desde Redis vía `tenant-config/nginx-config.service.js`.
- [x] Producción: commit `e432ade` añade el bloque `tenant-console-portal` a
  `docker-compose.prod.yml` (target=production, sin port mapping, sin volumes —
  baked dist/) y el upstream prod paralelo.

### Fase 1 — Shell genérico (commit `529d737`) ✅
- [x] `src/shell/` con `App.jsx` / `Sidebar.jsx` / `Topbar.jsx` /
  `DashboardGrid.jsx` / `LoginView.jsx` / `ManifestLoader.js` +
  `lib/{api,auth,categories,context,icons}`.
- [x] Sidebar renderiza por categorías predefinidas (Inicio + Negocio /
  Operaciones / Comercial / Conversaciones / Configuración). Categorías sin
  entradas no se renderizan.
- [x] `DashboardGrid` invoca cada `manifest.dashboardCards[].summary(api)` en
  paralelo con `Promise.allSettled`; cards con error se renderizan en estado
  de fallo sin tirar el resto.
- [x] Lazy-load por manifest vía `import.meta.glob('../modules/*/manifest.jsx')`
  con `eager:false`. Un manifest cuyo `id` no está en `enabled_modules` no se
  carga.
- [x] Primer manifest cableado: `notifications` con `EmailDomainsView`
  reutilizando el `EmailDomainsManager` (copiado de voragine-console; las
  imports apuntan a `../shell/lib`).
- [ ] Carga del idioma per-tenant desde `tenant.default_locale` (la columna
  existe; el shell todavía no usa el valor — pendiente de wiring i18n
  cuando entren más manifests).

### Fase 2 — Migración del rol tenant existente ✅
**No tocar voragine-console** — solo replicar las views ahí presentes en la
nueva app, manteniendo voragine-console intacto hasta que la migración sea
1:1. Las vistas a portar:
- [x] `views/tenant/Overview.jsx` → manifest `tenants` (Inicio).
- [x] `views/tenant/Settings.jsx` → manifest `tenants` (Configuración ·
  Identidad). Ya incluye `default_locale`.
- [x] `views/tenant/Admins.jsx` → manifest `auth` (Configuración ·
  Administradores).
- [x] `views/tenant/Email.jsx` (que ya usa `EmailDomainsManager.jsx`
  compartido) → manifest `notifications` (Configuración · Email domains).
  *(hecho en Fase 1)*
- [x] `views/tenant/Splitpay.jsx` → manifest `splitpay` (solo si
  `app.splitpay_enabled`).
- [x] `views/tenant/Audit.jsx` → manifest `audit` (Configuración).
- [x] `views/tenant/Danger.jsx` → manifest `tenants` (Configuración · Zona
  peligrosa).

Manifest seed: migración `0007_baseline_tenant_console_modules.sql`
añade `tenants`, `auth`, `audit`, `notifications` a `enabled_modules` en
todas las apps tenant-facing, y `splitpay` solo donde `splitpay_enabled = TRUE`.

`EmailDomainsManager.jsx` ya está extraído a `components/`; copiarlo / mover
al shell de tenant-console como pieza compartida con voragine-console (vía
`packages/`?) — decisión a tomar al portarlo.

### Fase 3 — Manifests nuevos por módulo (orden por valor/coste) ✅
Primer pase: cada módulo del registro (excepto `notifications`-templates,
deferido a feature DB-side) tiene manifest + view de listado/edición
mínima viable. Las views priorizan listar + acción puntual; UX más
profundo se itera después.
- [ ] `notifications` — Plantillas editables per-tenant (deferido — la
  feature DB-side todavía no existe; hoy son globales). Email domains
  cubierto en Fase 1.
- [x] `basket` — CRUD de promo codes (`Comercial · Promociones`).
- [x] `services` — editor con tabs (Identidad · Pricing tiers ·
  Cancelación · Galería).
- [x] `bookings` — listado con filtro de status + cancelar.
- [x] `availability` — slot grid read-only por servicio.
- [x] `packages` — listado de plantillas (compras read-only).
- [x] `orders` — listado + cambio de status inline.
- [x] `inventory` — listado SKU + edit on-hand inline.
- [x] `shipping` — tabs Devoluciones (aprobar) · Zonas y tarifas.
- [x] `disputes` — listado + botón "Submit evidence to Stripe".
- [x] `reviews` — moderación (`pending → published/hidden`).
- [x] `messaging` — listado de threads (real-time deferido en ADR 010).
- [x] `catalog` — listado + cambio de status + export CSV.
- [x] `intake-forms` — listado de plantillas (PDF de submissions vía API).
- [x] `practitioner-payouts` — listado + filtro por periodo + PDF.
- [x] `telehealth` — listado read-only de bookings virtuales con sala.
- [x] `splitpay` — ya cubierto por Fase 2 (`platform/splitpay`, scopeado
  al tenant del JWT).

### Fase 4 — Despliegue + cutover ✅
- [x] DNS / nginx multi-host: cada tenant servido en
  `<tenant.subdomain>.apphub.{local,com}` proxiea a `tenant_console_portal`.
  Implementado vía `writeTenantNginxConfig` (sidecar Redis + backfill al
  arrancar platform-core).
- [x] Login flow per-tenant: el JWT del rol owner/admin se emite en
  `POST /v1/auth/login` y vale en cualquier host (subdomain del tenant o
  `tenant-console.*` genérico). El shell resuelve subdomain → tenant vía
  `GET /v1/tenants/by-subdomain/:subdomain` (público) y enseña una banner
  si el JWT no coincide con el host.
- [x] Cutover: voragine-console muestra `TenantHandoff` cuando
  `role !== 'staff'`, con CTA al subdomain del propio tenant. No hace hard
  redirect — preserva back/forward y URL bar.
- [x] Documentación: ADR-012 (`docs/adr/012-tenant-console-multi-host-routing.md`).

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
