---
description: Split a monolithic Landing.jsx into the canonical structure (data + components + views + lib + hooks) that /implementa expects
argument-hint: <app-name>
---

# Importa `$ARGUMENTS`

Toma el `Landing.jsx` monolítico (output de `/html-to-jsx` o hand-converted)
y lo parte en la estructura canónica que `/implementa` Step 0 espera leer:
`data/mock.js`, `components/`, `views/`, `lib/api.js`, `lib/tenant.js`,
`hooks/`. Cero cambio funcional — solo refactor estructural.

> **Prerequisites**:
> - Existe `apps/<name>/<name>-portal/src/Landing.jsx` monolítico.
> - Si vienes de `/html-to-jsx`, ya tienes ese archivo. Si lo escribiste
>   a mano (caso js-electric en el bootstrap), también vale.
>
> **Precedencia**: la conversión de js-electric (commit `8092a20`) es el
> patrón canónico — `aulavera` y `aikikan` siguen estructuras similares.

## Step 0 — Inventario del Landing.jsx

Lee `src/Landing.jsx` y clasifica cada bloque en una de estas categorías:

1. **Contenido estático repetitivo** — arrays de objetos con la misma
   shape (services × N, projects × N, testimonials × N, blog posts,
   testimonios, valores, certifications, etc.). → `data/mock.js`.
2. **Strings de chrome** — navLinks, footerCols, contactInfo, etiquetas
   de form (pills de servicio, etc.). → `data/mock.js` también.
3. **Iconos SVG inline reutilizables** — Arrow, Star, Phone, Check, etc.
   → `components/icons.jsx`.
4. **Hooks de página** — `useReveal`, `useCounters`, `useHeaderShadow` —
   los que se llaman en el cuerpo del componente Landing y solo afectan
   al DOM general. → `hooks/index.js`.
5. **Subcomponentes inline** — ServiceCard, ProjectCard, Testimonial,
   BlogPost, FooterCol, etc. → componente individual por sección que los
   usa.
6. **Secciones del JSX** — header, hero, servicios, proyectos,
   calculadora, testimonios, empresa, blog, contacto, footer. → un
   componente por sección bajo `components/`.

## Step 1 — `data/mock.js`

Para cada bloque categoría 1 o 2, extrae el array/objeto a `data/mock.js`
como export nombrado. Mantén el orden de aparición en el landing para que
sea fácil de seguir. Ejemplos típicos:

```js
export const stats         = [...]   // hero counters
export const tickerItems   = [...]
export const services      = [...]   // cards de servicios
export const projects      = [...]   // gallery
export const testimonials  = [...]
export const certifications = [...]
export const valores       = [...]
export const blogPosts     = [...]
export const contactInfo   = {...}   // teléfono, email, etc.
export const formServices  = [...]   // pills del form
export const navLinks      = [...]
export const footerCols    = [...]
```

Si algún array contiene JSX (SvgIcon literal), considera dejar solo el
`d` del path como string y reconstruir el SVG en el componente con
`<SvgIcon d={...} />`. Mantiene `mock.js` libre de JSX (CLAUDE.md regla:
data layer separada).

## Step 2 — `hooks/index.js`

Extrae los hooks de página que están en la cabecera del Landing.jsx:

```js
import { useEffect } from 'react'

export function useReveal() { /* IntersectionObserver para .reveal */ }
export function useCounters() { /* IO para .counter */ }
export function useHeaderShadow() { /* scroll listener */ }
```

Hooks que son **locales a una sección** (p.ej. lógica de la calculadora)
quedan dentro del componente de esa sección, no en `hooks/index.js`.

## Step 3 — `lib/api.js`

Wrapper fino sobre fetch, con auto-Bearer si hay token en localStorage.
Patrón canónico (lifted from `apps/aikikan/aikikan-portal/src/lib/api.js`):

```js
import { getAccessToken } from './auth.js' // si /implementa ya añadió auth; si no, omite

export async function api(method, path, body) {
  const token = getAccessToken?.()
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  })
  if (res.status === 204) return null
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error?.message ?? json.message ?? res.statusText)
  return json
}
```

Si en este punto NO hay `auth.js` todavía (porque `/implementa` aún no se
ejecutó), omite el `getAccessToken` — `/implementa` lo añade después.

## Step 4 — `lib/tenant.js`

Resolución dinámica del `tenant_id` por subdomain, sin env vars. Cachea
en memoria para evitar N calls por mount:

```js
const cache = new Map()
export const APP_ID = '<name>'

export async function resolveTenantId(subdomain = APP_ID) {
  if (cache.has(subdomain)) return cache.get(subdomain)
  const res = await fetch(`/api/tenants/tenants/by-subdomain/${encodeURIComponent(subdomain)}`)
  if (!res.ok) throw new Error(`No se pudo resolver tenant ${subdomain}`)
  const j = await res.json()
  const id = j.tenantId ?? j.data?.tenantId
  if (!id) throw new Error(`Respuesta inesperada resolviendo tenant ${subdomain}`)
  cache.set(subdomain, id)
  return id
}
```

## Step 5 — `components/icons.jsx`

Iconos SVG inline reutilizados. Recoge los que el HTML usaba 3+ veces
(Arrow, Star, Phone, Check…). Más un genérico:

```jsx
export const SvgIcon = ({ d, className = 'w-7 h-7 ico', strokeWidth = 1.6 }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}>
    <path strokeLinecap="round" strokeLinejoin="round" d={d} />
  </svg>
)
```

para que `data/mock.js` solo necesite mandar el `d` string.

## Step 6 — Un componente por sección

Crea un archivo por cada `<section id=…>` del landing:

```
components/
├── Header.jsx           # nav + mobile menu (lleva su propio useState)
├── Hero.jsx             # stats + ticker
├── Servicios.jsx        # consume services + services.icon
├── Proyectos.jsx        # consume projects
├── Calculadora.jsx      # estado local (sliders) + lógica solarCalc
├── Testimonios.jsx      # consume testimonials + certifications
├── Empresa.jsx          # consume valores
├── Blog.jsx             # consume blogPosts
├── Contacto.jsx         # form — wireado en Step 8
├── Footer.jsx           # consume footerCols + contactInfo
└── Toast.jsx            # presentacional; estado lifted al view
```

Cada uno importa solo lo que necesita de `data/mock.js`. Sub-componentes
muy pequeños y de un solo uso (e.g. `FilterPill`) pueden quedar al final
del mismo archivo. Si se reusa entre 2+ secciones, sube a `components/`.

## Step 7 — `views/Landing.jsx` + `App.jsx` + `main.jsx`

- `views/Landing.jsx` — orquestador. Llama a los hooks de página
  (`useReveal/useCounters/useHeaderShadow`), gestiona el state del Toast
  (lifted aquí porque varios componentes lo disparan), y renderiza:

```jsx
<Header />
<Hero />
<Servicios />
<Proyectos />
<Calculadora showToast={showToast} />  // o el prop que necesite
<Testimonios />
<Empresa />
<Blog />
<Contacto showToast={showToast} />
<Footer />
<Toast msg={toast.msg} show={toast.show} ok={toast.ok} />
```

- `App.jsx` — wrapper fino: `return <Landing />`. Importante tenerlo
  separado porque `/implementa` luego lo convierte en `<BrowserRouter>`
  con rutas admin.

- `main.jsx` — actualiza para importar `App` en vez de `Landing` directo.

## Step 8 — Wiring de formularios al backend

Identifica cada form del landing y matchéalo con el módulo platform que
le corresponde. El caso más común es el **contact form** → `platform/inquiries`:

```jsx
// dentro de Contacto.jsx
import { api } from '../lib/api.js'
import { APP_ID, resolveTenantId } from '../lib/tenant.js'

const onSubmit = async (e) => {
  e.preventDefault()
  // validación local (campos obligatorios, GDPR check si aplica)
  try {
    const tenantId = await resolveTenantId(APP_ID)
    await api('POST', '/api/inquiries/', {
      appId:       APP_ID,
      tenantId,
      contactName: data.get('nombre'),
      email:       data.get('email'),
      phone:       data.get('telefono'),
      subject:     servicio,
      message:     data.get('mensaje') || '(sin mensaje)',
      source:      'landing-contact',  // o 'landing-budget' si es otro form
    })
    showToast('¡Solicitud enviada!')
  } catch (err) {
    showToast(`Error: ${err.message}`, false)
  }
}
```

- **URL exacta**: NGINX reescribe `/api/inquiries/` → `/v1/inquiries/`. NO
  uses `/api/inquiries/v1/inquiries` (duplica prefijo → 404; ver fix
  commit `9bbf037`).
- **Validación GDPR** en JS, no solo `required` HTML — el form usa
  `noValidate` para mostrar tu propio toast (precedencia commit `ee77a71`).

## Step 9 — Borrar el Landing.jsx monolítico

Una vez todo migrado, **borra** `src/Landing.jsx` (el monolítico). El
nuevo orquestador vive en `views/Landing.jsx`.

## Step 10 — Verification

```bash
cd apps/<name>/<name>-portal
pnpm exec vite build 2>&1 | tail -5
# Espera: "N modules transformed" igual o mayor que antes del split,
# sin errores de import.

# Confirmar que cada sección consume mock.js:
grep -l "from '../data/mock'" src/components/*.jsx
# Debe listar la mayoría de secciones — esto es lo que /implementa Step 0
# busca para mapear endpoints después.

# Visual:
docker compose up -d <name>-portal
# La página debe ser idéntica al estado pre-refactor (mismo HTML output,
# mismas animaciones, mismos eventos del form).
```

## Anti-patterns to refuse

- **Añadir auth / login / admin views** — eso es `/implementa`. Importa
  solo refactoriza estructura + wirea forms públicos.
- **Añadir router (react-router-dom)** — eso es `/implementa`. El landing
  es una sola página.
- **Crear app schema `app_<name>`** — eso es ADR 013, decisión que toma
  `/implementa`.
- **Saltarse el split en componentes** — un solo `Landing.jsx` con todo
  inline es el output de `/html-to-jsx`, NO de `/importa`. El propósito
  exacto de este comando es partirlo.
- **Crear vistas admin / settings** — `/implementa` y `/add-admin-config`.
- **Cambiar el comportamiento al refactorizar** — preservación total. Si
  ves un bug del HTML original, anótalo pero NO lo arregles en este paso;
  hazlo en un commit separado tras Importa.
