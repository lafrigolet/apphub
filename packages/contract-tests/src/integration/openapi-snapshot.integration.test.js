// OpenAPI snapshot CI (sección 5 · P1) — si una ruta documentada desaparece
// del spec agregado sin bump de versión, falla. Compara el snapshot
// committeado (openapi-paths.snapshot.json) contra el spec en vivo de
// platform-core. Skip si platform-core no es accesible.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const snapshot = JSON.parse(readFileSync(join(here, 'openapi-paths.snapshot.json'), 'utf8'))
const BASE = process.env.PLATFORM_CORE_URL ?? 'http://localhost:3000'

let live = null
try {
  const res = await fetch(`${BASE}/docs/json`)
  if (res.ok) live = await res.json()
} catch { /* stack down → skip */ }

const maybe = live ? it : it.skip
if (!live) {
  // eslint-disable-next-line no-console
  console.warn(`[openapi-snapshot] platform-core no accesible en ${BASE} — tests SKIPeados`)
}

describe('OpenAPI snapshot — regresión de rutas', () => {
  it('el snapshot committeado está bien formado', () => {
    expect(Array.isArray(snapshot.paths)).toBe(true)
    expect(snapshot.paths.length).toBe(snapshot.count)
    expect(snapshot.count).toBeGreaterThan(50)
  })

  maybe('ninguna ruta del snapshot ha DESAPARECIDO del spec en vivo', () => {
    const livePaths = new Set(Object.keys(live.paths ?? {}))
    const removed = snapshot.paths.filter((p) => !livePaths.has(p))
    expect(removed, `rutas eliminadas sin actualizar snapshot: ${removed.join(', ')}`).toEqual([])
  })

  maybe('rutas nuevas respecto al snapshot se reportan (recordatorio de regenerar)', () => {
    const snapSet = new Set(snapshot.paths)
    const added = Object.keys(live.paths ?? {}).filter((p) => !snapSet.has(p))
    if (added.length) {
      // No es un fallo: documenta que hay que regenerar el snapshot.
      // eslint-disable-next-line no-console
      console.warn(`[openapi-snapshot] ${added.length} rutas nuevas; regenera el snapshot: ${added.slice(0, 5).join(', ')}…`)
    }
    expect(Array.isArray(added)).toBe(true)
  })
})
