# Casos de uso — `platform/tenant-config` (platform-core)

> Dominio: registro de apps y tenants (multi-tenancy). Alta/baja de apps, tenants y sub-tenants; configuración por tenant; planes y feature flags; dominios/subdominios; branding; localización; onboarding/wizard; aislamiento y RLS; suscripciones; auditoría; enrutado NGINX; metadata per-app.

## Estado actual (implementado)

Registro de apps (`platform_tenants.apps`) y tenants (`platform_tenants.tenants`) con modelo jerárquico app → tenant → (sub-tenant pendiente). Ciclo de vida de tenant: `active | suspended | archived`; provisioning atómico vía wizard Fase A/B (`/v1/tenants/bootstrap`); reenvío y revocación de activación. Configuración por tenant: campos legales, contacto, país, localización (`default_locale`), dominio custom, Stripe status, plan (`STARTER|PRO|ENTERPRISE`), métricas de volumen. Suscripción tenant↔plataforma con estados `inactive|trial|active|past_due|cancelled`, `monthly|annual`, integración Stripe Checkout vía splitpay (no-split), sincronización automática vía Redis events (`splitpay.*`). Feature flags por app: `splitpay_enabled`, `enabled_modules` (array de IDs de módulos montables por el tenant-console-shell). Metadata JSONB por app con namespacing controlado (hoy: `solarCalculator`). Routing NGINX dinámico vía Redis hash con render de server blocks por app y por tenant; backfill on-boot. Audit log con actor, role, IP, acción y detalle. Directorio público de tenants por subdominio y por app.

Leyenda: ✅ implementado · 🔧 parcial · ❌ no implementado.

---

## 1. Registro y gestión de apps

- ✅ Alta de app (`POST /v1/apps`) con `appId`, `displayName`, `subdomain`, `jwtAudience`.
- ✅ Listado (`GET /v1/apps`) y consulta individual (`GET /v1/apps/:appId`).
- ✅ Cambio de estado de app (`PATCH /v1/apps/:appId/status`): `active | suspended`.
- ✅ Feature flag `splitpay_enabled` por app (`PATCH /v1/apps/:appId/splitpay`).
- ✅ Array `enabled_modules` por app (`PUT /v1/apps/:appId/enabled-modules`): controla qué manifests monta el tenant-console-shell.
- ✅ Metadata JSONB por app (namespace `solarCalculator` ya implementado; otros vía `jsonb_set` idempotente).
- ✅ `jwt_audience` fijado en el alta — permite validación de claims en appGuard.
- 🔧 Estado `suspended` de app definido en enum pero sin efecto en el flujo de autenticación ni en el acceso de tenants.
- ❌ Baja/archivado definitivo de app con limpieza de tenants y datos asociados.
- ❌ Descripción, logo, URL pública, categoría y metadatos de marketing por app.
- ❌ Webhook URL por app para eventos de plataforma (notificaciones de tenant creado, suscripción, etc.).
- ❌ Transferencia de propiedad de app entre cuentas de staff/plataforma.
- ❌ Versionado de app (semver, historial de releases) para gestión de breaking changes.

## 2. Provisioning atómico de tenant (Fase A — staff)

- ✅ Bootstrap único (`POST /v1/tenants/bootstrap`): app upsert + tenant insert + owner create + activation token + evento `tenant.bootstrap_started` — todo en una operación con compensación.
- ✅ Creación del owner vía endpoint interno `/internal/auth/owners` con generación de magic-link.
- ✅ Construcción del magic-link diferenciando entorno local (`hulkstein.local`) y prod (`hulkstein.com`).
- ✅ Seed de `enabled_modules` en el bootstrap si se pasan en el payload.
- ✅ Seed de suscripción comercial (`period`, `amountCents`, `currency`, `stripePriceId`) desde el formulario de bootstrap.
- ✅ Seed de `flags.splitpayEnabled` y `flags.customDomain` en el bootstrap.
- ✅ Audit entry `TENANT_BOOTSTRAPPED` con actor + IP.
- ✅ Revocación de bootstrap pendiente (`DELETE /v1/tenants/:id/bootstrap`): borra owner + tokens + tenant row + NGINX conf. Falla con 409 si el owner ya activó.
- ✅ Reenvío de magic-link (`POST /v1/tenants/:id/resend-activation`) con re-emisión de token y re-publicación de evento.
- 🔧 Compensación de Fase A (delete del tenant si auth falla) pero sin transacciones distribuidas — la fila de app no se revierte si era nueva.
- ❌ Dry-run del bootstrap (simula la creación sin persistir).
- ❌ Template de bootstrap por tipo de app (configura automáticamente `enabled_modules`, plan, suscripción según perfil).
- ❌ Invitación por lote (crear varios tenants de una sola app desde un CSV).
- ❌ Notificación a staff cuando el owner activa la cuenta (evento `owner.activated` → notificación).

## 3. Ciclo de vida del tenant

- ✅ Estados `active | suspended | archived` con transiciones explícitas.
- ✅ `suspend_reason` persistido al suspender; limpiado automáticamente al reactivar.
- ✅ `archived_at` timestamp write-once al archivar.
- ✅ Audit entries específicos por transición: `TENANT_SUSPENDED`, `TENANT_ARCHIVED`, `TENANT_REACTIVATED`.
- ✅ `PATCH /v1/tenants/:id/status` con guard `super_admin|staff`.
- 🔧 Estado `suspended` sin efecto de bloqueo en el módulo auth (los tokens existentes siguen siendo válidos).
- 🔧 Archivado sin limpieza de datos asociados en otros módulos (órdenes, bookings, etc.).
- ❌ Reactivación desde `archived` (hoy el enum solo permite `active | suspended | archived`; `archived → active` no está validado como transición permitida).
- ❌ SLA de respuesta por estado (alertas de tenant sin activar tras N días).
- ❌ Baja definitiva con borrado GDPR de PII y datos de negocio (right to erasure).
- ❌ Exportación de datos del tenant antes del archivado (GDPR portabilidad).
- ❌ Período de gracia antes de archivado automático por impago.

## 4. Wizard de onboarding del owner (Fase B)

- ✅ Estado derivado de bootstrap (`GET /v1/tenants/:id/bootstrap`): calcula al vuelo el estado de cada paso desde las tablas reales.
- ✅ Pasos obligatorios: `identity` (legal_name + cif + country + address), `password` (activación del owner), `subscription` (estado active/trial).
- ✅ Pasos opcionales: `splitpay-connect` (condicional a `splitpay_enabled`), `admins`, `email-domains`, `custom-domain`, `modules`, `first-data`.
- ✅ Auto-marca `bootstrap_completed_at` (write-once) cuando todos los pasos obligatorios están en `done`.
- ✅ Evento `tenant.bootstrap_completed` publicado en `platform.events` al completar.
- ✅ Lista de tenants en onboarding (`GET /v1/tenants/onboarding`): `bootstrap_started_at IS NOT NULL AND bootstrap_completed_at IS NULL`.
- 🔧 Paso `first-data` siempre en `pending` en V1 (hardcoded `false` — pendiente de wirear eventos de otros módulos).
- 🔧 Paso `email-domains` siempre en `pending` en V1 (requiere evento de notifications).
- 🔧 Paso `splitpay-connect`: done = `stripe_status = 'VERIFIED'`; la actualización de `stripe_status` desde splitpay connect no está wiredada.
- ❌ Notificación al owner de progreso del wizard (correo/push en cada paso completado).
- ❌ Recordatorio automático de pasos obligatorios pendientes tras N días (REUSE `platform/scheduler`).
- ❌ Paso de verificación de dominio custom (DNS TXT/CNAME check).

## 5. Settings y configuración por tenant

- ✅ Campos de identidad legal: `legal_name`, `cif`, `country`, `address`.
- ✅ Campos de contacto: `contact_email`, `contact_phone`.
- ✅ Plan comercial: `plan` enum `STARTER|PRO|ENTERPRISE`.
- ✅ Dominio custom: `custom_domain` (campo libre, sin verificación DNS en V1).
- ✅ Stripe status: `stripe_status` enum `VERIFIED|RESTRICTED|PENDING|DISCONNECTED`.
- ✅ Métricas de volumen: `volume_month_cents`, `tx_month`, `balance_cents` (actualizables por staff).
- ✅ `default_locale` (texto libre, fallback `'es'`) usado por `platform/scheduler` para localizar notificaciones.
- ✅ `requires_user_approval` (booleano): si `true`, los registros nuevos vía `request-membership` y OAuth quedan en `pending_approval`.
- ✅ `PATCH /v1/tenants/:id` con validación Zod de todos los campos; guard `super_admin|staff`.
- 🔧 No hay límites/cuotas por plan implementadas — el plan es solo una etiqueta sin enforcement.
- ❌ Settings de clave-valor tipados (JSONB) configurables por tenant para features dinámicas sin migraciones.
- ❌ Herencia de settings: app → tenant → sub-tenant (cascade con override por nivel).
- ❌ Historial de cambios por campo (versionado de config).
- ❌ Preview/rollback de settings.

## 6. Jerarquía tenant / sub-tenant

- ✅ Modelo de dos niveles definido en el JWT: `tenant_id` + `sub_tenant_id` (nullable).
- ✅ Todas las queries en módulos de plataforma deben escopar por `(app_id, tenant_id)`.
- 🔧 `sub_tenant_id` existe en el claim JWT pero no hay tabla `sub_tenants` en este módulo — el concepto existe en la identidad pero no en el registro.
- ❌ CRUD de sub-tenants: alta, baja, listado por tenant.
- ❌ Settings/flags por sub-tenant (herencia desde tenant con override).
- ❌ Branding/tema propio por sub-tenant.
- ❌ Límites y cuotas por sub-tenant independientes del tenant padre.
- ❌ Consolidación de métricas sub-tenant → tenant → app.

## 7. Feature flags y módulos habilitados

- ✅ `splitpay_enabled` booleano por app: activa el módulo splitpay en el tenant-console-shell y en las APIs.
- ✅ `enabled_modules` array de strings por app: array de IDs de módulos de plataforma que el shell monta en runtime.
- ✅ Módulos baseline añadidos automáticamente en migraciones: `tenants`, `auth`, `audit`, `notifications`.
- ✅ `splitpay` añadido automáticamente a `enabled_modules` cuando `splitpay_enabled = true`.
- 🔧 Los feature flags viven en `apps`, no en `tenants` — no es posible activar un módulo para un subconjunto de tenants de la misma app.
- ❌ Feature flags por tenant (sobreescritura del conjunto de módulos del app para un tenant concreto).
- ❌ Feature flags por plan (STARTER no accede a módulos premium).
- ❌ Fechas de activación/expiración de flags (trial de feature).
- ❌ Flags tipados: booleano, string, número, JSON (no solo arrays de módulos).
- ❌ API de evaluación de flags para uso en código de negocio (`isFeatureEnabled(tenantId, 'flag-x')`).
- ❌ Panel de gestión de flags en la consola de staff.

## 8. Planes, límites y cuotas

- ✅ Enum de plan `STARTER|PRO|ENTERPRISE` persistido en `tenants.plan`.
- ✅ Métricas de volumen por tenant: `volume_month_cents`, `tx_month`, `balance_cents` (campos listos para enforcement).
- 🔧 Plan y cuotas son etiquetas; no hay enforcement real ni checks en las APIs de negocio.
- ❌ Definición de límites por plan (tabla `plan_limits`: max_users, max_orders_month, max_storage_gb, etc.).
- ❌ Enforcement de cuotas en tiempo real: 429 / 402 cuando el tenant supera su límite.
- ❌ Alertas de umbral: notificación al tenant cuando alcanza el 80%/100% de su cuota.
- ❌ Reset automático de métricas de volumen al inicio de período (REUSE `platform/scheduler`).
- ❌ Upgrade de plan con lógica de proration vía Stripe.
- ❌ Vista de consumo real por tenant en la consola de staff.

## 9. Suscripción tenant↔plataforma

- ✅ Campos completos de suscripción en `tenants`: `period`, `status`, `amount_cents`, `currency`, `stripe_price_id`, `stripe_subscription_id`, `stripe_customer_id`, `billing_email`, `started_at`, `renews_at`, `cancel_at_period_end`, `notes`.
- ✅ FSM de estado: `inactive → trial → active → past_due → cancelled`.
- ✅ Inicio de Stripe Checkout vía splitpay (`POST /v1/tenants/:id/subscribe`): solo owner/admin del propio tenant.
- ✅ Sincronización automática desde eventos `splitpay.*` vía Redis subscriber: `checkout.completed` (activa), `invoice.paid` (renueva), `subscription.updated` (sincroniza estado), `subscription.deleted` (cancela), `invoice.payment_failed` (past_due).
- ✅ Vista de suscripción para el owner (`GET /v1/tenants/:id/subscription`): expone `priceConfigured` y `stripeSubscriptionLinked` sin revelar IDs sensibles.
- ✅ Guard de inicio: falla con 409 si staff no configuró el `stripe_price_id`.
- 🔧 Cancelación explícita solo vía Stripe dashboard o webhook — no hay endpoint `DELETE /v1/tenants/:id/subscription`.
- 🔧 `cancel_at_period_end` actualizable pero sin UI en tenant-console que lo use.
- ❌ Portal de cliente Stripe (Customer Portal) para que el tenant gestione su suscripción directamente.
- ❌ Trial con fecha de expiración y transición automática a `active` o `cancelled` (REUSE `platform/scheduler`).
- ❌ Descuentos y cupones por tenant vía Stripe Coupon.
- ❌ Facturas/receipts accesibles al tenant (historial de pagos).
- ❌ Cambio de plan con proration en la suscripción existente.
- ❌ Notificación proactiva de renovación próxima (T-7d, T-1d) vía `platform/notifications`.

## 10. Dominios custom y enrutado NGINX

- ✅ Campo `custom_domain` por tenant (texto libre, sin verificación DNS en V1).
- ✅ Generación dinámica de server blocks NGINX por app (`APP_TEMPLATE`) y por tenant (`TENANT_TEMPLATE`), renderizados con variables.
- ✅ Publicación de configs en Redis hash `nginx:configs` y notificación por `nginx:reload` al NGINX sidecar.
- ✅ Backfill on-boot: re-publica todos los server blocks de tenants activos al arrancar `platform-core`.
- ✅ Namespacing en Redis: apps usan subdomain como clave; tenants usan `tenant--<subdomain>`.
- ✅ Soporte de `hasServer` para añadir ruta `/api/<appId>/` al server block cuando la app tiene backend propio (ADR 013).
- ✅ Eliminación de config NGINX al revocar bootstrap (`deleteTenantNginxConfig`).
- 🔧 Dominio custom solo almacenado; el server block de NGINX no refleja el dominio custom — todos los tenants usan `<subdomain>.hulkstein.com`.
- ❌ Verificación de DNS para dominio custom (TXT record / CNAME check + estado `dns_verified`).
- ❌ Generación de server block NGINX con el dominio custom verificado.
- ❌ Provisioning de TLS para dominio custom (Let's Encrypt / Cloudflare API).
- ❌ Endpoint de reconciliación manual de NGINX (hoy solo vía restart de platform-core).
- ❌ Alertas de dominio próximo a expirar.

## 11. Branding y personalización visual por tenant

- 🔧 `display_name` por tenant y por app existe; no hay campos de branding visual.
- ❌ Logo por tenant (URL o referencia a `platform/storage`).
- ❌ Colores de marca (primary, secondary, accent) por tenant.
- ❌ Favicon por tenant.
- ❌ URL de homepage/website por tenant.
- ❌ Términos y condiciones / política de privacidad custom por tenant.
- ❌ Pie de email personalizado por tenant (REUSE `platform/notifications`).
- ❌ API de branding para que el tenant-console-shell y las landing apps consuman el tema en runtime.
- ❌ Editor visual de tema en la consola del owner.

## 12. Localización (idioma, zona horaria, moneda)

- ✅ `default_locale` (texto libre, default `'es'`) por tenant — usado por `platform/scheduler` para localizar notificaciones cuando booking/usuario no tienen locale propio.
- 🔧 No hay zona horaria por tenant — las notificaciones de recordatorio se envían en UTC.
- ❌ `timezone` por tenant (IANA, ej. `Europe/Madrid`) — afecta generación de recordatorios, slots de disponibilidad y faturas.
- ❌ `currency` por tenant para apps multi-divisa (separado del `subscription_currency`).
- ❌ `date_format` y `number_format` por tenant para localización de UI.
- ❌ Idiomas disponibles por app (catalog de locales soportados).
- ❌ Locale preferido por usuario (override del tenant `default_locale`).

## 13. Directorio público y resolución de subdominio

- ✅ Listado público de tenants por app (`GET /v1/tenants/public?appId=...`): solo activos, solo campos mínimos (`id`, `display_name`, `subdomain`).
- ✅ Resolución subdomain → tenant (`GET /v1/tenants/by-subdomain/:subdomain`, público): devuelve `tenantId`, `appId`, `displayName`, `status` — sin PII.
- ✅ Listado completo de tenants (`GET /v1/tenants?appId=...`) para staff.
- 🔧 El directorio público no incluye logo ni descripción — limitado a identificación básica.
- ❌ Paginación en el listado público (hoy devuelve todos los activos sin límite).
- ❌ Búsqueda por nombre en el directorio público.
- ❌ Resolución inversa: `tenant_id → subdomain` cacheada en Redis sin hit a DB.
- ❌ Lookup por dominio custom: `custom_domain → tenant_id`.

## 14. Audit log y trazabilidad de cambios

- ✅ Tabla `platform_tenants.audit_log`: `ts`, `actor_user_id`, `actor_role`, `app_id`, `tenant_id`, `action`, `detail`, `ip`.
- ✅ Entradas automáticas en: `TENANT_CREATED`, `TENANT_BOOTSTRAPPED`, `TENANT_SUSPENDED`, `TENANT_ARCHIVED`, `TENANT_REACTIVATED`, `TENANT_UPDATED`, `TENANT_BOOTSTRAP_RESENT`, `TENANT_BOOTSTRAP_REVOKED`.
- ✅ Índices por `(tenant_id, ts DESC)` y `(app_id, ts DESC)`.
- ✅ `GET /v1/audit` con filtros `appId`, `tenantId`, `limit` (max 1000); staff ve todo, owner/admin solo su propio tenant.
- 🔧 `detail` es texto libre — no hay schema de payload estructurado por acción.
- 🔧 No hay audit de cambios en `apps` (alta de app, cambio de estado, módulos, splitpay_enabled).
- ❌ Diff de campos previo/nuevo en `TENANT_UPDATED` (hoy solo lista las claves cambiadas).
- ❌ Paginación del audit log (hoy `LIMIT` sin cursor/offset).
- ❌ Retención y purga automática de entradas antiguas (REUSE `platform/scheduler`).
- ❌ Export del audit log (CSV/JSONL).
- ❌ Firma/inmutabilidad de entradas (hash encadenado o append-only).

## 15. Eventos del dominio (platform.events)

- ✅ `tenant.bootstrap_started` — publicado al crear un tenant (Fase A) y al reenviar activación; payload: `tenantId`, `appId`, `ownerEmail`, `magicLinkUrl`, `expiresAt`, `locale`.
- ✅ `tenant.bootstrap_completed` — publicado automáticamente al detectar todos los pasos obligatorios completados; payload: `tenantId`, `appId`, `ownerEmail`.
- ✅ Subscriber de `splitpay.*` eventos para sincronizar suscripción: `checkout.completed`, `invoice.paid`, `subscription.updated`, `subscription.deleted`, `invoice.payment_failed`.
- ❌ `tenant.created` — evento explícito al crear tenant vía `POST /v1/tenants` (fuera del wizard).
- ❌ `tenant.suspended` / `tenant.archived` / `tenant.reactivated` — eventos que otros módulos necesitan para bloquear acceso o limpiar datos.
- ❌ `tenant.subscription.past_due` / `tenant.subscription.cancelled` — eventos específicos del cambio de estado de suscripción.
- ❌ `app.created` / `app.disabled` — eventos para que otros módulos reaccionen al ciclo de vida de una app.
- ❌ `tenant.config.updated` — evento genérico de cambio de configuración.

## 16. Integración con auth

- ✅ `requires_user_approval` por tenant: leído por `platform/auth` vía grant SELECT mínimo — boundary leak controlado y documentado en migración 0014.
- ✅ Creación del owner vía endpoint interno `/internal/auth/owners` durante el bootstrap.
- ✅ Reemisión de activation token vía `/internal/auth/owners/reissue`.
- ✅ Revocación del owner+tokens vía `/internal/auth/owners?tenantId=...` (DELETE).
- ✅ Consulta del estado del owner (`pending_activation`, `password_set`) vía `/internal/auth/owners/state`.
- ✅ Conteo de admins del tenant para el paso de bootstrap vía `/internal/auth/admins/count`.
- ✅ `jwt_audience` por app — usado por auth para emitir tokens con la audiencia correcta.
- 🔧 El flag `requires_user_approval` se activa manualmente por staff en migraciones; no hay endpoint de gestión.
- ❌ Endpoint de gestión de `requires_user_approval` en el módulo tenant-config (hoy solo hay columna + grant).
- ❌ Política de contraseña por tenant (longitud mínima, expiración, MFA obligatorio).
- ❌ SSO / SAML / OIDC por tenant (IdP externo propio del tenant).
- ❌ IP allowlist por tenant para acceso a la consola.

## 17. Metadata per-app y config dinámica

- ✅ Columna `metadata JSONB` en `apps` con acceso por namespace vía `jsonb_set` idempotente.
- ✅ Namespace `solarCalculator` implementado con defaults físicos, validación Zod, GET público y PATCH protegido.
- ✅ Guard de cross-app en el PATCH: owner/admin de una app no puede escribir en la config de otra; staff/super_admin son universales.
- 🔧 Solo un namespace activo (`solarCalculator`); el patrón es extensible pero sin mecanismo genérico para añadir namespaces desde la consola.
- ❌ Metadata por tenant (JSONB de config específica del tenant, separado de los campos estructurados).
- ❌ Schema/validación registrable por namespace (hoy cada namespace necesita código nuevo).
- ❌ Historial de versiones del metadata por app.
- ❌ Diff/preview antes de aplicar un cambio de metadata.

## 18. Aislamiento, RLS y modelo de datos

- ✅ Toda query de negocio en el módulo usa su propio Pool (`svc_platform_tenants`) — nunca el superusuario en runtime.
- ✅ `migrate.js` usa `MIGRATION_DATABASE_URL` (superusuario) separado del Pool de aplicación.
- ✅ Scoping obligatorio `(app_id, tenant_id)` en todos los módulos de plataforma — documentado como regla crítica en CLAUDE.md.
- ✅ Grant SELECT mínimo a `svc_platform_auth` para `requires_user_approval` — único boundary leak controlado y explícito.
- ✅ FK `tenants.app_id → apps(app_id) ON UPDATE CASCADE` (desde migración 0012).
- ✅ Constraints CHECK en `status`, `plan`, `stripe_status`, `subscription_status`, `subscription_period`.
- 🔧 No hay RLS (Row Level Security) PostgreSQL activo en `platform_tenants` — el scoping es por código de aplicación.
- ❌ RLS policies en `platform_tenants.tenants` y `platform_tenants.audit_log` para garantizar aislamiento a nivel DB.
- ❌ `sub_tenants` tabla con FK a `tenants` — la jerarquía de dos niveles existe en el JWT pero no en el registro.
- ❌ Soft-delete en `tenants` (conservar fila con `deleted_at` en lugar de DELETE físico).
- ❌ Particionado por `app_id` para tablas de alto volumen cuando la plataforma escale.

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. **Eventos `tenant.suspended` / `tenant.archived`** — otros módulos (auth, notifications, scheduler) los necesitan para bloquear acceso y limpiar recursos; coste bajo, impacto alto.
2. **Endpoint de `requires_user_approval`** — hoy solo gestionable vía migraciones SQL; un `PATCH /v1/tenants/:id` ya existe y basta añadir el campo al schema Zod.
3. **`timezone` por tenant** — desbloquea recordatorios correctos en `platform/scheduler` y slots de disponibilidad en horario local; coste bajo (columna + field en PATCH).
4. **`tenant.created` / `app.created` events** — completan el contrato de eventos del dominio y permiten que leads (conversión), notifications y otros módulos reaccionen al alta.
5. **Verificación de dominio custom** (DNS TXT check + estado `dns_verified`) + **server block NGINX con dominio custom** — desbloquea white-labeling completo para tenants enterprise.
6. **Cancelación explícita de suscripción** (`DELETE /v1/tenants/:id/subscription`) + **Customer Portal Stripe** — operativa de negocio que hoy requiere intervención manual en el dashboard de Stripe.
7. **Feature flags por tenant** (sobreescritura del `enabled_modules` del app para un tenant concreto) — permite planes diferenciados sin cambiar el array del app para todos los tenants.
8. **Límites/cuotas por plan** con enforcement real — los campos de volumen ya están; falta la tabla `plan_limits` y los checks en las APIs de negocio.
9. **Tabla `sub_tenants`** — completa el modelo de identidad de dos niveles que el JWT ya declara.
10. **Purga automática del audit log** (REUSE `platform/scheduler`) + **paginación con cursor** — higiene operativa y escalabilidad.
