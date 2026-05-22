# TODO — Cobertura de tests

> Inventario del estado actual y plan para llegar a una cobertura
> "razonablemente exhaustiva" de toda la plataforma. `[x]` = implementado;
> `[ ]` = pendiente.
>
> Convenciones (ver CONVENTIONS.md):
> - Unit (`*.service.test.js`, `*.routes.test.js`, etc.) — mockean DB y
>   dependencias externas; corren rápido.
> - Integration (`__tests__/integration/*.integration.test.js`) — Fastify
>   `.inject()` contra Postgres + Redis reales (testcontainers o el stack
>   `docker compose`).
> - Framework: Vitest + Supertest (ya en uso).
>
> Convención de severidad para los pendientes:
> - **P0** = bloqueante (regla CLAUDE.md crítica, e.g. RLS, app_id).
> - **P1** = camino feliz + errores típicos.
> - **P2** = edge cases / contratos cross-módulo.

---

## 1 · Platform modules — `platform/*`

### 1.1 platform-core container — `platform/core/`

- [ ] `server.test.js` — boot order (pool per module, migrations sequential, register sequential) **P1**
- [ ] OpenAPI spec snapshot — la suma de módulos genera la doc esperada **P2**
- [ ] Schema isolation contract — cada módulo solo puede conectar con su rol DB (test que intenta SELECT cross-schema falla con `permission denied`) **P0**

### 1.2 auth — `platform/auth/`

- [x] `auth.service.test.js` — login, signup, hashing, JWT
- [x] `auth.routes.test.js` — endpoints públicos + protegidos
- [x] `integration/auth.integration.test.js`
- [x] `integration/users.integration.test.js`
- [x] `oauth.service.test.js` — Google + Facebook id-token verify (mock provider) **P1**
- [x] `magic-links.service.test.js` — emit, hash, expiry 15min, consume, replay **P0** (idempotencia)
- [x] `signup-approval.test.js` — `pending_approval` flow + admin approve/reject **P1**
- [x] `rls.integration.test.js` — un user de tenant A no puede leer rows de tenant B (set GUC + intentar SELECT) **P0**

### 1.3 payments — `platform/payments/`

- [x] `health.test.js`
- [x] `payments.service.test.js` — `createPaymentIntent` con idempotencyKey en Redis, TTL 24h **P0**
- [x] `webhook.service.test.js` (en splitpay) — verificar Stripe-Signature (válido + tampered) **P0**
- [x] `integration/payments.integration.test.js` (placeholder `.todo`) — flujo Intent → succeeded webhook → state machine **P1**
- [x] `idempotency.test.js` (en splitpay) — repetir misma key devuelve mismo resultado, no crea segundo cargo **P0**

### 1.4 notifications — `platform/notifications/`

- [x] `email.service.test.js`
- [x] `event-consumer.test.js`
- [x] `integration/event-consumer.integration.test.js`
- [x] `templates.test.js` — render con variables, escape XSS, locales ES/EN **P1**
- [x] `resend-client.test.js` — error 4xx/5xx + retry con backoff **P2**
- [x] `donation.*.event.test.js` — subscriber a `donation.completed` / `donation.certificate.ready` envía email correcto **P1**

### 1.5 tenant-config — `platform/tenant-config/`

- [x] `health.test.js`
- [x] `integration/tenant-config.integration.test.js`
- [ ] `apps.repository.test.js` — register/unregister + emisión Redis `tenant.app.created` **P1**
- [ ] `nginx-config-render.test.js` — el render del server block es válido (`nginx -t` en sandbox) **P0**
- [ ] `enabled-modules.test.js` — `tenant-console` solo monta los manifests listados **P1**

### 1.6 splitpay — `platform/splitpay/`

- [x] `checkout-session.service.test.js` — one-shot, subscription, splitRule, idempotencia **P0**
- [ ] `webhook.service.test.js` — `checkout.completed`, `invoice.paid`, `subscription.updated`, dedup por `event.id` **P0**
- [x] `refunds.service.test.js` — refund proporcional a cada transfer (no flat) **P0** (regla CLAUDE.md #6)
- [ ] `connect-onboarding.test.js` — Stripe Connect account + onboarding link **P1**
- [ ] `integration/splitpay.integration.test.js` — full flow con Stripe en modo test (CI gated) **P1**

### 1.7 storage — `platform/storage/`

- [x] `storage.service.test.js`
- [x] `integration/storage.integration.test.js`
- [ ] `presigned-url.test.js` — TTL, multipart, content-type lock **P1**
- [ ] `object-lifecycle.test.js` — soft delete + purge job **P2**

### 1.8 leads — `platform/leads/`

- [x] `leads.service.test.js` — create + dedup por email-en-24h **P1**
- [x] `leads.routes.test.js` — public POST + admin GET/PATCH role-gated **P0**
- [ ] `integration/leads.integration.test.js` — RLS + role gates **P0**
- [ ] `lead-notifications.test.js` — emit `lead.created` event → notifications **P2**

### 1.9 donations — `platform/donations/` *(módulo nuevo)*

- [x] `donations.service.test.js` — `createCheckout` one-shot + recurring; row pending → paid; refund proporcional **P0**
- [x] `donations.routes.test.js` — `/checkout` público, `/me` autenticado, `/admin` role-gated **P0**
- [x] `causes.service.test.js` — CRUD + raised_cents increment idempotente vía session_id **P0**
- [x] `splitpay-events.handler.test.js` — filtra por `metadata.purpose === 'donation'`; ignora otros eventos **P0**
- [x] `certificate.service.test.js` — generación PDF idempotente por `(app, tenant, year, nif)` **P1**
- [x] `modelo182.service.test.js` — formato ISO-8859-1, 600 chars/línea, cabecera + detalle **P0** (fiscal compliance)
- [ ] `integration/donations.integration.test.js` — checkout → webhook → row paid → certificate generate **P1**
- [x] **Bug pendiente** (`checkout-loopback-bearer.test.js`): el loopback a `/v1/splitpay/checkout-sessions` envía sin Bearer → 401. Test que reproduce y verifica fix. **P0**

### 1.10 marketplace monolith — `platform/marketplace/`

- [ ] `server.test.js` — registro coherente de los 8 módulos **P1**

#### 1.10.1 orders
- [x] `orders.service.test.js`
- [x] `integration/orders.integration.test.js`
- [x] `state-machine.test.js` — transiciones permitidas (pending→paid→shipped→delivered) **P0**
- [x] `idempotent-create.test.js` — POST con misma idempotencyKey no duplica **P0**

#### 1.10.2 inventory
- [x] `inventory.service.test.js`
- [x] `integration/inventory.integration.test.js`
- [x] `stock-reservation.test.js` — reservar + liberar al expirar; race condition con SELECT FOR UPDATE **P0**
- [ ] `low-stock-event.test.js` — emisión de `inventory.low_stock` cuando cae por debajo del umbral **P2**

#### 1.10.3 reviews
- [x] `reviews.service.test.js`
- [x] `orders-client.test.js`
- [x] `integration/reviews.integration.test.js`
- [x] `verified-purchase.test.js` — bloquea review si no hay order completed del SKU **P0**

#### 1.10.4 messaging
- [x] `messaging.service.test.js`
- [x] `integration/messaging.integration.test.js`
- [ ] `pii-redaction.test.js` — emails/teléfonos en mensajes se redactan (anti-disintermediation) **P1**

#### 1.10.5 shipping
- [x] `shipping.service.test.js`
- [x] `integration/shipping.integration.test.js`
- [ ] `rate-quote.test.js` — combinaciones zone + weight + carrier **P1**

#### 1.10.6 disputes
- [x] `disputes.service.test.js`
- [x] `integration/disputes.integration.test.js`
- [ ] `sla-breach.test.js` — scheduler job emite `dispute.sla_breached` a las 48h sin respuesta **P1**

#### 1.10.7 catalog
- [x] `health.test.js`
- [x] `integration/catalog.integration.test.js`
- [ ] `catalog.service.test.js` — CRUD productos + variants + categorías **P1**
- [ ] `search.test.js` — full-text search ES (tsvector / pg_trgm) **P2**

#### 1.10.8 basket
- [x] `health.test.js`
- [x] `integration/basket.integration.test.js`
- [ ] `basket.service.test.js` — add/remove/checkout en Redis-only, TTL **P1**
- [ ] `abandoned-basket.test.js` — scheduler emite `basket.abandoned` tras 1h idle **P2**

### 1.11 restaurant monolith — `platform/restaurant/`

- [ ] `server.test.js` — registro de los 6 módulos **P1**

#### 1.11.1 menu
- [x] `menu.service.test.js`
- [x] `integration/menu.integration.test.js`
- [ ] `86-list.test.js` — marcar item agotado, propagación a POS/KDS **P1**
- [ ] `availability-windows.test.js` — brunch only 10-14h, etc. **P1**

#### 1.11.2 reservations
- [x] `reservations.service.test.js`
- [x] `integration/reservations.integration.test.js`
- [ ] `waitlist.test.js` — promover de waitlist a confirmed cuando hay hueco **P1**
- [ ] `overbooking-guard.test.js` — no permitir más reservas que capacity **P0**

#### 1.11.3 floor-plan
- [x] `floor-plan.service.test.js`
- [x] `integration/floor-plan.integration.test.js`
- [ ] `table-assign.test.js` — asignar reserva a mesa con capacity match **P1**

#### 1.11.4 kds
- [x] `kds.service.test.js`
- [x] `integration/kds.integration.test.js`
- [ ] `ticket-state.test.js` — pending → cooking → ready → served **P1**

#### 1.11.5 pos
- [x] `pos.service.test.js`
- [x] `integration/pos.integration.test.js`
- [ ] `split-bill.test.js` — dividir cuenta por items / por igual / por %  **P1**
- [ ] `tip-handling.test.js` — propina como add-on no sujeta a IVA **P1**

#### 1.11.6 delivery-dispatch
- [x] `delivery-dispatch.service.test.js`
- [x] `integration/delivery-dispatch.integration.test.js`
- [ ] `gps-tracking.test.js` — coords stream, no PII en payload **P2**

### 1.12 appointments monolith — `platform/appointments/`

- [ ] `server.test.js` **P1**

#### 1.12.1 services
- [x] `services.service.test.js`
- [x] `integration/services.integration.test.js`

#### 1.12.2 resources
- [x] `resources.service.test.js`
- [x] `integration/resources.integration.test.js`

#### 1.12.3 bookings
- [x] `bookings.service.test.js`
- [x] `integration/bookings.integration.test.js`
- [ ] `recurrence.test.js` — RRULE expansion 30d ahead, exception dates **P1**
- [x] `reschedule.test.js` — cancel + rebook libera hold del slot **P0**
- [x] `fsm.test.js` — pending → confirmed → completed | cancelled | no_show **P0**

#### 1.12.4 availability
- [x] `availability.service.test.js`
- [x] `integration/availability.integration.test.js`
- [x] `atomic-hold.test.js` — SET NX EX en Redis; race condition con 2 holds simultáneos solo gana 1 **P0**
- [ ] `slot-computation.test.js` — descontar bookings + holds + horarios + bloques **P0**

#### 1.12.5 intake-forms
- [x] `intake-forms.service.test.js`
- [x] `integration/intake-forms.integration.test.js`
- [ ] `signature.test.js` — firma digital + hash de integridad **P1**

#### 1.12.6 telehealth
- [x] `telehealth.service.test.js`
- [x] `integration/telehealth.integration.test.js`
- [ ] `room-token.test.js` — JWT de Daily/Twilio con TTL = duración de cita **P1**

#### 1.12.7 packages
- [x] `packages.service.test.js`
- [x] `integration/packages.integration.test.js`
- [x] `balance-consume.test.js` — descontar sesiones; bloquear cuando balance=0 **P0**
- [ ] `expiry.test.js` — scheduler T-30d, T-7d, transición a expired **P1**

#### 1.12.8 practitioner-payouts
- [x] `practitioner-payouts.service.test.js`
- [x] `integration/practitioner-payouts.integration.test.js`
- [x] `commission-calc.test.js` — % vs flat fee, retenciones IRPF, edge cases **P0**
- [ ] `period-close.test.js` — scheduler `payout.period_due`, idempotente **P0**

### 1.13 scheduler — `platform/scheduler/`

- [x] `jobs.test.js`
- [x] `lock.test.js`
- [x] `integration/scheduler.integration.test.js`
- [ ] `advisory-lock.test.js` — 2 runners simultáneos: solo uno ejecuta el job **P0**
- [ ] `cron-parse.test.js` — expresiones cron correctas para cada job declarado **P1**
- [ ] `missed-tick-recovery.test.js` — qué pasa si el runner estuvo caído 1h **P2**

---

## 2 · App monoliths — `apps/*/{app}-server/`

### 2.1 aikikan-server — `apps/aikikan/aikikan-server/`

- [ ] `members.service.test.js` — CRUD socios scoped por `(app_id, tenant_id)` **P0**
- [ ] `members.routes.test.js` — role gates owner/admin/user **P0**
- [ ] `dojos.service.test.js` — CRUD + listado público con `?tenantId=` **P1**
- [ ] `videos.service.test.js` — YouTube id validation, link a member **P2**
- [ ] `fees.service.test.js` — products + subscriptions Stripe loopback **P1**
- [ ] `certificates.service.test.js` — PDF de grado con QR de verificación **P1**
- [x] `events/user-revoked.handler.test.js` — al recibir el evento, borra el row member **P0**
- [ ] `events/splitpay.handler.test.js` — `invoice.paid` → marca cuota pagada **P0**
- [ ] `integration/aikikan.integration.test.js` — RLS + cross-event flow **P0**

### 2.2 aulavera-server — `apps/aulavera/aulavera-server/` *(módulo nuevo)*

- [x] `events.service.test.js` — list por `kind=chronicle|workshop`, filtros, RLS **P0**
- [x] `events.routes.test.js` — público con `?tenantId=`, no permite cross-tenant **P0**
- [ ] `disciplines.service.test.js` — listado ordenado por position **P1**
- [ ] `resources.service.test.js` — filtrado por type, requires_membership **P1**
- [ ] `migrations.test.js` — 0001 + 0002_seed idempotente (reaplicar no duplica) **P1**
- [ ] `integration/aulavera.integration.test.js` **P0**

### 2.3 yoga-studio — `apps/yoga-studio/`

- [ ] (todo — depende del scope actual del bundle PM2; verificar antes de listar) **?**

---

## 3 · Paquetes compartidos — `packages/*`

### 3.1 platform-sdk — `packages/platform-sdk/`

- [x] `app-guard.test.js` — JWT decode, `app_id` mismatch, claim ausente, exp, `public: true` skip **P0** (la causa raíz del bug donations)
- [x] `db.test.js` — `withTenantTransaction` setea GUC `app.app_id` y `app.tenant_id` + ROLLBACK en error **P0**
- [ ] `errors.test.js` — clases + statusCode + payload **P1**
- [ ] `logger.test.js` — formato + scrubbing de PII **P2**
- [ ] `redis.test.js` — connect + reconnect **P2**
- [ ] `storage.test.js` — helpers de presigned URL **P2**
- [x] `crypto.test.js` — AES-256-GCM encrypt/decrypt, key rotation **P0** (secrets at rest)

### 3.2 sdk-js — `packages/sdk-js/`

- [ ] `client.test.js` — métodos HTTP + retry + auth header **P1**
- [ ] `contract.test.js` — payloads matcheando los schemas zod del backend **P1**

---

## 4 · Frontends — `apps/*/{app}-portal/`

### 4.1 console-portal — `apps/console/console-portal/`

- [x] `lib/__tests__/auth.test.js`
- [x] `lib/__tests__/integration/login-flow.integration.test.js`
- [ ] `views/staff/config/__tests__/*.test.jsx` — formularios de OAuth, Stripe, Resend, MinIO **P1**
- [ ] `views/staff/tenants/__tests__/*.test.jsx` — registro/edición/baja de tenants **P1**

### 4.2 aikikan-portal — `apps/aikikan/aikikan-portal/`

- [ ] `App.test.jsx` — rutas + AuthContext **P1**
- [ ] `views/Login.test.jsx` — magic-link request + entrada con `?token=` **P0** (passwordless)
- [ ] `views/SolicitarAlta.test.jsx` — pending_approval UX **P1**
- [ ] `views/UsersAdmin.test.jsx` — approve / reject **P1**
- [ ] `views/MemberHome.test.jsx` **P1**

### 4.3 aulavera-portal — `apps/aulavera/aulavera-portal/`

- [ ] `App.test.jsx` — react-router-dom mounting + routes **P1**
- [ ] `views/Proyectos.test.jsx` — fetch events + disciplines, loading states, error toast **P1**
- [ ] `views/Contacto.test.jsx` — leads POST + donations checkout redirect **P1**
- [ ] `components/ReserveModal.test.jsx` — submit a leads con campos correctos **P1**

### 4.4 splitpay-portal, tenant-console-portal, portal (admin)

- [ ] Smoke + role-gate básicos por portal **P1**

### 4.5 E2E browser — Playwright (no existe aún)

- [ ] Setup Playwright + un test "humo" por subdominio **P1**
- [ ] aulavera: home → /proyectos → tabs cargan → /contacto → formulario envía **P1**
- [ ] aikikan: magic-link login → MemberHome → logout **P0**
- [ ] console: super_admin login → editar config de splitpay → guardar **P1**
- [ ] cross-app: socio aikikan paga cuota → Stripe webhook → row paid en aikikan-server (Stripe CLI o stub) **P0**

---

## 5 · Cross-cutting / contratos

- [ ] **RLS smoke por módulo** (`pgTAP` o script vitest): SET app.tenant_id=A, SELECT en tabla, debe devolver solo rows de A; intentar SET = B y volver a SELECT, también solo B. Una por cada `platform_*` y `app_*` schema. **P0**
- [ ] **app_id mismatch matrix**: JWT con `app_id=aikikan` contra `EXPECTED_APP_ID=aulavera` → 403 APP_MISMATCH. Una por cada server. **P0** (regla CLAUDE.md #2)
- [ ] **DB role enforcement**: cada módulo conecta con `svc_platform_<mod>`; intento de SELECT en otra schema falla con `permission denied`. **P0** (regla #4)
- [ ] **Events contract**: payloads que se publican en `platform.events` matchean un schema versionado (zod). Producer + consumer comparten el schema. **P1**
- [ ] **Webhook idempotency**: replay del mismo Stripe event no duplica side-effects (consultar `processed_events` table o Redis SETNX). **P0** (regla #3)
- [ ] **Tenant lifecycle**: crear tenant → registrar en `platform_tenants` → nginx config sembrado → puede llamar a su API. End-to-end. **P1**
- [ ] **OpenAPI snapshot CI**: si una ruta cambia su shape sin bump de versión, falla. **P1**

---

## 6 · Infra y operacional

- [ ] `infra/nginx/sidecar.test.sh` — bats/shellcheck: `seed_missing` + `render` + reload **P1**
- [ ] `infra/postgres/init/*.sql` — script que arranca un postgres limpio y aplica todos los init en orden; verifica que cada role/schema existe **P0**
- [ ] **GitHub Actions** `.github/workflows/test.yml` — pnpm install + vitest run + pgtap; matrix por módulo si el tiempo lo justifica **P1**
- [ ] **GitHub Actions** `deploy.yml` — verificar que aulavera-portal + aulavera-server salen del workflow tras el commit `51a34f8` **P1**
- [ ] Test del runbook de bootstrap (`docs/runbooks/platform-bootstrap.md`) — script idempotente verificable **P2**

---

## 7 · Priorización sugerida

Si hay que elegir por dónde empezar para llegar a "razonablemente seguro" lo antes posible:

1. **RLS smoke + app_id mismatch matrix** (sección 5) — cubre las dos reglas duras de CLAUDE.md de un golpe.
2. **platform-sdk/app-guard.test.js** — el bug de donations (downstream call sin Bearer) habría salido aquí si hubiera test.
3. **donations + leads** (1.8 + 1.9) — son nuevos y sin cobertura.
4. **aulavera-server + aikikan-server** unit + integration (sección 2).
5. **Webhook idempotency + Stripe refunds proporcionales** (1.6 + cross-cutting) — regla CLAUDE.md #6, dinero real.
6. Resto en orden de uso real / fricción operacional.

## 8 · Métricas a vigilar (cuando exista CI)

- Coverage line ≥ 80% en `platform/*` y `apps/*/{app}-server`.
- Coverage branch ≥ 70% en lógica de FSM (bookings, orders, donations, payouts).
- Tiempo de test suite < 8 min en CI.
- 0 tests `skip`/`only` en `main`.
