// Resuelve el tenant_id de js-electric a partir del subdomain ('js-electric').
// Cachea el resultado en memoria para evitar N llamadas dentro de una sesión.
// Pattern lifted from apps/aikikan/aikikan-portal/src/lib/tenant.js.
const cache = new Map()

export const APP_ID = 'js-electric'

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
