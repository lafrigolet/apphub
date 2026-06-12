// Resuelve el scope (appId/tenantId/subTenantId) efectivo de una petición a las
// rutas per-tenant de TPV (settings, series). staff/super_admin pueden scopear
// la petición a CUALQUIER tenant vía ?appId=&tenantId= (lo usa console para
// gestionar la config en nombre de un tenant). Los usuarios normales nunca
// pueden sobreescribir su propio tenant. Mismo patrón que platform/splitpay.
const STAFF_ROLES = new Set(['staff', 'super_admin'])

export function resolveTenantScope(identity, query = {}) {
  const canImpersonate = STAFF_ROLES.has(identity.role)
  const overrideTenantId = canImpersonate ? query?.tenantId : null
  const overrideAppId    = canImpersonate ? query?.appId    : null
  return {
    appId:        overrideAppId    ?? identity.appId,
    tenantId:     overrideTenantId ?? identity.tenantId,
    subTenantId:  identity.subTenantId ?? null,
    impersonated: !!overrideTenantId,
  }
}
