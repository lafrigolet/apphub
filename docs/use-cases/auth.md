# Casos de uso — `platform/auth` (platform-core)

> Dominio: autenticación y gestión de identidad — registro, login email/password + OAuth (Google, Facebook), emisión de JWT con claims `app_id/tenant_id/sub_tenant_id/role/email`, ciclo de vida de usuarios, invitaciones, aprobación, sesiones, recuperación de contraseña, magic links, bootstrap de tenants.

## Estado actual (implementado)

Registro email/password con `(app_id, tenant_id)` scoping y RLS; login con fallback de resolución de tenant; tokens de acceso JWT RS256 (15 min) + refresh token (Redis, TTL configurable); OAuth Google (id_token) + Facebook (accessToken) con upsert de conexión y vinculación por email; recuperación de contraseña (token UUID, 1 h TTL); magic-link passwordless (SHA-256 del token plano, 15 min TTL, single-use); invitación por admin; solicitud de alta con `pending_approval`; aprobación/rechazo de solicitudes; revocación soft-delete; cambio de rol; perfil propio; bootstrap de owner de tenant (activation_token, 7 d TTL); reenvío de invitación; validación interna de JWT (`/internal/validate`); configuración de providers OAuth en DB encriptada (AES-256-GCM); bloqueo de cuenta por intentos fallidos (5 intentos → 15 min). Teléfono guardado (sin verificación OTP). RLS con política de aislamiento por `(app_id, tenant_id)` + bypass `staff_access`. Eventos Redis: `user.registered`, `auth.password_reset_requested`, `auth.magic_link_requested`, `auth.signup.requested`, `auth.signup.approved`, `auth.signup.rejected`, `auth.magic_link_blocked_pending_approval`, `tenant.activated`.

Leyenda: ✅ implementado · 🔧 parcial · ❌ no implementado.

---

## 1. Registro / alta de usuario

- ✅ Registro email + password (`POST /v1/auth/register`) con `(app_id, tenant_id, sub_tenant_id)` scoping.
- ✅ Hashing bcrypt con factor 12.
- ✅ Unicidad por `(app_id, tenant_id, email)` — error `409 EMAIL_CONFLICT`.
- ✅ Rol asignable en registro (default `user`).
- ✅ Solicitud de alta (self-register) con `pending_approval=true` para tenants con `requires_user_approval` — `POST /v1/auth/request-membership`.
- ✅ Registro vía OAuth (Google/Facebook) — misma tabla; `pending_approval` respetado.
- ✅ Evento `user.registered` / `auth.signup.requested` publicado en `platform.events`.
- 🔧 `password_hash` acepta NULL (owners pre-activación y usuarios OAuth sin contraseña), pero no hay una ruta explícita de "registro sin contraseña / only-OAuth".
- ❌ Verificación de email post-registro (confirmation link antes de poder iniciar sesión).
- ❌ Doble opt-in (email enviado, usuario debe confirmar antes de ser `active`).
- ❌ Registro por invitación a sub-tenant específico (`sub_tenant_id` en el flow de invite).
- ❌ Registro con código de referido / join-code / link de invitación pública.
- ❌ CAPTCHA / honeypot / turnstile en endpoints de registro y solicitud de alta.
- ❌ Rate-limiting por IP en endpoints públicos de registro.
- ❌ Validación de email real: MX check, detección de dominios desechables (disposable), `role-based` como `info@`, `noreply@`.
- ❌ Normalización/validación de nombre propio (longitud mínima, caracteres permitidos, filtro de nombres de spam).

## 2. Login email/password

- ✅ Login `POST /v1/auth/login` con `(appId, tenantId, email, password)`.
- ✅ Fallback de resolución automática de `(app_id, tenant_id)` cuando el cliente no los envía (usuario único en la plataforma).
- ✅ Comprobación de cuenta bloqueada (`locked_until`).
- ✅ Incremento de intentos fallidos + bloqueo automático tras 5 intentos (15 min).
- ✅ Reset del contador al login correcto.
- ✅ Bloqueo por `pending_approval` (→ `403 PENDING_APPROVAL`) y `pending_activation` (→ `401 PENDING_ACTIVATION`).
- ✅ Bloqueo de cuentas revocadas (`revoked_at IS NOT NULL`).
- ✅ Registro de `last_login_at`.
- 🔧 Política de lockout fija (5 intentos, 15 min) — no configurable por tenant ni por nivel de riesgo.
- ❌ Notificación al usuario (email/push) tras login desde dispositivo nuevo o ubicación inusual.
- ❌ Detección de credential stuffing / rate limiting por IP en endpoint de login.
- ❌ Tiempo de respuesta constante (constant-time comparison) frente a enumeración de emails — la rama `resolveUserTenant` usa un ROLLBACK que puede tener timing diferente.
- ❌ Login con nombre de usuario alternativo (username) en lugar de email.
- ❌ Soporte de alias de email (varios correos apuntando al mismo usuario).
- ❌ Remember-me / sesión larga opcional (vs. siempre 15 min de access).
- ❌ Modo "solo lectura" temporal (acceso degradado cuando la cuenta tiene flags de riesgo).

## 3. Login OAuth (Social)

- ✅ Login/registro con Google (`POST /v1/auth/oauth/google`) mediante `credential` (id_token verificado con `google-auth-library`).
- ✅ Login/registro con Facebook (`POST /v1/auth/oauth/facebook`) con verificación del token via Graph API `debug_token`.
- ✅ Vinculación automática por email existente (si el email ya existe → attach connection).
- ✅ Upsert de `oauth_connections` (provider_uid único) con actualización de `name`, `avatar_url`.
- ✅ Respeto de `pending_approval` en flujo OAuth — devuelve `403 PENDING_APPROVAL` si el tenant requiere gating.
- ✅ Configuración de `client_id` / `client_secret` por DB (AES-256-GCM), con fallback a env vars.
- ✅ Flag `enabled` por provider — se puede desactivar sin tocar env.
- 🔧 Solo Google y Facebook — esquema preparado para más proveedores pero sólo dos implementados.
- 🔧 `avatar_url` y `name` guardados en `oauth_connections` pero no sincronizados automáticamente al perfil de usuario.
- ❌ OAuth con Apple (Sign in with Apple / SIWA) — importante para apps iOS.
- ❌ OAuth con Microsoft / Azure AD — relevante para clientes B2B.
- ❌ OAuth con GitHub, LinkedIn, Twitter/X.
- ❌ OIDC genérico (Authorization Code Flow) — soporte de cualquier proveedor OIDC (Keycloak, Auth0, Okta, Cognito).
- ❌ SAML 2.0 SSO — necesario para clientes enterprise.
- ❌ Desvinculación de provider OAuth desde perfil propio (`DELETE /v1/users/me/oauth/:provider`).
- ❌ Listado de conexiones OAuth del usuario (`GET /v1/users/me/oauth`).
- ❌ Prevención de creación de cuenta nueva si solo se quiere vincular (no crear) — hoy siempre crea cuenta si no encuentra por `provider_uid` ni por email.
- ❌ Manejo de scope adicional (acceso a Calendar, Drive, etc.) — actualmente solo identidad.

## 4. Magic links / passwordless

- ✅ Solicitud de magic-link (`POST /v1/auth/request-magic-link`) — silencioso ante emails desconocidos.
- ✅ Generación de token de 32 bytes URL-safe; solo SHA-256 guardado en DB.
- ✅ TTL de 15 min, single-use (consume al login).
- ✅ Login con magic-link (`POST /v1/auth/login-with-magic-link`) — devuelve `access+refresh` igual que login normal.
- ✅ Bloqueo si `pending_approval` / `pending_activation` / `revoked_at`.
- ✅ Evento `auth.magic_link_blocked_pending_approval` — notificación informativa al usuario con cuenta en espera.
- ✅ Reenvío de invitación por admin (`POST /v1/users/:id/resend-invitation`) — mismo evento, mismo store.
- 🔧 Limpieza de magic_links expirados: el scheduler podría hacerlo pero no hay job registrado (comentario en la migration sugiere V1 deja crecer).
- 🔧 No hay rate-limiting para evitar bombing de emails con solicitudes de magic-link al mismo usuario.
- ❌ Magic-link con redirect configurable por `app_id` (URL de destino post-login).
- ❌ Magic-link de login que también activa la cuenta en un solo paso (el `activate` es un flujo separado para owners).
- ❌ Email OTP de 6 dígitos como alternativa al link (más fácil de copiar en móvil).
- ❌ SMS OTP (`phone_number` está en DB pero `phone_verified_at` nunca se setea).
- ❌ WhatsApp OTP.
- ❌ Expiración configurable por tenant (hoy 15 min fijo en código).
- ❌ Magic-link para cambio de email verificado (antes de pisar el email hay que verificar el nuevo).

## 5. Recuperación de contraseña

- ✅ Solicitud (`POST /v1/auth/forgot-password`) — silencioso, sin enumeración de emails.
- ✅ Token UUID con TTL 1 h guardado en `password_resets`; sólo guardado el token en BD sin hashing.
- ✅ Restablecimiento (`POST /v1/auth/reset-password`) con `used_at` seteado tras consumir.
- ✅ Invalidación de todos los refresh tokens del usuario tras reset (barrido por patrón Redis).
- ✅ Evento `auth.password_reset_requested` — el módulo `notifications` envía el email.
- 🔧 El token de reset se guarda como UUID plano en DB — a diferencia de magic-links y activation tokens que guardan SHA-256. Si se compromete la BD, los tokens de reset activos son directamente explotables.
- ❌ Enforce de política de contraseña (mínimo de longitud=8 hay, pero sin requisitos de complejidad, sin lista de contraseñas comunes/HIBP).
- ❌ Historial de contraseñas (prohibir reutilizar las últimas N).
- ❌ Notificación de confirmación al usuario tras reset exitoso (email "tu contraseña fue cambiada").
- ❌ Cancelación del enlace de reset antes de que expire (si el usuario lo inició por error).
- ❌ Flujo de cambio de contraseña autenticado (`PATCH /v1/users/me/password` con `currentPassword` + `newPassword`).
- ❌ Vencimiento de contraseña por política (forzar cambio cada N días — relevante para entornos regulados).

## 6. Sesiones y tokens

- ✅ JWT de acceso: 15 min, claims `sub/app_id/tenant_id/sub_tenant_id/role/email`, firmado con `PLATFORM_JWT_SECRET`.
- ✅ Refresh token: UUID v4, TTL configurable (`PLATFORM_JWT_REFRESH_DAYS`), almacenado en Redis con clave `{appId}:{tenantId}:refresh:{userId}:{token}`.
- ✅ Refresh rotativo (el refresh token se consume y emite uno nuevo en cada `/refresh`).
- ✅ Validación interna de JWT (`GET /internal/validate`) para otros módulos/servicios.
- ✅ Revocación de todos los refresh tokens del usuario en el reset de contraseña.
- 🔧 Logout no existe como endpoint explícito — para invalidar hay que borrar el refresh token desde el cliente (sin endpoint `DELETE /v1/auth/session`).
- 🔧 Un mismo usuario puede tener múltiples refresh tokens activos simultáneamente sin límite — sin control de sesiones concurrentes.
- ❌ Logout (`DELETE /v1/auth/session` o `POST /v1/auth/logout`) que invalide el refresh token específico en Redis.
- ❌ Logout global ("cerrar todas las sesiones") que borre todos los refresh tokens del usuario.
- ❌ Listado de sesiones activas del usuario (`GET /v1/users/me/sessions`) — dispositivo, IP, última actividad.
- ❌ Revocación selectiva de sesiones por dispositivo/sesión desde el propio usuario.
- ❌ Límite de sesiones concurrentes por usuario (max N refresh tokens activos).
- ❌ Detección de refresh token reuse (si se reutiliza un token ya girado → sesión comprometida → invalidar todo).
- ❌ JWT de acceso con algoritmo asimétrico (RS256/ES256 con par de claves pública/privada) — hoy es HMAC simétrico (`PLATFORM_JWT_SECRET`), lo que impide que otros servicios validen el token sin compartir el secreto.
- ❌ Revocación de JWT activos (blacklist en Redis) para casos de compromiso antes del TTL de 15 min.
- ❌ Claims adicionales configurables por tenant (e.g. `permissions[]`, `org_id`).
- ❌ Impersonation segura de usuario por staff (emitir token en nombre de otro con claim `impersonated_by`).

## 7. Bootstrap de tenant / owner

- ✅ Creación de owner con `pending_activation=true` y `password_hash=NULL` (`POST /internal/auth/owners`).
- ✅ `activation_token` SHA-256 con TTL configurable (default 7 días).
- ✅ Activación (`POST /v1/auth/activate`): fija contraseña, limpia `pending_activation`, setea `owner_activated_at`, emite `tenant.activated`.
- ✅ Reenvío de activation token (`POST /internal/auth/owners/reissue`) con invalidación de tokens previos.
- ✅ Estado del owner (`GET /internal/auth/owners/state`) — `password_set`, `activated`.
- ✅ Borrado del owner pendiente (`DELETE /internal/auth/owners`) — idempotente, rechaza si ya activó.
- ✅ Conteo de admins (`GET /internal/auth/admins/count`) — paso del checklist de bootstrap.
- ✅ Evento `tenant.activated` publicado para que otros módulos inicialicen su estado.
- 🔧 Solo un owner por tenant (consulta `LIMIT 1` por `role='owner'`) — no hay soporte de co-owners nativos.
- ❌ Transferencia de propiedad de tenant (owner → otro usuario).
- ❌ Notificación al owner cuando quedan N días para que el token expire (recordatorio de activación).
- ❌ Flujo de self-service re-activación (si el owner perdió el email, no puede solicitar nuevo link sin staff).

## 8. Gestión de usuarios por admin

- ✅ Listado de usuarios con filtro por `role`, `pending=approval`, `appId`, `tenantId` — `GET /v1/users`.
- ✅ Lectura de usuario por id — `GET /v1/users/:id`.
- ✅ Actualización de campos seguros (`display_name`) — `PATCH /v1/users/:id`.
- ✅ Cambio de rol — `PATCH /v1/users/:id/role`.
- ✅ Invitación de usuario: crea cuenta + dispara magic-link — `POST /v1/users/invite`.
- ✅ Aprobación de solicitud pendiente — `POST /v1/users/:id/approve` (flip `pending_approval` + magic-link de bienvenida).
- ✅ Rechazo de solicitud pendiente — `POST /v1/users/:id/reject` (hard-delete + evento `auth.signup.rejected` con `reason`).
- ✅ Revocación (soft-delete, `revoked_at`) — `DELETE /v1/users/:id`.
- ✅ Reenvío de invitación (magic-link) — `POST /v1/users/:id/resend-invitation`.
- 🔧 Listado sin paginación — puede volverse lento con tenants grandes.
- 🔧 Listado sin búsqueda full-text — no se puede filtrar por email parcial o nombre.
- ❌ Paginación (cursor o offset) en `GET /v1/users`.
- ❌ Búsqueda full-text por email / display_name.
- ❌ Filtros adicionales: `created_at` rango, `last_login_at`, `revoked`, `locked`.
- ❌ Ordenación configurable.
- ❌ Acciones masivas (bulk invite / bulk revoke / bulk role-change).
- ❌ Exportación CSV/XLSX del directorio de usuarios.
- ❌ Re-activación de usuario revocado (hoy `revoked_at` no se puede deshacer sin SQL directo).
- ❌ Notas internas sobre el usuario (campo `admin_notes` por admin, no visible para el usuario).
- ❌ Historial de cambios de rol (audit log).
- ❌ Visualización de sesiones activas del usuario desde el admin.
- ❌ Force-logout de un usuario específico (invalida todos sus refresh tokens desde admin).

## 9. Perfil propio del usuario

- ✅ Lectura del perfil propio — `GET /v1/users/me` (a partir del JWT).
- ✅ Actualización de `display_name` — `PATCH /v1/users/me`.
- 🔧 Campos disponibles muy limitados — solo `display_name`; no hay `avatar_url`, `locale`, `timezone`, `bio`, etc. expuestos desde este endpoint.
- ❌ Cambio de email autenticado con flujo de verificación (old email → confirmar → new email → verificar).
- ❌ Cambio de contraseña autenticado (`currentPassword` + `newPassword`).
- ❌ Subida / cambio de avatar (REUSE `platform/storage` — presigned URL).
- ❌ Preferencias: idioma (`locale`), zona horaria, formato de fecha.
- ❌ Notificaciones de seguridad: recibir email al cambiar contraseña, al añadir OAuth, al login desde IP nueva.
- ❌ Exportación de datos propios (GDPR portabilidad) — JSON/zip de todos los datos del usuario.
- ❌ Baja voluntaria / eliminación de cuenta con flujo de confirmación.
- ❌ Vinculación / desvinculación de métodos de autenticación OAuth desde perfil.
- ❌ Listado de dispositivos/sesiones activas desde `/me`.

## 10. Roles y control de acceso (RBAC)

- ✅ Roles predefinidos en el sistema: `user`, `admin`, `owner`, `staff`, `super_admin`.
- ✅ `appGuard` en `@apphub/platform-sdk`: valida JWT + `EXPECTED_APP_ID` → `403 APP_MISMATCH`.
- ✅ `requireRole('super_admin', 'staff')` para rutas admin de OAuth providers.
- ✅ Guard `STAFF_ROLES` inline en `users.routes.js` — staff/super_admin/admin/owner pueden gestionar usuarios.
- ✅ Aislamiento de tenant en listado (no-staff solo ve su propio `(app_id, tenant_id)`).
- ✅ Protección anti-auto-revocación (`Cannot revoke yourself`) y anti-auto-role-change.
- 🔧 Roles son strings libres en DB (check solo a nivel de código, no constraint SQL) — se puede insertar cualquier rol desde SQL directo.
- 🔧 No hay jerarquía de roles formal — la lógica `STAFF_ROLES` está duplicada en varios archivos.
- ❌ Permisos granulares (RBAC fino: `orders:read`, `users:invite`, …) — hoy solo roles de grano grueso.
- ❌ ABAC (Attribute-Based Access Control) — políticas basadas en atributos del recurso (ej. `tenant_id`, `sub_tenant_id`, país).
- ❌ Roles personalizados por tenant (cada tenant define sus propios roles + permisos).
- ❌ Grupos de usuarios (group membership) como mecanismo de herencia de permisos.
- ❌ Scopes en JWT (`permissions[]` claim) para que los microservicios no tenga que llamar al auth para verificar capacidades.
- ❌ Delegación de rol (un usuario puede actuar temporalmente con permisos de otro).
- ❌ Herencia de roles en sub-tenants (`sub_tenant_id` scope con rol heredado del tenant padre).
- ❌ UI de gestión de roles + permisos (hoy no existe pantalla de configuración de roles personalizados).

## 11. Multi-factor authentication (MFA / 2FA)

- ❌ TOTP (Time-based One-Time Password) — Google Authenticator, Authy, 1Password.
- ❌ HOTP (counter-based OTP).
- ❌ Códigos de recuperación (backup codes) al activar TOTP.
- ❌ SMS OTP — el teléfono está en DB (`phone_number`, `phone_verified_at`) pero el flujo no está implementado (REUSE `platform/notifications` para envío de SMS).
- ❌ Email OTP como segundo factor (diferente al magic-link: aquí es 2FA adicional tras el primer factor).
- ❌ WebAuthn / FIDO2 / Passkeys — autenticación sin contraseña con biometría/llave hardware (Touch ID, Face ID, YubiKey).
- ❌ Push notification como 2FA (app móvil confirma login).
- ❌ MFA obligatoria por tenant (política que fuerza a todos los usuarios a enrolar un segundo factor).
- ❌ Bypass de MFA en IPs de confianza / trusted devices.
- ❌ Gestión de dispositivos de confianza (remember this device 30 días).
- ❌ Listado y revocación de factores enrolados desde perfil propio.
- ❌ Recovery flow si el usuario pierde acceso al 2FA.

## 12. Passkeys / WebAuthn

- ❌ Registro de passkey (`navigator.credentials.create`) — generación de desafío, verificación de attestation.
- ❌ Login con passkey (`navigator.credentials.get`) — generación de assertion, verificación de signature.
- ❌ Tabla de credenciales WebAuthn (`credential_id`, `public_key`, `counter`, `aaguid`, `user_agent`).
- ❌ Soporte multi-device passkeys (iCloud Keychain, Google Password Manager).
- ❌ Gestión de passkeys registradas desde perfil (listar, renombrar, revocar).
- ❌ Passkey como único factor (passwordless + phishing-resistant).
- ❌ Compatibilidad con autenticadores hardware (YubiKey 5 NFC, etc.).

## 13. Single Sign-On (SSO) empresarial

- ❌ SAML 2.0 IdP-initiated y SP-initiated SSO.
- ❌ OIDC Authorization Code Flow + PKCE (soporte de proveedores genéricos: Okta, Azure AD, Keycloak, Auth0, Ping Identity).
- ❌ Discovery de IdP por dominio de email (si `@empresa.com` → usar Azure AD de ese tenant).
- ❌ Configuración de SSO por tenant (cada tenant puede enchufar su propio IdP).
- ❌ Just-in-time provisioning de usuarios vía SAML assertions.
- ❌ Mapeo de atributos SAML/OIDC → claims AppHub (`role`, `sub_tenant_id`, etc.).
- ❌ Logout federado (SLO — Single Logout).
- ❌ SCIM 2.0 — aprovisionamiento y desaprovisionamiento automático de usuarios desde el IdP del cliente (necesario para clientes enterprise grandes).
- ❌ Active Directory / LDAP integration.

## 14. Seguridad y anti-abuso

- ✅ Bloqueo por intentos fallidos: 5 intentos → `locked_until = now() + 15 min`.
- ✅ Tokens de activación y magic-link: SHA-256 del token plano — dump de BD no suficiente para explotar.
- ✅ RLS por `(app_id, tenant_id)` + bypass `staff_access` controlado.
- ✅ Respuestas silenciosas en `forgot-password`, `request-magic-link` — evita enumeración de emails.
- ✅ Refresh token rotativo — limita la ventana de explotación de un token robado.
- 🔧 Tokens de `password_resets` guardados como UUID plano (no SHA-256) — riesgo ante dump de DB.
- 🔧 Bloqueo de login fijo (5/15 min) no configurable por tenant ni graduado (progressive backoff).
- 🔧 Sin rate-limiting por IP en endpoints públicos de autenticación (login, register, forgot, magic-link).
- ❌ Rate-limiting / throttling en todos los endpoints públicos (REUSE middleware `fastify-rate-limit`).
- ❌ CAPTCHA / hCaptcha / Cloudflare Turnstile en endpoints sensibles.
- ❌ Detección de credential stuffing / password spraying (múltiples IPs, un email; o múltiples emails, una IP).
- ❌ Listas negras de IPs y dominios (bloqueo proactivo).
- ❌ Notificación al usuario de eventos de seguridad: login nuevo dispositivo, cambio de contraseña, 2FA añadido/eliminado (REUSE `platform/notifications`).
- ❌ Hashing del token en `password_resets` (paridad con magic-links y activation_tokens).
- ❌ Auditoría de eventos de seguridad con IP/User-Agent (tabla `auth_events` o REUSE un módulo de audit).
- ❌ Verificación de contraseña contra HIBP (Have I Been Pwned) al crear/cambiar.
- ❌ Detección y bloqueo de TOR exit nodes / VPNs de alto riesgo.
- ❌ Geo-fencing por tenant (permitir login solo desde ciertos países).
- ❌ Alerta de login desde ubicación inusual (geolocalización por IP).

## 15. Verificación de teléfono / OTP SMS

- 🔧 Columnas `phone_number`, `phone_verified_at`, `phone_consent_at` en DB — schema listo pero sin implementación.
- ❌ Enrolamiento de número de teléfono con verificación OTP (`POST /v1/users/me/phone/enroll`).
- ❌ Envío de OTP SMS (REUSE `platform/notifications` — canal SMS Twilio/Vonage).
- ❌ Verificación del OTP recibido (`POST /v1/users/me/phone/verify`).
- ❌ Seteo de `phone_verified_at` y `phone_consent_at` tras OTP correcto.
- ❌ Cambio de número de teléfono con re-verificación.
- ❌ Uso del teléfono verificado como segundo factor (2FA SMS).
- ❌ Lookup de usuario por teléfono (índice existe en DB, pero no hay endpoint).
- ❌ Baja / desvinculación de número de teléfono con confirmación.

## 16. Audit log e historial de actividad

- 🔧 `last_login_at` registrado en el user row — solo el último login, sin historial.
- 🔧 `failed_login_attempts` y `locked_until` registrados pero sin historial de intentos.
- ❌ Tabla `auth_events` o equivalente: cada login, logout, reset, magic-link, cambio de rol, revocación — con `ip`, `user_agent`, `timestamp`, `result`.
- ❌ Historial de cambios de rol (quién cambió a quién, de qué rol a cuál, cuándo).
- ❌ Historial de cambios de contraseña.
- ❌ Historial de conexiones OAuth añadidas/eliminadas.
- ❌ Listado de intentos de login fallidos por usuario.
- ❌ Alertas por eventos de seguridad inusuales (muchos intentos fallidos, login de nuevo país).
- ❌ Export del audit log para compliance (RGPD, ISO 27001, SOC 2).
- ❌ Retención configurable del audit log (purga automática vía REUSE `platform/scheduler`).

## 17. Privacidad y cumplimiento (GDPR / LOPDGDD)

- ❌ Registro de consentimiento explícito al crear cuenta: texto legal, versión, timestamp — obligatorio bajo RGPD/LOPDGDD.
- ❌ Base legal del tratamiento (`legitimate_interest`, `contract`, `consent`) por tipo de datos.
- ❌ Derecho de acceso: endpoint `GET /v1/users/me/export` — JSON/zip de todos los datos personales del usuario.
- ❌ Derecho de supresión (right to be forgotten): anonimización / borrado completo de datos de un usuario.
- ❌ Derecho de rectificación: cambio de email con verificación (más allá de `display_name`).
- ❌ Portabilidad de datos: exportación en formato estándar (JSON, CSV).
- ❌ Retención y purga automática de cuentas inactivas (sin login en N años) — REUSE `platform/scheduler`.
- ❌ Retención y purga de registros de `password_resets`, `magic_links`, `activation_tokens` expirados.
- ❌ Pseudonimización / anonimización de datos de usuarios eliminados que deben conservarse en otras tablas (pedidos, etc.).
- ❌ Registro de procesadores/subprocesadores y transferencias internacionales.
- ❌ Gestión de bajas de marketing y `do-not-contact` list sincronizada con `platform/notifications`.
- ❌ DPA (Data Processing Agreement) y política de privacidad versionada accesible desde el módulo.
- ❌ Notificación al usuario de cambios en política de privacidad con re-consentimiento cuando aplique.

## 18. Configuración admin y extensibilidad

- ✅ Configuración de providers OAuth en DB (AES-256-GCM) vía `GET/PATCH /v1/auth/admin/oauth-providers` — requiere `super_admin|staff`.
- ✅ `enabled` por provider — se puede activar/desactivar Google/Facebook sin despliegue.
- ✅ Fallback a env vars si no hay configuración en DB — retrocompatibilidad con despliegues pre-migración.
- 🔧 Solo Google y Facebook configurables — no hay UI/API para añadir nuevos proveedores OIDC genéricos.
- 🔧 No hay endpoint para inspeccionar políticas de acceso del módulo (bloqueo: N intentos, TTL de magic-link, etc.).
- ❌ Configuración de políticas de contraseña por tenant (longitud mínima, complejidad, caducidad).
- ❌ Configuración de TTL del refresh token por tenant (hoy es global vía `PLATFORM_JWT_REFRESH_DAYS`).
- ❌ Configuración de TTL de magic-link por tenant (hoy 15 min fijo en código).
- ❌ Configuración de política de lockout (N intentos, duración) por tenant.
- ❌ Activación/desactivación de métodos de autenticación por tenant (ej. deshabilitar password login, solo OAuth).
- ❌ MFA obligatoria configurable por tenant o por rol.
- ❌ Lista blanca de dominios de email permitidos para registro en un tenant (ej. solo `@empresa.com`).
- ❌ Lista negra de dominios bloqueados (ej. desechables).
- ❌ Webhook saliente cuando ocurre un evento de auth (login, registro, cambio de rol) — para que apps externas reaccionen.
- ❌ SDK de tokens interno para que otros módulos de platform-core validen JWTs sin HTTP (hoy usan `GET /internal/validate`).

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. **Hashing de tokens en `password_resets`** (paridad SHA-256 con magic-links y activation-tokens) — corrección de seguridad, coste mínimo.
2. **Logout explícito** (`POST /v1/auth/logout` que invalide el refresh token en Redis) — fundamental para la UX de cierre de sesión; hoy no existe.
3. **Rate-limiting en endpoints públicos** (login, register, forgot, magic-link) — REUSE `fastify-rate-limit` ya presente en platform-core; riesgo inmediato de abuso.
4. **TOTP / 2FA** (Google Authenticator, backup codes) — la adición de mayor impacto en seguridad; desbloquea clientes que requieren MFA.
5. **Purga de tokens expirados** (magic-links, password_resets, activation_tokens) vía `platform/scheduler` — higiene operacional.
6. **Logout global + listado de sesiones activas** — operativa de seguridad básica para el usuario.
7. **GDPR: consentimiento + exportación + borrado** (`/me/export`, `/me/delete`) — obligatorio en España/UE para cualquier app con usuarios reales.
8. **Verificación de email post-registro** (confirmation link) — complementa el actual registro abierto; necesario para reducir spam y mejorar calidad de datos.
9. **Verificación de teléfono / OTP SMS** — las columnas ya están en DB; solo falta el servicio de envío OTP (REUSE `platform/notifications` canal SMS).
10. **Audit log de eventos de seguridad** (`auth_events`) — imprescindible para ISO 27001 / SOC 2 y debugging de incidentes.
11. **OIDC genérico / SAML** — desbloquea clientes B2B enterprise que exigen SSO con su propio IdP.
12. **Passkeys / WebAuthn** — estándar emergente; phishing-resistant; Apple/Google ya lo promueven como sustituto de password.
