---
description: Discover configurable parameters in an app's landing and expose them in the admin console (/admin/<feature>)
argument-hint: <app-name>
---

# Añade configuración admin a `$ARGUMENTS`

Descubre los parámetros runtime-configurables de la landing del app
`<app-name>` y expón una página de configuración dentro de la consola
admin (`/admin/<feature>`) que los edite. Run these steps in order.

> **Prerequisite**: `Importa` e `Implementa` ya se han ejecutado para
> `<name>`. Existe `apps/<name>/<name>-portal/` con `data/mock.js`,
> components, vistas admin y `RequireAdmin` guard. La precedencia exacta
> del patrón vive en el commit `beb7c0b` (calculadora solar de
> js-electric).

## Step 0 — Discover candidate parameters

Lee toda la fuente del portal bajo `apps/<name>/<name>-portal/src/`.
Catálogo por tipo:

- **Número literal en fórmula** (`x * 1650`, `bill / 25`, etc.) →
  constante física/económica.
- **Array hardcoded en componente**
  (`[['Sur', 1], ['Este', 0.85], ...]`) → enumeración configurable.
- **Slider `min`/`max`/`step`** + valores iniciales `useState(N)` →
  defaults UX.
- **String literal con números** ("desde 1.200€/kWp llave en mano") →
  copy derivado.
- **Threshold condicional** (`{ value > 100 ? <Premium/> : null }`) →
  feature flag.

`data/mock.js` típicamente NO es config — esas listas son **contenido**
(services, projects, testimonials). Si el usuario quiere editarlas, es un
CMS, no este comando — discutir crear `app_<name>` schema (ADR 013) en su
lugar.

Produce un catálogo: `{ name, type, currentValue, source: 'file:line', tier }`.

## Step 1 — Tier + confirmación

Agrupa los candidatos en tiers y propón cuáles incluir:

| Tier | Ejemplo | Recomendación |
|---|---|---|
| 1 | Constantes pricing/físicas que cambian con tiempo/geografía | **Incluir** |
| 2 | Enumeraciones (orientaciones, tipos, tamaños) | **Incluir** |
| 3 | UX defaults (rangos sliders, valores iniciales) | Saltar |
| 4 | Feature toggles | Saltar a menos que el usuario lo pida |

**No defaultees**: pregunta al usuario "encontré N candidatos en M tiers,
recomiendo Tiers 1+2, ¿procedemos?" — y deja que confirme antes de
codificar.

## Step 2 — Storage location

Default: **`platform_tenants.apps.metadata` JSONB** (per-app, simple).
Cambia solo si:

- Distintos tenants del mismo app necesitan config distinta →
  `tenants.metadata`.
- La config tiene shape relacional rico → discutir `app_<name>` schema.

## Step 3 — Backend (`platform/tenant-config`)

1. Si `platform_tenants.apps.metadata` no existe todavía, añade migración
   `00NN_app_metadata.sql`:
   ```sql
   ALTER TABLE platform_tenants.apps
     ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
   ```
   (Existe desde 0015 si la primera implementación fue js-electric.)

2. `src/repositories/apps.repository.js` ya expone `getMetadataKey` y
   `setMetadataKey`. Si no existen, añádelos (precedencia: el repo de
   tenant-config tras commit `beb7c0b`).

3. Crea `src/services/<feature>.service.js`:
   - `<FEATURE>_DEFAULTS` — exporta el shape exacto con valores actuales.
   - zod schema con rangos acotados (positive, max razonable — evita
     NaN, negativos, valores que rompan la fórmula del frontend).
   - `getConfig(appId)`, `setConfig(appId, config)`.

4. Crea `src/routes/<feature>.routes.js`:
   - `GET /v1/apps/:appId/<feature>` con `config: { public: true }` — el
     landing lo lee anónimo.
   - `PATCH /v1/apps/:appId/<feature>` con
     `requireRole('owner','admin','staff','super_admin')` +
     **cross-app guard** en el handler:
     ```js
     if (!PLATFORM_ROLES.has(req.identity.role)
         && req.identity.appId !== req.params.appId) {
       throw new ForbiddenError('app_id mismatch')
     }
     ```
     Bypass para `staff`/`super_admin` (son universales).

5. Registra el nuevo routes en `src/index.js`.

## Step 4 — Frontend landing

Refactor del componente target (suele ser uno solo: la calculadora, la
sección hero con stats, etc.):

- Añade `DEFAULT_CONFIG` al inicio del archivo. **MUST match shape exacto**
  de `<FEATURE>_DEFAULTS` en el backend (mismas claves, mismos defaults).
- `useState(DEFAULT_CONFIG)` + `useEffect` que hace
  `fetch('/api/apps/<name>/<feature>')` al montar. Fallback **silencioso**
  en error (sin toast — el visitante no debe ver errores de infra).
- Reemplaza cada literal hardcoded del componente por `config.<clave>`.
- Saneamiento de índices si el shape cambia (p.ej. el admin borra una
  orientación mientras el visitante tiene esa seleccionada): default al
  primer elemento válido.

Si el componente importaba constantes de `data/mock.js` que ahora son
config, elimínalas de `mock.js`.

## Step 5 — Frontend admin

1. Nueva vista `src/views/admin/<Feature>Config.jsx`:
   - Carga config al montar vía `api('GET', ...)`.
   - Form agrupado por **secciones tier**, cada una en una tarjeta blanca
     (`bg-white rounded-2xl border shadow-soft p-7`).
   - Cada input con helper text corto explicando significado + rango
     razonable.
   - Botón "Guardar" → `api('PATCH', ...)` con toast
     `✓ Guardado a las HH:MM`.
   - Error visible si el PATCH falla (validación zod).
   - Para enumeraciones: botones "+ Añadir" y "Quitar" (deshabilita
     Quitar si quedan ≤ 1).

2. Ruta en `src/App.jsx`:
   ```jsx
   <Route path="<feature>" element={<<Feature>Config />} />
   ```
   bajo el tree `<Route element={<RequireAdmin />}>` existente.

3. Entrada en nav en `src/views/admin/AdminShell.jsx` con `<Link>`.

## Step 6 — Verification

```bash
# Build
cd apps/<name>/<name>-portal && pnpm exec vite build

# Migración + restart platform-core
docker compose up -d --build platform-core

# GET público
curl http://<name>.hulkstein.local:8080/api/apps/<name>/<feature> | jq

# Admin
# Login → nav <Feature> → edita un valor → Guardar
# Reload landing → cambio reflejado (con coherencia: ejemplo bullets/copy
# que muestran el mismo valor que la calculación usa)
```

## Anti-patterns to refuse

- **Configurar contenido marketing** (services, projects, blog,
  testimonials) — eso es CMS, no este comando. Discutir `app_<name>`
  schema.
- **Configurar lo que cambia rara vez** (Tier 3/4 sin trigger explícito) —
  over-engineering. Pregunta antes de incluirlos.
- **Olvidar el fallback offline** en el frontend — la landing debe seguir
  funcionando si platform-core está caído.
- **Defaults divergentes** entre `<FEATURE>_DEFAULTS` (backend) y
  `DEFAULT_CONFIG` (frontend). Si tocas uno, toca el otro en el mismo
  commit.
- **Skip cross-app guard** en el PATCH — sin él, un owner de aikikan
  puede editar la calculadora de js-electric (todos los apps comparten
  endpoints `/v1/apps/*`).
