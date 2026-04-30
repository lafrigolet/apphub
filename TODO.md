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
  - [ ] **SMS** (Twilio/MessageBird) — restaurant/appointments lo necesitan para recordatorios
  - [ ] **Push notifications** (FCM/APNs) — no hay
  - [ ] **WhatsApp Business API**
  - [ ] **Plantillas versionadas y editables por tenant** — hoy hardcoded
  - [ ] **i18n** de plantillas (ES/EN/CA/…)
  - [ ] **Bounce/complaint handling** (webhooks SendGrid → suprimir destinatarios)
  - [ ] **Rate limiting por usuario** para evitar spam
  - [ ] **Digest mode** (agrupar varios eventos en un email)
  - [ ] **Suscripción a más eventos**: `booking.confirmed/reminded/rescheduled`, `reservation.*`, `package.exhausted`, `payout.paid`

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
  - [ ] **Order modifications** post-creación con auditoría
  - [ ] **Email notifications** automáticos en cada transición

### `inventory` — ✅ funcional
- [x] Stock per SKU, FSM reserve/release/commit, threshold alerts
- **Falta**:
  - [ ] **Stock por warehouse/ubicación** (hoy plano por tenant)
  - [ ] **Backorder support** con cola de espera
  - [ ] **Forecast/replenishment** sugerencias
  - [ ] **Variants** (talla/color como SKUs derivados)
  - [ ] **Bundle SKUs** (kits que decrementan varios SKUs al vender)

### `reviews` — ✅ funcional
- [x] CRUD, replies, agregados, evento `review.*`
- **Falta**:
  - [ ] **Verified-purchase check via HTTP a orders** — hoy se acepta cualquier `order_id`
  - [ ] **Moderación con ML** (toxicidad, spam) — solo manual `pending → published`
  - [ ] **Photo/video uploads** con object storage
  - [ ] **Helpful/unhelpful voting**
  - [ ] **Schema.org JSON-LD** para SEO

### `messaging` — ✅ funcional
- [x] Threads, mensajes, attachments, mark read, ACL buyer/vendor/staff
- **Falta**:
  - [ ] **WebSocket / SSE real-time** — hoy polling/REST
  - [ ] **Typing indicators, presence**
  - [ ] **Attachments** persistidos en object storage (hoy solo metadata JSON)
  - [ ] **Search** en mensajes (Postgres full-text o Elastic)
  - [ ] **Auto-archive** de threads inactivos
  - [ ] **Translation** automática para chat cross-language

### `shipping` — ✅ funcional pero stub de carriers
- [x] Zones, rates, shipments, tracking events, FSM
- **Falta**:
  - [ ] **Integración con carriers reales** (UPS, FedEx, Correos, GLS, SEUR, DHL) — hoy todo manual
  - [ ] **Etiquetas EasyPost/Sendcloud** generación de PDF
  - [ ] **Webhook receivers** para tracking automático del carrier
  - [ ] **Multi-package shipments** (un order con N cajas)
  - [ ] **Returns/RMA flow**
  - [ ] **Insurance, signature required** opciones

### `disputes` — ✅ funcional
- [x] FSM, mensajes, evidencia, escalation `splitpay.chargeback.created`
- **Falta**:
  - [ ] **SLA timer** (auto-escalate si vendor no responde en 48h)
  - [ ] **Auto-refund** integration al resolver favor del buyer
  - [ ] **Stripe dispute API** sync bidireccional (subir evidencia a Stripe)
  - [ ] **Templated responses** para vendors

### `catalog` — ✅ funcional pero básico
- [x] CRUD productos
- **Falta**:
  - [ ] **Variants** (talla, color, material) como SKUs derivados
  - [ ] **Bundles** y combos
  - [ ] **Pricing rules** (precio por volumen, promo)
  - [ ] **Search** (Postgres FTS o Elastic)
  - [ ] **Category tree** con jerarquía
  - [ ] **Image gallery** con CDN
  - [ ] **Inventory link** automático al crear producto
  - [ ] **Import/export CSV**
  - [ ] **Versioning + draft/published**

### `basket` — ✅ funcional
- [x] Redis-only, expiración, items
- **Falta**:
  - [ ] **Merge** carritos cuando un guest se loguea
  - [ ] **Validación de precio/disponibilidad** en checkout (re-leer catálogo)
  - [ ] **Promociones aplicadas** (no hay engine)
  - [ ] **Saved-for-later**
  - [ ] **Abandoned-cart events** para `notifications`

## platform-restaurant (port 3200)

### `menu` — ✅ funcional
- [x] Modifiers, allergens, availability windows, 86-list, eventos
- **Falta**:
  - [ ] **Photo upload** a object storage (hoy solo URL)
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
  - [ ] **Photo gallery**
  - [ ] **Pricing tiers** (precio según día/hora)
  - [ ] **Bundling con `packages`** automatizado

### `resources` — ✅ funcional
- [x] Practitioners/rooms/equipment, work hours, exceptions, N:M services
- **Falta**:
  - [ ] **Round-robin / load-balancing** entre profesionales (hoy se elige uno)
  - [ ] **Skill matrix** (no todos hacen todo aunque ofrezcan el mismo servicio)
  - [ ] **Vacation request workflow** (request → approve → exception)
  - [ ] **Calendar integrations** (Google Calendar / Outlook two-way sync)

### `bookings` — ✅ funcional con FSM completo
- [x] FSM, recurrence skeleton, reschedule, waitlist, audit
- **Falta**:
  - [ ] **Recurrence engine real** — hoy hay schema `recurrences` y `rrule` pero **nadie lo expande** a bookings concretos. Necesita un cron-job que materialice instancias.
  - [ ] **Llamada a `availability.holdSlot`** dentro de `createBooking` para evitar double-booking — hoy permite crear sobre slot ocupado
  - [ ] **Reminders schedule** (T-24h, T-2h) — necesita scheduler/cron
  - [ ] **No-show tarjeta de garantía** integración con `payments`
  - [ ] **Resource conflict detection** al crear (validación cruzada con `availability`)
  - [ ] **Cancellation policy enforcement** (cobrar fee si se cancela <24h)

### `availability` — ✅ funcional
- [x] Slot computation, atomic holds via tstzrange
- **Falta**:
  - [ ] **Caché Redis** del slot grid (hoy recomputa cada query — caro a escala)
  - [ ] **Multi-resource consolidation** (cita que requiere médico + sala simultáneos)
  - [ ] **Capacity > 1** (clases grupales con N slots por hora)
  - [ ] **Time-zone awareness** (hoy todo UTC; importa para tenants multi-país)
  - [ ] **Hold cleanup background job** (cron) en lugar de cleanup oportunista
  - [ ] **Step granularity configurable** por servicio (hoy 15 min hardcoded)

### `intake-forms` — ✅ funcional
- [x] Templates versioned, submissions, signatures, auto-create on booking.confirmed
- **Falta**:
  - [ ] **Form builder UI** (no hay frontend)
  - [ ] **File upload** para attachments del cliente
  - [ ] **Conditional logic** (mostrar pregunta B si A=sí)
  - [ ] **PDF export** del cuestionario rellenado
  - [ ] **Digital signature provider real** (DocuSign/SignNow) — hoy solo URL
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
  - [ ] **Expiry warning emails** (T-30d, T-7d) — necesita scheduler
  - [ ] **Family sharing** (un bono usado por varios usuarios autorizados)
  - [ ] **Transfer / gifting** entre usuarios
  - [ ] **Renewal automático** opcional

### `practitioner-payouts` — ✅ funcional
- [x] Rules, accruals, close period, mark paid
- **Falta**:
  - [ ] **Integración con `splitpay`** para liquidación automática (hoy se marca paid manualmente con `external_ref`)
  - [ ] **Scheduling automático** (cierre de quincena/mes via cron)
  - [ ] **PDF report descargable** por profesional
  - [ ] **Tax withholding** (IRPF en España)
  - [ ] **1099/Modelo 347** generation
  - [ ] **Adjustment workflow** (correcciones aprobadas)

## Trabajo transversal que falta en TODA la plataforma

| Área | Estado | Prioridad |
|---|---|---|
| **Scheduler/cron centralizado** | ❌ no existe | **alta** — bloquea recurrence, reminders, expiry warnings, close-period |
| **Object storage** (S3/R2/MinIO) | ❌ no integrado | alta — fotos, PDFs, attachments, recordings |
| **WebSocket gateway** para tiempo real | ❌ no hay | media — KDS, delivery tracking, messaging, telehealth waiting room |
| **Email/SMS templates editables por tenant** | ❌ hardcoded | alta |
| **Observability** (Prometheus + Grafana + Loki) | ❌ solo logs pino | media |
| **Distributed tracing** (OpenTelemetry) | ❌ no | media |
| **Audit log centralizado** cross-módulos | parcial (algunos tienen audit propio) | media |
| **HTTP transport entre contenedores** con auth | ❌ todo Redis events | media |
| **Tests E2E** entre los 4 monoliths | ❌ solo unit + integration por módulo | media |
| **Backup/restore** automatizado de Postgres | ❌ no | alta producción |
| **i18n** | ❌ todo en EN hardcoded | alta para mercado ES |
| **Frontend para staff** (admin de cada módulo) | parcial — solo voragine-console básico | alta |

## Top 10 prioridades por impacto

1. [x] **Scheduler/cron** — desbloquea recurrencias, recordatorios, expiry, close-period en 5+ módulos
2. [ ] **Object storage** — fotos, PDFs, attachments en 6+ módulos
3. [ ] **`payments` real** — `pos.payBill`, `packages.purchase`, `bookings.deposit` no cobran
4. [ ] **`telehealth` provider real** — el stub no funciona en producción
5. [ ] **SMS channel en `notifications`** — recordatorios de citas/reservas
6. [ ] **Carriers reales en `shipping`/`delivery-dispatch`**
7. [ ] **`reviews` verified-purchase HTTP cross-container**
8. [ ] **Recurrence expander en `bookings`**
9. [ ] **Hold-on-create en `bookings.create`** (evitar double-booking)
10. [ ] **Email templates editables + i18n** en `notifications`
