// Dynamic tenant_id resolution by subdomain (no env vars). Cached in
// memory to avoid N calls per mount. Wired by /opendragon-implementa.
const cache = new Map()
export const APP_ID = 'verifactu'

// Tenant demo fijo mientras el portal no tiene login. Coincide con el seed
// de platform/verifactu (migration 0002_seed_demo.sql). Cuando se cablee el
// login real, el tenant saldrá del JWT y este helper desaparece.
export const DEMO_TENANT_ID = '11111111-1111-4111-8111-111111111111'

// Query string de scope para los endpoints públicos del módulo verifactu.
export const scopeQS = () =>
  `appId=${encodeURIComponent(APP_ID)}&tenantId=${encodeURIComponent(DEMO_TENANT_ID)}`

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
