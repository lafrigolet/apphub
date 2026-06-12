// Resuelve { appId, tenantId } del portal a partir del subdominio del host
// (p.ej. tpv.hulkstein.com / tpv.hulkstein.local → label 'tpv'), llamando al
// endpoint público /api/tenants/tenants/by-subdomain/:subdomain. Cachea el
// resultado en memoria. Patrón tomado de apps/js-electric y apps/aikikan.
//
// El subdominio puede forzarse con VITE_TPV_TENANT_SUBDOMAIN (útil en dev por
// localhost directo, donde el host no es un subdominio de tenant).
let _cache = null

function hostSubdomain() {
  const forced = import.meta.env.VITE_TPV_TENANT_SUBDOMAIN
  if (forced) return forced
  return window.location.hostname.split('.')[0]
}

export async function resolveScope() {
  if (_cache) return _cache
  const subdomain = hostSubdomain()
  const res = await fetch(`/api/tenants/tenants/by-subdomain/${encodeURIComponent(subdomain)}`)
  if (!res.ok) throw new Error(`No se pudo resolver el tenant para '${subdomain}'`)
  const j = await res.json()
  const tenantId = j.tenantId ?? j.data?.tenantId
  const appId    = j.appId ?? j.data?.appId
  if (!tenantId || !appId) throw new Error(`Respuesta inesperada resolviendo tenant '${subdomain}'`)
  _cache = { appId, tenantId }
  return _cache
}
