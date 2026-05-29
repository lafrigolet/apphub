---
description: Convert an app's landing HTML prototype to a monolithic Landing.jsx (intermediate step before /importa)
argument-hint: <app-name>
---

# HTML → JSX monolítico para `$ARGUMENTS`

Convierte el prototipo HTML del landing a un único `Landing.jsx` React
monolítico (sin partir en componentes todavía — eso es `/importa`).
Preserva markup, IDs y clases 1:1; cambia solo lo necesario para que
funcione como React + extrae JS inline a hooks.

> **Prerequisites**:
> - `/bootstrap-app <name>` ya se ejecutó — existe
>   `apps/<name>/<name>-portal/` con scaffolding básico.
> - El prototipo vive en
>   `apps/<name>/<name>-landing.html` (o ruta equivalente).
> Precedencia exacta: `js-electric-landing.html` →
> `apps/js-electric/js-electric-portal/src/Landing.jsx` (commit `24b8ffc`,
> hecho a mano antes de formalizar este comando).

## Step 0 — Inventario del HTML

Lee el HTML y produce un mental map de:

- **Bloques `<style>`** — toda CSS custom (clases tipo `.grain`,
  `.btn-primary`, animaciones, etc.).
- **`<script>` de Tailwind CDN + `tailwind.config = {…}`** — extiende el
  tema de Tailwind (colores, fonts, shadows custom).
- **`<link rel="preconnect">` + Google Fonts** — fonts externos.
- **`<script>` inline al final** — JS imperativo del landing:
  IntersectionObservers, listeners de scroll, lógica de calculadora/form,
  toggle de mobile nav, toasts.
- **Secciones del `<body>`** — header, hero, secciones marcadas con
  `<section id=…>`, footer.

## Step 1 — Extraer CSS al stylesheet del portal

El bloque `<style>` del HTML va a `src/index.css`. Estructura:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  /* html/body defaults del HTML */
}

@layer components {
  /* todas las clases custom: .grain, .btn-primary, .svc-card,
     .marquee-track, .gallery-item, .display, .field, .calc-slider,
     .mobile-nav, .header-blur, .toast, .reveal, etc. */
}
```

`@keyframes` van fuera de `@layer` (regla de Tailwind 3).

## Step 2 — Extraer config de Tailwind

Lo que está en `tailwind.config = { theme: { extend: {...} } }` del HTML
pasa a `tailwind.config.js`:

```js
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: { extend: { fontFamily, colors, boxShadow } },
}
```

Copia tal cual los `fontFamily`, `colors` (paletas custom), `boxShadow`.
No "limpies" — preservación 1:1.

## Step 3 — Fuentes externas

Los `<link rel="preconnect">` + `<link href="https://fonts.googleapis…">`
del HTML van a `index.html` del portal (no a Landing.jsx). Vite los sirve
desde ahí.

## Step 4 — Convertir el body a JSX

Una sola pasada por todo el `<body>`, con las siguientes reglas
mecánicas:

- `class=` → `className=`
- `for=` → `htmlFor=`
- Self-close void elements: `<input />`, `<img />`, `<br />`, `<hr />`,
  `<link />`, `<meta />`.
- `style="prop: val"` → `style={{ prop: 'val' }}`.
- SVG en camelCase: `stroke-width` → `strokeWidth`,
  `stroke-linecap` → `strokeLinecap`, `xmlns:xlink` → `xmlnsXlink`,
  `preserveAspectRatio` ya en camelCase, etc.
- Entidades HTML en texto: `&copy;` → `©`, `&mdash;` → `—`, `&times;` → `×`.
  (Algunas se pueden dejar como entidades pero limpiarlas es más legible.)
- Atributos booleanos: `required` → `required`, `disabled` → `disabled`
  (sin `=""`).
- Comentarios `<!-- -->` → `{/* */}` solo si quieres conservarlos como
  separadores de sección; lo demás bórralo.

## Step 5 — Extraer JS inline a hooks

El bloque `<script>` final del HTML típicamente contiene varios efectos
side-effect-y que se convierten en hooks React. Catálogo común:

| Patrón en HTML | Hook React |
|---|---|
| `IntersectionObserver` que añade clase `.visible` a `.reveal` | `useReveal()` con `useEffect` |
| `IntersectionObserver` que anima counters | `useCounters()` |
| `window.addEventListener('scroll', …)` para header shadow | `useHeaderShadow()` |
| Mobile nav toggle con `classList.toggle('open')` | `useState(menuOpen)` |
| Sliders de calculadora con `input` event | `useState` controlado + onChange |
| Form submit con `e.preventDefault()` + simular envío | onSubmit prop con `useState` por campo |
| Toast con `setTimeout` para auto-hide | `useState` + `useRef` para timer |

Los hooks definelos **al principio** del archivo (antes del export
default), o en el cuerpo del componente cuando el state es local.

## Step 6 — Escribir el `Landing.jsx` monolítico

Estructura tipo:

```jsx
import { useEffect, useRef, useState } from 'react'

// ── Iconos SVG inline reutilizables ──
const Arrow = ({ className = 'w-4 h-4' }) => ( ... )
const Star  = ({ className = 'w-6 h-6' }) => ( ... )
// ...

// ── Hooks de página ──
function useReveal() { useEffect(() => { /* IO */ }, []) }
function useCounters() { /* ... */ }
function useHeaderShadow() { /* ... */ }

// ── Lógica de calculadora / forms (si aplica) ──
function useSolarCalc(...) { /* ... */ }

export default function Landing() {
  useReveal(); useCounters(); useHeaderShadow()

  const [menuOpen, setMenuOpen] = useState(false)
  // estado local de calculadora, form, toast, etc.

  return (
    <div className="bg-bone text-ink-900 antialiased">
      {/* HEADER */}
      {/* HERO */}
      {/* SERVICIOS */}
      {/* PROYECTOS */}
      {/* ... cada sección con su id y comentario separador */}
      {/* FOOTER */}
      {/* TOAST */}
    </div>
  )
}

// ── Subcomponentes inline (sin extraer a archivos) ──
function ServiceCard({ ... }) { ... }
function ProjectCard({ ... }) { ... }
// ...
```

**Mantén subcomponentes inline** (al final del mismo archivo) cuando se
repiten varias veces en el JSX. NO los pongas en archivos separados —
eso lo hace `/importa`.

## Step 7 — Decisiones a aplazar (no implementes)

- **Form submit real** — deja el handler como stub local (showToast con
  mensaje hardcoded). El wiring a `/api/inquiries/` u otro endpoint lo
  hace `/importa` Step 8.
- **Routing** — sin react-router. Una única página. El admin/router lo
  añade `/implementa`.
- **Auth** — no añadir login, tokens, ni guards.
- **Componentes en archivos separados** — todo inline en Landing.jsx.

## Step 8 — Conectar al portal

- `src/main.jsx`: importa `Landing` y rendiza dentro de `<StrictMode>`.
- `src/index.css`: ya escrito en Step 1.
- `index.html`: link de fonts ya en Step 3, asegúrate que tenga
  `<div id="root">` + `<script type="module" src="/src/main.jsx">`.

## Step 9 — Verification

```bash
cd apps/<name>/<name>-portal
pnpm exec vite build 2>&1 | tail -5
# Espera: "✓ N modules transformed" sin errores

# Visual:
docker compose up -d --build <name>-portal nginx
# Abre http://<name>.hulkstein.local:8080 y compara 1:1 con el HTML
# original — animaciones de reveal, ticker, sliders de calc, mobile nav,
# toast del form (stub OK), todo debe funcionar igual.
```

## Anti-patterns to refuse

- **Partir en componentes ya en este paso** — un `Landing.jsx` de ~800-
  1000 líneas es **el output esperado**. Lo otro es `/importa`.
- **"Mejorar" el diseño / accesibilidad** — preservación 1:1. Si el HTML
  tenía un `<div>` donde debería haber `<button>`, déjalo. El refactor de
  accesibilidad es trabajo posterior, no parte de la conversión.
- **Conectar a backend real** — los forms quedan stub. `/importa` los
  wirea.
- **Saltarse hooks de página** — si el HTML tenía animaciones reveal y
  decides omitirlas porque "no aportan", **pregunta primero**. Es
  preservación 1:1.
- **Tirar la CSS custom y rehacerla en utilidades Tailwind** — copia tal
  cual. La refactorización va aparte.
