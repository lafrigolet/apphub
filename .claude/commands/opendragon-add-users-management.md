---
description: Add user management views (list, invite, approve, change role, revoke, resend) to <app>'s admin console — REUSE platform/auth + add resend-invitation endpoint
argument-hint: <app-name>
---

# Añade gestión de usuarios al admin de `$ARGUMENTS`

Añade a la consola admin del portal `<name>` vistas para gestionar
usuarios: listar, invitar, aprobar/rechazar pendientes, cambiar rol,
revocar acceso y reenviar invitación. Máximo REUSE de `platform/auth` +
**un endpoint nuevo obligatorio** (`resend-invitation`).

> **Prerequisite**: `/opendragon-implementa <name>` ya se ejecutó —
> existen `src/components/RequireAdmin.jsx`, `src/lib/auth.js` (con
> `getIdentity` / `isAdminRole`), `src/lib/api.js` (auto-Bearer) y
> `src/views/admin/AdminShell.jsx` con nav.
>
> **Precedencia visual**: `apps/aikikan/aikikan-portal/src/components/admin/UsersAdmin.jsx`
> (~517 líneas, escenario más completo) y
> `apps/console/console-portal/src/views/tenant/Admins.jsx` (modales
> simples). NO copies verbatim — extrae el patrón de scoping (appId +
> tenantId en query string) y los iconos de status.

## Service map (REUSE-heavy)

Endpoints existentes en `platform/auth/src/routes/users.routes.js` que el
comando consume directamente:

| Acción | Endpoint | Notas |
|---|---|---|
| Listar | `GET /api/users?appId=&tenantId=&role=&pending=approval` | Scoping automático: si el caller no es staff/super_admin, el servicio valida `appId == identity.appId` (`users.service.js:54-62`). |
| Invitar | `POST /api/users/invite` body `{appId, tenantId, email, role?, displayName?}` | Atómico — crea row + emite magic-link. |
| Ver | `GET /api/users/:id` | |
| Editar displayName | `PATCH /api/users/:id` body `{displayName}` | |
| Cambiar rol | `PATCH /api/users/:id/role` body `{role}` | Bloquea self-role. |
| Aprobar | `POST /api/users/:id/approve` | Emite `auth.signup.approved` → email con set-password. |
| Rechazar | `POST /api/users/:id/reject` body `{reason?}` | Hard-delete; email queda libre. |
| Revocar | `DELETE /api/users/:id` | Soft-delete (marca `revoked_at`). Self-revoke bloqueado. |
| **Reenviar invitación** | `POST /api/users/:id/resend-invitation` | **NUEVO** — añadido por este comando, ver Step 1. |

NGINX ya enruta `/api/users/` → `/v1/users/` (snippet
`platform-routes.conf`). Cero cambios de NGINX.

## Step 0 — Verifica precondiciones

- `apps/<name>/<name>-portal/src/views/admin/AdminShell.jsx` existe.
- `src/components/RequireAdmin.jsx` exporta el guard.
- Hay al menos un seed de admin con role `owner` o `admin` para `<name>`.
- `lib/auth.js` expone `getIdentity()` (devuelve `{userId, appId, tenantId, role, email}`).

Si falta cualquiera, **detén el comando** y sugiere correr
`/opendragon-implementa <name>` primero.

## Step 1 — Backend: endpoint resend-invitation (Tier 2 obligatorio)

Es el único endpoint que `platform/auth` no expone hoy y que el flujo
necesita.

1. **Editar `platform/auth/src/routes/users.routes.js`** — añadir tras
   `/v1/users/:id/reject`:
   ```js
   fastify.post('/v1/users/:id/resend-invitation', async (req, reply) => {
     requireStaffOrAdmin(req)
     const { id } = idParams.parse(req.params)
     await usersService.resendInvitation(id, req.identity)
     return reply.status(204).send()
   })
   ```

2. **Editar `platform/auth/src/services/users.service.js`** — añadir la
   función. Patrón de referencia: `requestMagicLink` en
   `auth.service.js:282-313` (busca por email; aquí buscamos por id).
   Lógica:
   - `getById(id, identity)` para reutilizar el scope check (lanza
     ForbiddenError si el caller no puede ver al user).
   - Rechazar si `user.revoked_at != null` (no se reactiva con magic-link).
   - Rechazar si `user.pending_approval` (debe pasar por approve primero).
   - Crear row en `platform_auth.magic_links` con TTL = MAGIC_LINK_TTL_MS
     (15 min — misma constante que el flow normal).
   - Publicar evento `auth.magic_link_requested` con `{userId, email,
     token, appId, tenantId, displayName}`.

3. **NO añadir** eventos `user.role_changed` ni `user.revoked` — esos son
   gap del módulo y van por separado (anotar como TODO en el commit).

## Step 2 — Frontend vistas admin

Crear en `apps/<name>/<name>-portal/src/views/admin/`:

### `UsersList.jsx`

- `useEffect` al mount: `api('GET', '/api/users?appId=' + identity.appId + '&tenantId=' + identity.tenantId)`. Cache resultado en estado.
- **Filter pills** arriba: Status (Todos / Activos / Pendientes / Revocados) + Role (Todos / owner / admin / staff / user). Filtro **client-side** sobre el resultado completo — el endpoint no soporta más filtros que `role` + `pending=approval` y para el shape de "Activos vs Revocados" es derivado de columnas (`revoked_at`, `pending_approval`).
- **Tabla** columnas: Email · Display name · Role (badge) · Status (badge) · Última acción (formato fecha es-ES) · "Ver".
- **Status badges**: `active` verde (electric), `pending_approval` ámbar (spark), `revoked` rojo. Mismas clases de pildora que `InquiriesList.jsx` (`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium border`).
- **Botón "+ Invitar usuario"** arriba-derecha que abre `<InviteUserModal open={showInvite} onClose={() => setShowInvite(false)} onCreated={refetch} />`.
- Loading / error / empty states igual que `InquiriesList`.

### `UserDetail.jsx`

- `useParams` para `id`. `api('GET', '/api/users/' + id)`.
- **Sección perfil** (editable): displayName (input controlado) + email (read-only — editarlo requiere flow de verificación, queda fuera de scope).
- **Sección role** (si el user NO es self): `<select>` con opciones desde una constante exportada por `lib/auth.js` (ver Anti-patterns). Submit con PATCH `/api/users/:id/role`.
- **Sección acciones** — botones condicionados por estado:
  - Si `pending_approval`: **Aprobar** (POST `/approve`) + **Rechazar** (POST `/reject` con textarea para `reason`).
  - Si `!pending_approval && !revoked_at`: **Reenviar invitación** (POST `/resend-invitation`).
  - Si `!revoked_at`: **Revocar acceso** (DELETE, con confirmación tipo "¿Seguro? Esta acción es soft-delete y el user no podrá entrar.").
- **Botón "Volver al listado"** arriba-izquierda como en `InquiryDetail`.
- Toast verde tras cada acción exitosa.

### `InviteUserModal.jsx`

- Patrón visual lifted desde `apps/js-electric/js-electric-portal/src/components/BudgetRequestModal.jsx` (overlay + tarjeta blanca centrada + escape para cerrar).
- Form: email* + role (select con misma constante que UserDetail) + displayName opcional + checkbox GDPR si aplica.
- Submit → `api('POST', '/api/users/invite', {appId: identity.appId, tenantId: identity.tenantId, email, role, displayName})`.
- Validación JS de campos obligatorios (no confiar en `required` HTML — patrón ya establecido en commit `ee77a71`).
- Toast verde + `onCreated()` callback para refetch + cerrar modal.

## Step 3 — Router + nav

1. **Editar `src/App.jsx`** — añadir bajo `<Route element={<RequireAdmin />}>`:
   ```jsx
   <Route path="users"     element={<UsersList />} />
   <Route path="users/:id" element={<UserDetail />} />
   ```

2. **Editar `src/views/admin/AdminShell.jsx`** — añadir `<Link to="/admin/users">Usuarios</Link>` en el `<nav>` junto a las entradas existentes.

## Step 4 — Identity como source de truth

UsersList y UserDetail leen `appId` y `tenantId` de `getIdentity()` —
NUNCA de env vars ni constantes hardcoded. Backend ya valida que el
identity del caller coincida con los params de query, así que cualquier
divergencia es bug en la UI, no falla de seguridad.

InviteUserModal pasa los mismos identity values al body.

## Step 5 — Roles constants

En `lib/auth.js` (junto a `ADMIN_ROLES`), exportar:

```js
export const APP_ROLES = ['owner', 'admin', 'staff', 'user']
```

Los selects de role en `UserDetail` y `InviteUserModal` consumen esta
constante. Si el app tiene roles custom (e.g. `aikikan_grade_examiner`),
el commit del comando los añade aquí — anti-pattern explícito de no
hardcodearlos en cada vista.

## Step 6 — Verification

```bash
# Build
cd apps/<name>/<name>-portal && pnpm exec vite build 2>&1 | tail -5

# Backend: rebuild platform-core para que cargue el nuevo endpoint
docker compose up -d --build platform-core

# Smoke del endpoint nuevo
curl -X POST http://<name>.hulkstein.local:8080/api/users/<some-user-id>/resend-invitation \
  -H "Authorization: Bearer $TOKEN"
# Espera: 204 si el user está activo + nuevo magic_link row en BD

# Admin UI
# Login → /admin/users
# 1. Lista vacía (o seeded admin) — verifica scoping correcto
# 2. Invitar usuario nuevo → debe llegar email con magic-link
# 3. Aprobar pendiente (si seeded con pending_approval=true)
# 4. Cambiar rol del seed admin → verificar en BD:
docker compose exec postgres psql -U splitpay -d splitpay -c \
  "SELECT email, role, pending_approval, revoked_at FROM platform_auth.users WHERE app_id='<name>';"
# 5. Reenviar invitación → curl o UI → 204 + magic_link nuevo
# 6. Revocar → confirma revoked_at = now()

# Cross-app guard
# Login como owner de OTRO app
# GET /api/users?appId=<name>&tenantId=<tenantid> → debe ser 403 ForbiddenError
```

## Anti-patterns to refuse

- **Crear sistema de auth propio del app** — todo va por `platform/auth`.
  El monolito del app NO toca `platform_auth.users` directamente, ni
  escribe magic_links, ni emite eventos de auth.
- **Hardcodear roles en cada vista** — usa `APP_ROLES` de `lib/auth.js`.
  Si el cliente quiere un rol nuevo, se añade UNA vez ahí.
- **Self-management** — la UI debe deshabilitar (no esconder) acciones
  cuando `getIdentity().userId === user.id`. Backend ya las bloquea, pero
  el botón disabled es mejor UX que un error post-click.
- **Cross-app leakage** — los filter pills y la tabla NO deben mostrar
  usuarios de otro app/tenant. Si aparecen es bug grave — el endpoint
  filtra por identity automáticamente, pero la UI no debe enviar
  `appId` distinto al de la identity.
- **Olvidar eventos `user.revoked` / `user.role_changed`** — `platform/auth`
  hoy NO los emite. Out of scope de este comando — anota como TODO al
  commitear y deja que `platform/auth` los introduzca en un commit
  separado cuando un consumer real los pida.
- **Edición de email** — fuera de scope. El flow seguro requiere
  verificación del email nuevo. Si el cliente lo pide, hacer en una
  iteración aparte.
- **Pagination server-side** — el endpoint no la soporta. Mientras
  N_users < 500 por tenant, filtrado/paginación client-side es OK. Si
  crece, es trabajo del módulo `platform/auth` (extend listQuery con
  `limit`/`offset`).
