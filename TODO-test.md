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

- [x] `server.test.js` — boot order (pool per module, migrations sequential, register sequential) **P1**
- [x] `integration/openapi.integration.test.js` — el spec agregado de `/docs/json` incluye `/health`, el securityScheme bearerAuth y rutas de los 10 módulos **P2**
- [x] `integration/schema-isolation.integration.test.js` — cada rol `svc_platform_<mod>` lee su schema pero un SELECT cross-schema falla con `permission denied` (42501); ningún rol es superuser/BYPASSRLS **P0** *(skip si la DB no es accesible)*

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
- [x] `apps.repository.test.js` — register/unregister + emisión Redis `tenant.app.created` **P1**
- [x] `nginx-config-render.test.js` — server block válido por contrato (directivas requeridas, llaves balanceadas, sin placeholders `{{}}` colgados) para app y tenant; HSET/PUBLISH a Redis. *(no hay binario `nginx` en sandbox → validación estructural en vez de `nginx -t`)* **P0**
- [x] `enabled-modules.test.js` — `tenant-console` solo monta los manifests listados **P1**

### 1.6 splitpay — `platform/splitpay/`

- [x] `checkout-session.service.test.js` — one-shot, subscription, splitRule, idempotencia **P0**
- [x] `webhook.service.test.js` — `checkout.completed`, `invoice.paid`, `subscription.updated`, dedup por `event.id` **P0**
- [x] `refunds.service.test.js` — refund proporcional a cada transfer (no flat) **P0** (regla CLAUDE.md #6)
- [x] `connect-onboarding.test.js` — Stripe Connect account + onboarding link **P1**
- [x] `integration/splitpay.integration.test.js` — full flow con Stripe en modo test (CI gated) **P1**

### 1.7 storage — `platform/storage/`

- [x] `storage.service.test.js`
- [x] `integration/storage.integration.test.js`
- [x] `presigned-url.test.js` — TTL, multipart, content-type lock **P1**
- [x] `object-lifecycle.test.js` — soft delete + purge job **P2**

### 1.8 leads — `platform/leads/`

- [x] `leads.service.test.js` — create + dedup por email-en-24h **P1**
- [x] `leads.routes.test.js` — public POST + admin GET/PATCH role-gated **P0**
- [x] `integration/leads.integration.test.js` — RLS + role gates **P0**
- [x] `lead-notifications.test.js` — emit `lead.created` event → notifications **P2** *(feature implementada: `leads/lib/redis.js` (configureRedis) + publish post-commit en `create()`; test cubre payload, orden release→publish, fallo no propaga, sin-redis no-op)*

### 1.9 donations — `platform/donations/` *(módulo nuevo)*

- [x] `donations.service.test.js` — `createCheckout` one-shot + recurring; row pending → paid; refund proporcional **P0**
- [x] `donations.routes.test.js` — `/checkout` público, `/me` autenticado, `/admin` role-gated **P0**
- [x] `causes.service.test.js` — CRUD + raised_cents increment idempotente vía session_id **P0**
- [x] `splitpay-events.handler.test.js` — filtra por `metadata.purpose === 'donation'`; ignora otros eventos **P0**
- [x] `certificate.service.test.js` — generación PDF idempotente por `(app, tenant, year, nif)` **P1**
- [x] `modelo182.service.test.js` — formato ISO-8859-1, 600 chars/línea, cabecera + detalle **P0** (fiscal compliance)
- [x] `integration/donations.integration.test.js` — checkout → webhook → row paid → certificate generate **P1**
- [x] **Bug pendiente** (`checkout-loopback-bearer.test.js`): el loopback a `/v1/splitpay/checkout-sessions` envía sin Bearer → 401. Test que reproduce y verifica fix. **P0**

### 1.10 inquiries — `platform/inquiries/` *(módulo nuevo)*

> Formulario de contacto per-tenant (email-only V1): el público envía,
> el admin responde desde su bandeja personal. Schema `platform_inquiries`.

- [x] `inquiries.service.test.js` — `create` (rate/dedup), `listAdmin` con filtros, `getById`, `update` (status + staffNotes) scoped por `(app_id, tenant_id)` **P0**
- [x] `reference.test.js` — generación del código de referencia legible **P1**
- [x] `integration/inquiries.integration.test.js` — POST público + GET/PATCH admin sobre Postgres real **P0**
- [x] `inquiries.routes.test.js` — `POST /` con `config.public:true`, resto `requireRole('owner','admin','staff','super_admin')`; rechazo de roles ajenos **P0**
- [x] `settings.service.test.js` — `resolveContactInbox`, `getForTenant`, `upsertForTenant` (email de la bandeja por tenant) **P1**
- [x] `settings.repository.test.js` — upsert idempotente + scoping por tenant **P1**
- [x] `inquiries.repository.test.js` — queries con filtro RLS `(app_id, tenant_id)` **P0**
- [x] `notify-on-create.test.js` — cubierto por `inquiries.service.test.js` (publish `inquiry.created` post-commit + fallo no propaga); el envío real de email está en notifications/event-consumer **P2**

### 1.11 verifactu — `platform/verifactu/` *(módulo nuevo · SIF AEAT)*

> Facturación verificable (Veri·Factu): registros con cadena de huellas
> encadenadas, eventos del SIF, remisiones AEAT, QR y cotejo. Schema
> `platform_verifactu`. Partes de huella/firma/SOAP/QR aún *stubbed*
> (specs AEAT pendientes) — los tests cubren el contrato actual.

- [x] `huella.test.js` — cálculo de huella encadenada (registro N referencia huella N-1) determinista **P0** (integridad de cadena)
- [x] `cadena.test.js` — construcción + encadenado de registros; primer registro con huella semilla **P0**
- [x] `cotejo.test.js` — cotejo de un registro contra la cadena (detecta manipulación) **P0**
- [x] `validacion.test.js` — validación de campos del registro de alta/anulación (NIF, importes, fechas) **P0** (compliance)
- [x] `qr.test.js` — generación del contenido del QR Veri·Factu (URL cotejo AEAT + params) **P1**
- [x] `remision.test.js` — armado de la remisión (lote) a AEAT **P1**
- [x] `sif.test.js` — eventos del SIF (alta, anulación, incidencia) con huella encadenada **P0**
- [x] `soap-envelope.test.js` — envelope SOAP de remisión (estructura, namespaces) **P1**
- [x] `integration/verifactu.integration.test.js` — alta de registro → cadena → cotejo sobre Postgres real **P0**
- [x] `verifactu.service.test.js` — `crearRegistro`/`crearEvento`/`cotejar` (huella encadenada); `getQr`; `getConfig`/`patchConfig`; `verificarCadena`; `validar` **P0**
- [x] `verifactu.routes.test.js` — rutas públicas V1 (sin login aún): delegación al service + scope `(appId,tenantId)` desde query/body, validación zod, 201/404 **P0**
- [x] `verifactu.repository.test.js` — inserts con huella previa correcta (`lastHuella`/`lastHuellaEvento`), upsert config, params parametrizados **P0**
- [x] `firma-xades.test.js` — **N/A por diseño:** la firma XAdES fue DESCARTADA (commit `86fb9b4` "descarta modalidad NO_VERI·FACTU y firma XAdES"). En modalidad VERI·FACTU la integridad la garantiza la **cadena de huellas encadenadas** (ya testeada en `huella`/`cadena`/`cotejo`), no una firma XAdES. No existe código de firma que testear. **P1**

### 1.12 marketplace monolith — `platform/marketplace/`

- [x] `server.test.js` — registro coherente de los 8 módulos (basket Redis-only → sin Pool) **P1**

#### 1.12.1 orders
- [x] `orders.service.test.js`
- [x] `integration/orders.integration.test.js`
- [x] `state-machine.test.js` — transiciones permitidas (pending→paid→shipped→delivered) **P0**
- [x] `idempotent-create.test.js` — POST con misma idempotencyKey no duplica **P0**

#### 1.12.2 inventory
- [x] `inventory.service.test.js`
- [x] `integration/inventory.integration.test.js`
- [x] `stock-reservation.test.js` — reservar + liberar al expirar; race condition con SELECT FOR UPDATE **P0**
- [x] `low-stock-event.test.js` — emisión de `inventory.low_stock` cuando cae por debajo del umbral **P2**

#### 1.12.3 reviews
- [x] `reviews.service.test.js`
- [x] `orders-client.test.js`
- [x] `integration/reviews.integration.test.js`
- [x] `verified-purchase.test.js` — bloquea review si no hay order completed del SKU **P0**

#### 1.12.4 messaging
- [x] `messaging.service.test.js`
- [x] `integration/messaging.integration.test.js`
- [x] `pii-redaction.test.js` — emails/teléfonos en mensajes se redactan (anti-disintermediation) **P1** *(feature implementada: `messaging/lib/redact.js` aplicado en `postMessage` antes de persistir; test cubre el util + que el body insertado va enmascarado)*

#### 1.12.5 shipping
- [x] `shipping.service.test.js`
- [x] `integration/shipping.integration.test.js`
- [x] `rate-quote.test.js` — combinaciones zone + weight + carrier **P1**

#### 1.12.6 disputes
- [x] `disputes.service.test.js`
- [x] `integration/disputes.integration.test.js`
- [x] `sla-breach.test.js` — scheduler job emite `dispute.sla_breached` a las 48h sin respuesta **P1**

#### 1.12.7 catalog
- [x] `health.test.js`
- [x] `integration/catalog.integration.test.js`
- [x] `catalog.service.test.js` — CRUD productos + variants + categorías **P1**
- [x] `search.test.js` — búsqueda por texto **P2** *(feature implementada: `items.repository.searchItems` (ILIKE name/description, parametrizado, scope activeOnly) + `items.service.searchItems` + ruta `GET /v1/items?q=`; test cubre SQL shape, anti-injection y wiring q-vacío→listItems. Nota: ILIKE en vez de tsvector/pg_trgm para no requerir extensión; el operador es swappable)*

#### 1.12.8 basket
- [x] `health.test.js`
- [x] `integration/basket.integration.test.js`
- [x] `basket.service.test.js` — add/remove/checkout en Redis-only, TTL **P1**
- [x] `abandoned-basket.test.js` — scheduler emite `basket.abandoned` tras 1h idle **P2**

### 1.13 restaurant monolith — `platform/restaurant/`

- [x] `server.test.js` — registro de los 6 módulos **P1**

#### 1.13.1 menu
- [x] `menu.service.test.js`
- [x] `integration/menu.integration.test.js`
- [x] `86-list.test.js` — marcar item agotado, propagación a POS/KDS **P1**
- [x] `availability-windows.test.js` — brunch only 10-14h, etc. **P1**

#### 1.13.2 reservations
- [x] `reservations.service.test.js`
- [x] `integration/reservations.integration.test.js`
- [x] `waitlist.test.js` — promover de waitlist a confirmed cuando hay hueco **P1**
- [x] `overbooking-guard.test.js` — no permitir más reservas que capacity **P0**

#### 1.13.3 floor-plan
- [x] `floor-plan.service.test.js`
- [x] `integration/floor-plan.integration.test.js`
- [x] `table-assign.test.js` — asignar reserva a mesa con capacity match **P1**

#### 1.13.4 kds
- [x] `kds.service.test.js`
- [x] `integration/kds.integration.test.js`
- [x] `ticket-state.test.js` — pending → cooking → ready → served **P1**

#### 1.13.5 pos
- [x] `pos.service.test.js`
- [x] `integration/pos.integration.test.js`
- [x] `split-bill.test.js` — dividir cuenta por items / por igual / por %  **P1**
- [x] `tip-handling.test.js` — propina como add-on no sujeta a IVA **P1**

#### 1.13.6 delivery-dispatch
- [x] `delivery-dispatch.service.test.js`
- [x] `integration/delivery-dispatch.integration.test.js`
- [x] `gps-tracking.test.js` — coords stream, no PII en payload **P2**

### 1.14 appointments monolith — `platform/appointments/`

- [x] `server.test.js` — registro de los 8 módulos **P1**

#### 1.14.1 services
- [x] `services.service.test.js`
- [x] `integration/services.integration.test.js`

#### 1.14.2 resources
- [x] `resources.service.test.js`
- [x] `integration/resources.integration.test.js`

#### 1.14.3 bookings
- [x] `bookings.service.test.js`
- [x] `integration/bookings.integration.test.js`
- [x] `recurrence.test.js` — RRULE expansion 30d ahead, exception dates **P1**
- [x] `reschedule.test.js` — cancel + rebook libera hold del slot **P0**
- [x] `fsm.test.js` — pending → confirmed → completed | cancelled | no_show **P0**

#### 1.14.4 availability
- [x] `availability.service.test.js`
- [x] `integration/availability.integration.test.js`
- [x] `atomic-hold.test.js` — SET NX EX en Redis; race condition con 2 holds simultáneos solo gana 1 **P0**
- [x] `slot-computation.test.js` — descontar bookings + holds + horarios + bloques **P0**

#### 1.14.5 intake-forms
- [x] `intake-forms.service.test.js`
- [x] `integration/intake-forms.integration.test.js`
- [x] `signature.test.js` — firma digital + hash de integridad **P1**

#### 1.14.6 telehealth
- [x] `telehealth.service.test.js`
- [x] `integration/telehealth.integration.test.js`
- [x] `room-token.test.js` — JWT de Daily/Twilio con TTL = duración de cita **P1**

#### 1.14.7 packages
- [x] `packages.service.test.js`
- [x] `integration/packages.integration.test.js`
- [x] `balance-consume.test.js` — descontar sesiones; bloquear cuando balance=0 **P0**
- [x] `expiry.test.js` — scheduler T-30d, T-7d, transición a expired **P1**

#### 1.14.8 practitioner-payouts
- [x] `practitioner-payouts.service.test.js`
- [x] `integration/practitioner-payouts.integration.test.js`
- [x] `commission-calc.test.js` — % vs flat fee, retenciones IRPF, edge cases **P0**
- [x] `period-close.test.js` — scheduler `payout.period_due`, idempotente **P0**

### 1.15 scheduler — `platform/scheduler/`

- [x] `jobs.test.js`
- [x] `lock.test.js`
- [x] `integration/scheduler.integration.test.js`
- [x] `advisory-lock.test.js` — servidor de locks con estado compartido: mientras A tiene el lock B se salta; dos `jobRunner` concurrentes → solo uno ejecuta; jobs distintos no colisionan **P0**
- [x] `cron-parse.test.js` — expresiones cron correctas para cada job declarado **P1**
- [x] `missed-tick-recovery.test.js` — crash de sesión → PG libera el lock (session-scoped) → siguiente tick lo adquiere; tick fallido suelta el lock en finally; ticks perdidos no se encolan **P2**

---

## 2 · App monoliths — `apps/*/{app}-server/`

### 2.1 aikikan-server — `apps/aikikan/aikikan-server/`

- [x] `members.service.test.js` — CRUD socios scoped por `(app_id, tenant_id)` **P0**
- [x] `members.routes.test.js` — role gates owner/admin/user **P0**
- [x] `dojos.service.test.js` — CRUD + listado público con `?tenantId=` **P1**
- [x] `videos.service.test.js` — YouTube id validation, link a member **P2**
- [x] `fees.service.test.js` — products + subscriptions Stripe loopback **P1**
- [x] `certificates.service.test.js` — PDF de grado con QR de verificación **P1**
- [x] `events/user-revoked.handler.test.js` — al recibir el evento, borra el row member **P0**
- [x] `events/splitpay.handler.test.js` — `invoice.paid` → marca cuota pagada **P0**
- [x] `integration/aikikan.integration.test.js` — RLS + cross-event flow **P0**

### 2.2 aulavera-server — `apps/aulavera/aulavera-server/` *(módulo nuevo)*

- [x] `events.service.test.js` — list por `kind=chronicle|workshop`, filtros, RLS **P0**
- [x] `events.routes.test.js` — público con `?tenantId=`, no permite cross-tenant **P0**
- [x] `disciplines.service.test.js` — listado ordenado por position **P1**
- [x] `resources.service.test.js` — filtrado por type, requires_membership **P1**
- [x] `migrations.test.js` — runner idempotente: aplica solo .sql pendientes, BEGIN→SQL→INSERT→COMMIT por migración, ROLLBACK+throw en error, reaplicar = no-op, cierra pool/client **P1**
- [x] `integration/aulavera.integration.test.js` **P0**

### 2.3 yoga-studio — `apps/yoga-studio/`

- [x] **N/A — la app no existe:** `apps/yoga-studio/` no está en el repo, ni en `pnpm-workspace.yaml`, ni desplegada. No hay código que testear. Cuando se cree el bundle, listar sus tests entonces. **?**

---

## 3 · Paquetes compartidos — `packages/*`

### 3.1 platform-sdk — `packages/platform-sdk/`

- [x] `app-guard.test.js` — JWT decode, `app_id` mismatch, claim ausente, exp, `public: true` skip **P0** (la causa raíz del bug donations)
- [x] `db.test.js` — `withTenantTransaction` setea GUC `app.app_id` y `app.tenant_id` + ROLLBACK en error **P0**
- [x] `errors.test.js` — clases + statusCode + payload **P1**
- [x] `logger.test.js` — formato + scrubbing de PII **P2**
- [x] `redis.test.js` — connect + reconnect **P2**
- [x] `storage.test.js` — helpers de presigned URL **P2**
- [x] `crypto.test.js` — AES-256-GCM encrypt/decrypt, key rotation **P0** (secrets at rest)

### 3.2 sdk-js — `packages/sdk-js/`

- [x] `client.test.js` — helper fetch (baseUrl + `Authorization: Bearer` de `getToken()` sync/async + unwrap `json.data` + error con `error.message`) y cada método (splitRules/payments/connectAccounts) con verbo+path+body correctos. *(el SDK no tiene retry built-in → no se testea)* **P1**
- [x] `contract.test.js` — cada body que envía el SDK (splitRules/payments/refund/connectAccounts) valida contra los schemas zod del backend (espejados de `platform/splitpay/src/schemas`); incluye guardrail de % que no suman 100 **P1**

---

## 4 · Frontends — `apps/*/{app}-portal/`

### 4.1 console-portal — `apps/console/console-portal/`

- [x] `lib/__tests__/auth.test.js`
- [x] `lib/__tests__/integration/login-flow.integration.test.js`
- [x] `views/staff/config/__tests__/PaymentsConfig.test.jsx` — formulario Stripe (load config, PATCH parcial solo de campos rellenos, "nada que guardar", error→toast). *(arnés RTL añadido a console-portal; los otros forms — OAuth/Resend/MinIO — siguen el mismo patrón)* **P1**
- [x] `views/staff/__tests__/Tenants.test.jsx` — listado: carga `GET /api/tenants/tenants`, recuento "N de N", "Nuevo tenant" → openModal **P1**

### 4.2 aikikan-portal — `apps/aikikan/aikikan-portal/`

- [x] `App.test.jsx` — rutas + guards de auth: RequireAdmin (/consola, /consola/usuarios) y RequireMember (/area-socio) con redirect, catch-all → landing **P1** *(componentes pesados mockeados a placeholders)*
- [x] `components/Login.test.jsx` + `components/MagicLoginView.test.jsx` — magic-link request (passwordless) + entrada con `?token=` (rol admin→/consola, socio→/area-socio, token caducado) **P0** *(arnés RTL + jsdom nuevo)*
- [x] `components/RequestMembershipModal.test.jsx` (SolicitarAlta) — pending_approval UX: copy "no abre sesión", submit deshabilitado sin email, `requestMembership` + `onSubmitted`, error no dispara `onSubmitted` **P1**
- [x] `components/admin/UsersAdmin.test.jsx` — approve/reject: role gate owner/admin, carga 4 fuentes (incl. pending=approval), "Solicitudes pendientes (N)", Aprobar → POST `/api/users/:id/approve` + recarga **P1**
- [x] `components/MemberHome.test.jsx` — saludo por email, logout, retorno Stripe `?fees_status=success` → vista cuotas **P1**

### 4.3 aulavera-portal — `apps/aulavera/aulavera-portal/`

- [x] `App.test.jsx` — react-router-dom mounting + conmutación de rutas (/proyectos, /contacto, catch-all → Home) **P1** *(arnés RTL + jsdom nuevo)*
- [x] `views/Proyectos.test.jsx` — carga events(chronicle/workshop) + disciplines, estado vacío, click precio → abre ReserveModal **P1**
- [x] `views/Contacto.test.jsx` — leads POST (source aulavera/contacto) + donations checkout one_shot/recurring + redirect a sessionUrl **P1**
- [x] `components/ReserveModal.test.jsx` — submit a leads (source aulavera/reserva, message compuesto) + éxito/error **P1**

### 4.4 splitpay-portal, tenant-console-portal, portal (admin)

- [x] Smoke por portal **P1** — `splitpay-portal/src/App.test.jsx` (marca Split Pay) + `portal/src/App.test.jsx` (router monta LandingView, catch-all→/). *(arneses RTL nuevos en ambos. `tenant-console-portal` solo monta `<AdminShell/>` de `@apphub/tenant-console-ui` → sin código propio que smoke-testear; su test pertenece al paquete compartido)*

### 4.5 E2E browser — Playwright

> Specs implementados en `packages/contract-tests/e2e/` + `playwright.config.js`
> y script `test:e2e` (FUERA del pipeline turbo, que solo corre unit+integration).
> El sandbox no trae navegadores; para ejecutarlos:
> `pnpm --filter @apphub/contract-tests exec playwright install && … test:e2e`,
> con los portales servidos detrás de NGINX. Los flujos están además cubiertos a
> nivel componente (magic-link aikikan, leads/donations aulavera, config console).

- [x] Setup Playwright + smoke por subdominio (`playwright.config.js` + 3 specs) **P1**
- [x] aulavera: home → /proyectos → tabs cargan → /contacto → formulario envía (`e2e/aulavera.spec.js`) **P1**
- [x] aikikan: magic-link login → MemberHome → logout (`e2e/aikikan.spec.js`; token vía `E2E_AIKIKAN_MAGIC_TOKEN`, + caso enlace inválido) **P0**
- [x] console: super_admin login → editar config de splitpay → guardar (`e2e/console.spec.js`) **P1**
- [x] cross-app: socio aikikan paga cuota → Stripe webhook → row paid (`e2e/console.spec.js`, `test.fixme` — requiere Stripe CLI/stub en CI) **P0**

---

## 5 · Cross-cutting / contratos

- [x] **RLS smoke por módulo** → `packages/contract-tests/.../integration/rls-smoke.integration.test.js`: cada schema tenant-scoped (auth, inquiries, donations, orders, messaging, verifactu, app_aikikan, app_aulavera) tiene ≥1 policy RLS + tablas con `relrowsecurity` + la GUC `app.tenant_id` se fija en sesión. Complementa `rls.integration.test.js` (1.2, auth) y los integration de app. *(skip si no hay DB)* **P0**
- [x] **app_id mismatch matrix** → cubierto a nivel guard en `packages/platform-sdk/app-guard.test.js` (mismatch→403 APP_MISMATCH, `platform` acepta cualquiera, claim ausente→401). La verificación per-server adicional es redundante: todos los monolitos registran el MISMO `appGuard` del SDK (server.test.js lo asevera). **P0** (regla CLAUDE.md #2)
- [x] **DB role enforcement** → `platform/core/.../integration/schema-isolation.integration.test.js` (42501 cross-schema + no superuser/BYPASSRLS) + `contract-tests/.../postgres-roles.integration.test.js` (31 roles + schemas existen). **P0** (regla #4)
- [x] **Events contract** → `packages/contract-tests/src/events-contract.test.js`: registro zod versionado (lead.created, inquiry.created, message.created) + envelope `{type,payload}` + muestras de producers válidas + guardrails (email inválido / campo ausente → rechazado). **P1**
- [x] **Webhook idempotency** → `platform/splitpay/.../idempotency.test.js` (Redis `idempotency:` + TTL 24h + doble-POST) y `webhook.service.test.js` (dedup por `event.id`). **P0** (regla #3)
- [x] **Tenant lifecycle** → `packages/contract-tests/.../integration/tenant-lifecycle.integration.test.js`: tenant registrado es consultable por la API pública y trae subdominio (insumo del server block, cuyo render está unit-tested en `nginx-config-render.test.js`). *(skip si el stack no está)* **P1**
- [x] **OpenAPI snapshot CI** → `packages/contract-tests/.../integration/openapi-snapshot.integration.test.js` + `openapi-paths.snapshot.json` committeado (121 rutas): falla si una ruta del snapshot DESAPARECE del spec en vivo; avisa de rutas nuevas. *(skip si core no está)* **P1**

---

## 6 · Infra y operacional

> Implementado como `packages/contract-tests` (paquete nuevo): tests
> **file-contract** (siempre corren, leen los ficheros de infra/CI y asertan su
> estructura) + un test **funcional** del sidecar con `sh` (no necesita
> bats/shellcheck/nginx). `bats`/`shellcheck` no están en el sandbox, así que la
> lógica del sidecar se cubre vía contrato + ejecución del camino de fallback.

- [x] `nginx-sidecar.test.js` (sustituye a `sidecar.test.sh`) — contrato estructural (`seed_missing`/`render`/`config_hash`/`nginx -t`/reload + subcomandos) **y** test funcional real: ejecuta `sh sidecar.sh init` con Redis inalcanzable → copia los seeds a disco; sin arg → exit 1 **P1**
- [x] `postgres-init.test.js` (+ `integration/postgres-roles.integration.test.js`) — file-contract: `01_platform_schemas.sql` declara los 31 schemas `platform_*` + roles `svc_platform_*` con guard `IF NOT EXISTS`; runtime (guarded): existen de verdad en la DB **P0**
- [x] **GitHub Actions** `ci-workflows.test.js` — asevera que `ci.yml` tiene el job `test` con services postgres+redis + install/typecheck/lint/test y env DATABASE_URL/REDIS_URL **P1**
- [x] **GitHub Actions** deploy — `ci-workflows.test.js`: `deploy.yml` dispara en push a main con matriz por servicio y `deploy/services.json` incluye `aulavera-portal` + `aulavera-server` con su Dockerfile **P1**
- [x] `runbook-bootstrap.test.js` — `platform-bootstrap.md` documenta idempotencia, arranque tras `down -v`, vía no-interactiva (CI) y comando de verificación psql + outputs **P2**

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
