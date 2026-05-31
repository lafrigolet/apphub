// Dynamic tenant_id resolution by subdomain (no env vars). Cached in
// memory to avoid N calls per mount. Wired by /opendragon-implementa.
const cache = new Map()
export const APP_ID = 'verifactu'

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
