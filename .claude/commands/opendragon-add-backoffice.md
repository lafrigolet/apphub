---
description: Add a backoffice (admin console) to <app>'s portal — login + reusable shell + one CRUD section per platform module (events, shop, orders, subscription, …), seeded with real data and verified e2e
argument-hint: <app-name> [secciones…]
---

# Añade un backoffice al portal `$ARGUMENTS`

Añade a `apps/<app>/<app>-portal/` una **consola de administración** bajo
`/admin`: login del owner + shell reutilizado (`@apphub/tenant-console-ui`)
+ una **sección por capacidad** (eventos, tienda, pedidos, suscripción,
calendario, …). Cada sección es una UI CRUD fina sobre un módulo de
plataforma — **no se construye backend salvo que falte capacidad**.

> **Prerequisito**: el app ya existe (portal + tenant + owner). Si no, corre
> antes `/opendragon-bootstrap-app` → `/opendragon-importa` →
> `/opendragon-implementa`. Debe existir `app+tenant+owner` en
> `platform_tenants`/`platform_auth` (vía `seed.sql` del app).
>
> **Precedencia (copia el patrón, no verbatim)**:
> `apps/luciapassardi/luciapassardi-portal/` — `src/lib/auth.js` (+`studio.js`),
> `src/components/admin/{AdminBar,AdminShell,Login,EventosAdmin,CalendarioAdmin,ProductosAdmin,PedidosAdmin,SuscripcionAdmin}.jsx`,
> `src/App.jsx` (AdminRoute con refresh), y `apps/luciapassardi/seed.sql`.

## Principio rector (CLAUDE.md regla #10)

**Todo se implementa reutilizando módulos de plataforma.** Para cada sección,
sigue el árbol de decisión:

| Estado | Acción |
|---|---|
| ✅ módulo cubre la capacidad | **REUSE**: consume su API HTTP (`/api/<x>/…`). |
| 🔧 módulo existe pero le falta algo | **EXTEND**: añade columnas/rutas/eventos al módulo. |
| ❌ nada lo cubre | **PARA y PREGUNTA** al usuario: ¿módulo de plataforma nuevo, app-local, o local-primero? No improvises. |

Mapa rápido capacidad → módulo:

| Sección típica | Módulo (puerto) | Rutas `/api/…` |
|---|---|---|
| Servicios / clases / eventos | `platform/services` (3300) | `/api/services/…/sessions` |
| Reservas | `platform/bookings` (3300) | `/api/bookings/` |
| Bonos / packs | `platform/packages` (3300) | `/api/packages/…` |
| Tienda (productos) | `platform/catalog` (3100) | `/api/catalog/items` |
| Pedidos | `platform/orders` (3100) | `/api/orders/` |
| Cesta | `platform/basket` (3100) | `/api/basket/…` |
| Suscripción a la plataforma | `platform/tenant-config` (3000) | `/api/tenants/:id/subscription`, `/subscribe`, `/unsubscribe` |
| Usuarios / practicantes | `platform/auth` (3000) | ver `/opendragon-add-users-management` |
| Pagos / checkout | `payments` + `platform/commerce` (3000) | `/api/payments/…`, `/api/commerce/…` |

## Step 0 — Shell + login (una sola vez por app)

Reutiliza `@apphub/tenant-console-ui`. Crea/asegura:

1. **`src/lib/auth.js`** — `configureAuth({ tokenKey: '<app>_access_token' })`;
   `login/logout/getToken/getIdentity/isAdmin`. **Guarda el refresh token**
   bajo `${TOKEN_KEY}.refresh` y reexporta `refreshSession`/`ensureSession`
   del paquete (sesión persistente; access 15 min, refresh 90 días).
   `getIdentity` devuelve `null` en caducidad **sin** `logout` (deja refrescar).
2. **`src/lib/studio.js`** — cliente API: `const BASE = import.meta.env.VITE_API_BASE_URL ?? ''`,
   helper `req(method, path, body)` que pone `Authorization: Bearer getToken()`.
3. **`src/components/admin/`** — `Login.jsx`, `AdminBar.jsx` (nav de secciones),
   `AdminShell.jsx` (monta `AdminShell` de tenant-console-ui + `AdminBar`).
4. **`src/App.jsx`** — `BrowserRouter` + `AdminRoute`:
   - gate con `getIdentity()` + `isAdmin(role)`;
   - al montar sin sesión, `await ensureSession()` (sobrevive a recargas);
   - `setInterval(refreshSession, 10*60*1000)` (renueva antes de los 15 min);
   - escucha `apphub:unauthorized` → cae al login.

## Step 1 — Una sección por capacidad (patrón repetible)

Para cada sección (p.ej. `Eventos`, `Productos`, `Pedidos`):

1. **studio.js**: añade `listX / crearX / editarX / borrarX` (o transiciones
   FSM como en pedidos). Para colecciones, **usa barra final**
   (`/api/orders/`, ver Troubleshooting).
2. **`XxxAdmin.jsx`**: patrón estándar
   - formulario **dual crear/editar** (el lápiz carga la fila en el form de
     arriba con `scrollTo` y resalta con `ring-…`);
   - lista con acciones **lápiz (editar) / × (borrar)** inline por fila;
   - estados `loading/err/saving`, `reload()` tras cada mutación.
   - Para listas grandes: filtro + paginación (`PAGINA = N`, "Cargar más").
3. **AdminBar.jsx**: añade el enlace de la sección.
4. **App.jsx**: añade `<Route path="<seccion>" element={<XxxAdmin/>} />`.

## Step 2 — Sembrar datos reales

“Debe funcionar de verdad” ⇒ inicializa datos en BD en `apps/<app>/seed.sql`
(sección numerada por dominio). Aplica:

```bash
docker compose exec -T postgres psql -U splitpay -d splitpay -v ON_ERROR_STOP=1 < apps/<app>/seed.sql
```

(El superusuario es **`splitpay`**, no `postgres`; bypassa RLS para sembrar.)

## Step 3 — Verificación e2e (obligatoria)

```bash
npx vite build               # en el portal: build limpio
# login owner → token → CRUD real vía nginx :8080
TOK=$(curl -s -H "Host: <app>.hulkstein.local" -H 'Content-Type: application/json' \
  -X POST http://localhost:8080/api/auth/login \
  -d '{"appId":"<app>","tenantId":"<uuid>","email":"<owner>","password":"<pwd>"}' \
  | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
# GET list, POST crear (201), PATCH editar (200), DELETE borrar (204/200)
```

Verifica cada verbo de cada sección. Si tocas backend de un módulo, **rebuild**
el contenedor del módulo (ver Troubleshooting).

## Step 4 — Docs (CLAUDE.md regla #12)

- `CHANGELOG.md` (Unreleased): qué secciones, qué módulos reusados/extendidos.
- Si extendiste un módulo de plataforma: regístralo (registry + ADR si no es obvio).

---

## Troubleshooting (gotchas vividos)

- **404/301 en colecciones**: nginx redirige `/api/<col>` → 301 `/api/<col>/`.
  Llama a colecciones **con barra final** (`/api/orders/`, `/api/basket/` vía
  `summary`, etc.). El fetch del navegador pierde el puerto en el 301 → falla.
- **Mapeo nginx incorrecto**: convención es `/api/<x>/` → `/v1/<x>/`. Si una
  ruta de detalle da 404, revisa `infra/nginx/snippets/platform-routes.conf`
  (caso real: `/api/tenants/` apuntaba a `/v1/` y perdía el segmento). Tras
  editar el snippet: `docker compose exec nginx nginx -s reload`. Si el server
  block del app vive en Redis (ADR 012) y cambió el seed:
  `redis-cli HDEL nginx:configs <app>` + `docker compose restart nginx`.
- **Imagen de servicio obsoleta**: si una ruta/migración existe en el código
  pero da 404/columna inexistente, el contenedor corre una imagen anterior.
  `docker compose build <svc> && docker compose up -d <svc>`. Servicios
  típicos: `platform-core` (auth/tenants/payments/commerce/…),
  `platform-marketplace` (orders/catalog/basket), `platform-appointments`
  (services/bookings/packages).
- **`packages/` NO se monta en vivo en `portals`** (solo el `src/` de cada
  portal → HMR). Si cambiaste `@apphub/tenant-console-ui` u otro paquete:
  `docker compose build portals && docker compose up -d portals`.
- **Arranque de los monolitos** exige secretos (si no hay `.env`):
  `PLATFORM_JWT_SECRET` (≥32 chars) y `PLATFORM_CONFIG_ENCRYPTION_KEY` (32 bytes
  hex). Expórtalos antes de `docker compose up -d <svc>`.
- **Postgres**: usuario/BD = `splitpay`/`splitpay`. `MIGRATION_DATABASE_URL`
  usa ese superusuario; las apps usan su rol `svc_*`. Las tablas con RLS FORCE
  se siembran sin problema por superusuario (bypassa RLS).
- **`appGuard`** en servicios compartidos acepta cualquier `app_id` (multi-app),
  así que el token del owner del app llega a orders/catalog/tenants/etc.
- **Tienda anónima (cesta/checkout sin login)**: emite un **guest token** con
  `POST /api/auth/guest {appId, tenantId}` (JWT `role='guest'`, 30 días) y úsalo
  para `platform/basket` y `platform/orders`. Patrón en
  `luciapassardi-portal/src/lib/{auth.js:cartToken, cart.js}`.
- **Sesión que “dura poco”**: el access token vive 15 min; mantenla viva con el
  refresh token (90 días) — auto-renueva en 401 + reintento (ya en
  tenant-console-ui `api.js`) y refresco proactivo en el `AdminRoute`. No
  reutilices un access token de localStorage sin comprobar caducidad.
- **Pagos/Stripe en dev**: `payments/checkout-sessions` da 502 sin Stripe
  configurado. Diseña el checkout para que el **pedido se cree igualmente**
  (visible en backoffice) y el pago redirija solo si hay URL.
