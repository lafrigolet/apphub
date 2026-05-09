# Tenant bootstrap procedure

Cómo se trae un nuevo tenant a la plataforma — del primer click del staff
en voragine-console hasta el momento en que el owner empieza a operar.

> Distinto de `docs/bootstrap.md`, que crea el primer super_admin de
> AppHub. Este documento describe el flujo de cliente.

## Resumen ejecutivo

Bootstrap en **dos fases independientes**:

- **Fase A — Provisioning** (voragine-console, staff): atómica y corta.
  Staff crea en una sola operación app (si no existe) + tenant + owner +
  configuración técnica básica + magic-link. Termina con un email al
  owner.
- **Fase B — Onboarding** (tenant-console, owner): asíncrona, dirigida
  por el propio owner. Confirma datos, contraseña, paga subscripción,
  invita admins y configura módulos. Puede durar minutos o días.

Las dos fases están desacopladas: la Fase A deja el tenant en estado
*operativo pero pendiente de activación comercial*; la Fase B es opcional
en cada paso (excepto los REQUIRED) y persiste su progreso entre
sesiones.

---

## Fase A — Provisioning (voragine-console)

### A.1 Quién y desde dónde

- Rol: `super_admin` o `staff`.
- Entrada: voragine-console → "Tenants" → botón **"Bootstrap nuevo
  tenant"**. (Distinto del flujo "+ Tenant" actual, que sólo crea la
  fila en `platform_tenants.tenants` y no toca usuarios ni notifica.)

### A.2 Formulario único — secciones

Una sola pantalla con 5 secciones plegables; campos requeridos marcados
con `*`.

| Sección | Campos | Notas |
|---|---|---|
| **App** | `appId` *, `displayName` *, `subdomain` *, `enabledModules` * | Selector "App existente" / "Nueva app". Si nueva → crea fila en `platform_tenants.apps`. |
| **Identidad del tenant** | `displayName` *, `legalName`, `cif`, `country`, `contactEmail` *, `contactPhone`, `address`, `defaultLocale` | `subdomain` lo deriva del `displayName` (slugificado, editable). |
| **Owner** | `email` *, `displayName` * | Sin contraseña — la pone el owner vía magic-link. |
| **Subscripción a la plataforma** | `period`, `amountCents`, `currency`, `stripePriceId`, `billingEmail` | Todos opcionales. Si `stripePriceId` está vacío, el owner verá "subscripción no configurada — contacta soporte" hasta que staff lo complete. |
| **Feature flags** | `splitpayEnabled`, `customDomain` | Cada app define qué flags aplican. |

### A.3 Acción atómica — `POST /v1/tenants/bootstrap`

Endpoint nuevo. Todo en **una transacción** + un par de side-effects
post-commit (NGINX + email):

1. INSERT (o UPSERT) en `platform_tenants.apps` (si la app es nueva).
2. INSERT en `platform_tenants.tenants` con:
   - `status = 'active'`
   - `bootstrap_started_at = now()`
   - `bootstrap_completed_at = NULL`
   - resto de campos del formulario.
3. INSERT en `platform_auth.users` con:
   - `role = 'owner'`
   - `password_hash = NULL`
   - `pending_activation = true` *(columna nueva)*.
4. INSERT en `platform_auth.activation_tokens` *(tabla nueva)*:
   - `user_id`, `token_hash` (sha256 del token plano), `expires_at = now() + 7 days`, `consumed_at = NULL`.
5. INSERT en `platform_tenants.audit_log` (acción `TENANT_BOOTSTRAPPED`).
6. **Commit**.
7. Publish NGINX subdomain config (`writeTenantNginxConfig`) — best-effort, ya existe.
8. Publish evento `tenant.bootstrap_started` en `platform.events`.
9. Notifications module consume el evento y manda el email "Bienvenido a
   `<App>`" al owner con el link:
   ```
   https://<subdomain>.apphub.com/activate?token=<token-plano>
   ```

Si cualquier paso 1–6 falla → ROLLBACK + 4xx/5xx al staff con detalle.
Si los pasos 7–9 fallan, el tenant ya está provisionado: staff puede
re-disparar desde la vista detalle del tenant ("Reenviar magic-link").

### A.4 Magic-link landing

URL: `https://<subdomain>.apphub.com/activate?token=...`

El portal de la app (no la landing pública) acepta esa ruta y la
delega al backend:

1. `POST /v1/auth/activate` con `{ token, password }`.
2. Backend:
   - Lookup en `activation_tokens` por `token_hash`.
   - Valida `expires_at > now()` y `consumed_at IS NULL`.
   - Si OK: setea `password_hash`, marca usuario con
     `pending_activation = false, owner_activated_at = now()`, marca
     token `consumed_at = now()`.
   - Emite par `accessToken / refreshToken` (mismo flujo que `/login`).
   - Publica `tenant.activated` en `platform.events`.
3. El portal redirige a `/consola?bootstrap=welcome`.

Soporte OAuth: si el owner prefiere "Continuar con Google" en vez de
fijar contraseña, el handler activate puede aceptar también
`{ token, provider: 'google', credential }` y reutilizar el flujo
`/oauth/google` existente.

### A.5 Estado del tenant tras Fase A

- Filas creadas en BD; el tenant es técnicamente accesible.
- Owner aún no puede entrar (no tiene password). Cualquier login antes
  de activate → error "Cuenta pendiente de activación".
- Staff ve el tenant en la lista con badge **"Pendiente de activación"**
  hasta que `owner_activated_at IS NOT NULL`.

### A.6 Reenvío y revocación

Vista detalle de tenant (voragine-console) gana 2 acciones:

- **Reenviar magic-link**: invalida tokens previos del owner y emite
  uno nuevo. Audit-logged.
- **Revocar tenant pendiente**: borra tenant + owner + tokens (sólo
  permitido mientras `owner_activated_at IS NULL` y no hay rows en
  módulos). Audit-logged.

---

## Fase B — Onboarding (tenant-console)

### B.1 Entry point

Owner aterriza en `/consola?bootstrap=welcome` (primera vez) o
`/consola` (siguientes). El AdminShell mira:

- Si `bootstrap_completed_at IS NULL` → renderiza el panel **"Configura
  tu cuenta"** como dashboard primario, ocultando los demás módulos
  hasta que el owner lo cierre.
- Si `bootstrap_completed_at IS NOT NULL` → dashboard normal.

El owner puede minimizar el panel; vuelve al refrescar mientras queden
tareas REQUIRED pendientes.

### B.2 Checklist — tareas

| # | Clave | Tarea | Requerida | Cómo se marca completada |
|---|---|---|---|---|
| 1 | `identity` | Verificar datos de la organización | ✅ | `legal_name` + `cif` + `country` + `address` no NULL |
| 2 | `password` | Establecer contraseña | ✅ | `password_hash IS NOT NULL` (típicamente ya cumplido en magic-link) |
| 3 | `subscription` | Activar subscripción | ✅ | `subscription_status IN ('active','trial')` |
| 4 | `splitpay-connect` | Conectar Stripe Connect | Sólo si `splitpay_enabled` | Existe row en `payments.connect_accounts` con `kyc_status='verified'` |
| 5 | `admins` | Invitar a tu equipo | Opcional | ≥1 user con `role='admin'` además del owner |
| 6 | `email-domains` | Configurar dominio de email | Opcional | ≥1 dominio en `platform_notifications.email_domains` con `status='verified'` |
| 7 | `custom-domain` | Conectar dominio propio | Opcional | `custom_domain IS NOT NULL` y DNS verificado |
| 8 | `modules` | Activar módulos | Opcional | `enabled_modules` ha sido modificado por el tenant |
| 9 | `first-data` | Crear tus primeros datos | Opcional | ≥1 row en la tabla principal de la app (catálogo, servicios, menú…) |

### B.3 Persistencia — derivada, no almacenada

**Decisión**: el estado de cada paso se **calcula** a partir de los
datos del propio sistema, sin tabla auxiliar. Esto evita
desincronización entre la checklist y la realidad: si el owner edita
sus datos fuera del flujo, el progreso se actualiza solo.

Excepción: si en algún paso hace falta guardar metadata específica del
flujo (e.g. "owner pulsó *skip* en el paso 5"), se añade entonces una
columna JSONB `bootstrap_meta` en `tenants` — no antes.

`bootstrap_completed_at` se setea automáticamente la primera vez que
todos los pasos REQUIRED están en `done`. Es write-once: si una
subscripción cae a `past_due` después, el panel no reaparece — eso lo
maneja un banner separado en el dashboard.

### B.4 Endpoint de soporte — `GET /v1/tenants/:id/bootstrap`

Devuelve el JSON que la UI necesita:

```json
{
  "tenantId": "...",
  "completedAt": null,
  "steps": [
    { "key": "identity",         "required": true,  "status": "done",       "doneAt": "...", "cta": null },
    { "key": "password",         "required": true,  "status": "done",       "doneAt": "...", "cta": null },
    { "key": "subscription",     "required": true,  "status": "pending",    "doneAt": null,  "cta": "POST /v1/tenants/:id/subscribe" },
    { "key": "splitpay-connect", "required": false, "status": "not_applicable", "doneAt": null, "cta": null },
    ...
  ]
}
```

La lógica vive en `tenant-config` (mismo módulo que ya tiene
`getTenantSubscription`) y compone su respuesta consultando los
módulos relevantes vía SQL directo (todo está en schemas `platform_*`,
no se cruza ninguna frontera de app).

### B.5 Eventos publicados

En `platform.events`:

- `tenant.bootstrap_started` — al final de Fase A.
- `tenant.activated` — al consumir magic-link.
- `tenant.bootstrap_step_completed` — cada vez que un paso pasa a `done`
  (lo emite el endpoint que lo causó: `tenants.routes` para identity,
  `auth.routes` para password, `splitpay/webhook` para subscription, etc.).
- `tenant.bootstrap_completed` — cuando todos los REQUIRED están done.

Notifications consume estos eventos para:

- Magic-link al owner (start).
- Recordatorio "Activa tu cuenta" a las 24h y 72h si no hay activación.
- "Bienvenido — completa tu setup" al activar.
- "Tu setup está completo" al completar (al staff y al owner).
- Recordatorios opcionales si pasan >X días con la fase B sin acabar.

---

## Edge cases

| Escenario | Comportamiento |
|---|---|
| Magic-link expirado | Landing muestra mensaje + botón "Pedir nuevo enlace" → reemite token y email. |
| Token usado dos veces | Segunda llamada → 410 Gone con mensaje claro. |
| Owner equivoca email | Staff corrige `email` desde voragine-console (audit-logged) y "Reenviar magic-link". |
| Tenant abandonado en Fase A | Staff puede revocar (sólo si `owner_activated_at IS NULL` y no hay datos). |
| Tenant abandonado en Fase B | Voragine-console muestra dashboard "Tenants en onboarding" con días desde `bootstrap_started_at`. |
| Subscripción cae a `past_due` durante Fase B | Paso 3 vuelve a `pending`; el panel reaparece sólo si la fase no se había completado todavía. |
| Cambio de owner antes de activar | Staff puede sustituir el email del owner pre-activate; tras activate sólo es posible promover otro admin a owner (flujo separado). |

---

## Inventario — qué existe y qué falta

### Ya existe en el repo

- `POST /v1/tenants` — crea fila tenant.
- `POST /v1/auth/register` — crea user (con password obligatorio).
- `PATCH /v1/tenants/:id` — actualiza identidad, locale, subscripción.
- `POST /v1/tenants/:id/subscribe` — Stripe Checkout vía splitpay.
- `POST /v1/splitpay/connect-accounts` — Stripe Connect KYC.
- `POST /v1/notifications/email-domains` — DKIM/SPF.
- `writeTenantNginxConfig` — auto-provisioning de subdominio.
- `audit_log` para trazas administrativas.

### Por crear

| Pieza | Tipo | Notas |
|---|---|---|
| `POST /v1/tenants/bootstrap` | endpoint | Atómico app+tenant+owner+token. |
| `POST /v1/auth/activate` | endpoint | Consume token, fija password u OAuth. |
| Tabla `platform_auth.activation_tokens` | migración | `(token_hash, user_id, expires_at, consumed_at)`. |
| Columna `pending_activation` en `users` | migración | Bloquea login normal hasta consumir token. |
| Columnas `bootstrap_started_at`, `bootstrap_completed_at` en `tenants` | migración | Ya hay `subscription_*`; estas son el siguiente bloque. |
| `GET /v1/tenants/:id/bootstrap` | endpoint | Status derivado, lo consume la UI. |
| Plantillas de email | seed `notifications.templates` | welcome, reminder, completed. |
| Wizard "Bootstrap nuevo tenant" | UI voragine-console | Form único de 5 secciones. |
| Vista "Tenants en onboarding" | UI voragine-console | Lista con días desde start, acciones reenviar / revocar. |
| Panel "Configura tu cuenta" | módulo tenant-console-ui | `modules/bootstrap/` con manifest + view. |
| Página `/activate?token=` | UI aikikan-portal (y plantilla) | Aterriza desde el email del owner. |

---

## Próximo paso recomendado

Dividir la implementación en tres entregables independientes que se
pueden mergear por separado:

1. **Backend bootstrap atómico** — migraciones + endpoints `bootstrap` y
   `activate` + emails. Sin UI todavía. Probable smoke-test con `curl`.
2. **UI staff** — wizard en voragine-console + lista "Tenants en
   onboarding".
3. **UI owner** — módulo `bootstrap` en tenant-console-ui + página
   `/activate` en aikikan-portal (resto de portales lo heredan al usar
   el mismo paquete).
