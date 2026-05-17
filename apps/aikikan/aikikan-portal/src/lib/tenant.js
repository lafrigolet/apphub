// Resuelve el tenant_id real a partir del subdomain del portal.
// Cachea el resultado en memoria — el subdomain no cambia dentro de
// una sesión, así que evitamos N llamadas a /api/tenants por mount.
//
// Lo usan los componentes públicos (Hero, Dojos, Videos, Events) para
// pedir datos sin JWT. El subdomain del portal coincide con el subdomain
// del tenant (un único tenant aikikan = subdomain 'aikikan').
const cache = new Map()

export async function resolveTenantId(subdomain) {
  if (cache.has(subdomain)) return cache.get(subdomain)
  const res = await fetch(`/api/tenants/tenants/by-subdomain/${encodeURIComponent(subdomain)}`)
  if (!res.ok) throw new Error(`No se pudo resolver tenant ${subdomain}`)
  const j = await res.json()
  const id = j.tenantId ?? j.data?.tenantId
  if (!id) throw new Error(`Respuesta inesperada resolviendo tenant ${subdomain}`)
  cache.set(subdomain, id)
  return id
}
