// Tenant lifecycle (sección 5 · P1) — slice end-to-end verificable contra el
// stack vivo: un tenant registrado en platform_tenants es consultable por la
// API pública y trae su subdominio (lo que luego siembra el server block
// nginx — cuyo render está unit-tested en nginx-config-render.test.js).
// Skip si platform-core no es accesible.
import { describe, it, expect } from 'vitest'

const BASE = process.env.PLATFORM_CORE_URL ?? 'http://localhost:3000'

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`)
  return { status: res.status, body: await res.json().catch(() => null) }
}

let reachable = false
try {
  const res = await fetch(`${BASE}/v1/tenants/public?appId=console`)
  reachable = res.ok
} catch { reachable = false }
const maybe = reachable ? it : it.skip
if (!reachable) {
  // eslint-disable-next-line no-console
  console.warn(`[tenant-lifecycle] platform-core no accesible en ${BASE} — tests SKIPeados`)
}

describe('tenant lifecycle — registrado → consultable', () => {
  maybe('la API pública de tenants responde una lista', async () => {
    const { status, body } = await getJson('/v1/tenants/public?appId=console')
    expect(status).toBe(200)
    const list = Array.isArray(body) ? body : (body?.data ?? [])
    expect(Array.isArray(list)).toBe(true)
  })

  maybe('los tenants registrados traen subdominio (insumo del server block nginx)', async () => {
    const { body } = await getJson('/v1/tenants/public?appId=console')
    const list = Array.isArray(body) ? body : (body?.data ?? [])
    if (list.length === 0) return // entorno sin seed: nada que afirmar
    const withSub = list.filter((t) => t.subdomain || t.subDomain)
    expect(withSub.length).toBeGreaterThan(0)
  })
})
