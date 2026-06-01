// OpenAPI spec snapshot (1.1) — la suma de los módulos montados produce la
// doc esperada. Hits el `/docs/json` del stack vivo (platform-core agrega
// el spec de TODOS los módulos en un único OpenAPI). Si una ruta de módulo
// desaparece del spec sin querer, este test cae.
//
// Requiere el stack: `docker compose up -d`. Si platform-core no está
// accesible, los tests se SKIPean (no rompen el suite) — igual que el resto
// de integration tests del repo, que asumen el stack levantado.
import { describe, it, expect } from 'vitest'

const BASE = process.env.PLATFORM_CORE_URL ?? 'http://localhost:3000'

// Carga el spec una vez en tiempo de colección. Si falla, marca skip.
let spec = null
try {
  const res = await fetch(`${BASE}/docs/json`)
  if (res.ok) spec = await res.json()
} catch {
  /* stack down → skip */
}

const maybe = spec ? it : it.skip
if (!spec) {
  // eslint-disable-next-line no-console
  console.warn(`[openapi.integration] platform-core no accesible en ${BASE} — tests SKIPeados`)
}

// Cada módulo montado debe aportar al menos un path con su prefijo. Esto
// detecta "olvidé registrar el módulo" o "renombré su prefijo de ruta".
const MODULE_PREFIXES = [
  '/v1/auth',
  '/v1/notifications',
  '/v1/payments',
  '/v1/tenants',
  '/v1/splitpay',
  '/v1/storage',
  '/v1/leads',
  '/v1/donations',
  '/v1/inquiries',
  '/v1/verifactu',
]

describe('OpenAPI spec — platform-core agregado', () => {
  maybe('info.title = platform-core y hay paths', () => {
    expect(spec.info?.title).toBe('platform-core')
    expect(Object.keys(spec.paths ?? {}).length).toBeGreaterThan(0)
  })

  maybe('expone /health público', () => {
    expect(spec.paths).toHaveProperty('/health')
  })

  maybe.each(MODULE_PREFIXES)('incluye rutas del módulo con prefijo %s', (prefix) => {
    const paths = Object.keys(spec.paths ?? {})
    expect(paths.some((p) => p.startsWith(prefix))).toBe(true)
  })

  maybe('declara el securityScheme bearerAuth (JWT)', () => {
    expect(spec.components?.securitySchemes?.bearerAuth).toMatchObject({ type: 'http', scheme: 'bearer' })
  })

  maybe('verifactu expone sus rutas de cadena/registros/cotejo', () => {
    const paths = Object.keys(spec.paths ?? {})
    for (const p of ['/v1/verifactu/registros', '/v1/verifactu/cadena', '/v1/verifactu/cotejo']) {
      expect(paths).toContain(p)
    }
  })
})
