import { withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/tenant-settings.repository.js'
import { ForbiddenError, ValidationError } from '@apphub/platform-sdk/errors'

const ADMIN_ROLES = new Set(['owner', 'admin', 'staff', 'super_admin'])
const MIN_AMOUNT_CENTS = 100  // 1€ — coherente con el checkout
const MAX_SUGGESTED = 12

function requireAdmin(identity) {
  if (!identity?.userId) throw new ForbiddenError()
  if (!ADMIN_ROLES.has(identity.role)) throw new ForbiddenError('Only admin/staff')
}

// Valida un array de importes sugeridos: enteros ≥ 1€, sin duplicados,
// máximo MAX_SUGGESTED. Devuelve la lista normalizada (ordenada asc).
export function normalizeSuggestedAmounts(amounts) {
  if (amounts == null) return []
  if (!Array.isArray(amounts)) throw new ValidationError('suggestedAmountsCents debe ser un array')
  if (amounts.length > MAX_SUGGESTED) {
    throw new ValidationError(`máximo ${MAX_SUGGESTED} importes sugeridos`)
  }
  for (const a of amounts) {
    if (!Number.isInteger(a) || a < MIN_AMOUNT_CENTS) {
      throw new ValidationError(`cada importe sugerido debe ser entero ≥ ${MIN_AMOUNT_CENTS}`)
    }
  }
  const unique = [...new Set(amounts)].sort((x, y) => x - y)
  return unique
}

// Lectura admin de la configuración del tenant. Si no hay fila, devuelve
// un default vacío (no crea la fila).
export async function getSettings(identity) {
  requireAdmin(identity)
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId ?? null, async (c) => {
    const row = await repo.find(c, {
      appId: identity.appId, tenantId: identity.tenantId, subTenantId: identity.subTenantId ?? null,
    })
    return row ?? {
      app_id: identity.appId, tenant_id: identity.tenantId,
      sub_tenant_id: identity.subTenantId ?? null,
      default_suggested_amounts_cents: [],
    }
  })
}

export async function updateSettings(identity, { defaultSuggestedAmountsCents }) {
  requireAdmin(identity)
  const normalized = normalizeSuggestedAmounts(defaultSuggestedAmountsCents)
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId ?? null, (c) =>
    repo.upsert(c, {
      appId: identity.appId, tenantId: identity.tenantId, subTenantId: identity.subTenantId ?? null,
      defaultSuggestedAmountsCents: normalized,
    }),
  )
}

// Lectura PÚBLICA de importes sugeridos para el formulario de donación.
// Sin JWT: el caller pasa appId+tenantId (y opcionalmente causeId). La
// precedencia es: override de la causa → default del tenant → [].
export async function getPublicSuggestedAmounts({ appId, tenantId, causeId = null }) {
  if (!appId || !tenantId) throw new ValidationError('appId y tenantId requeridos')
  return withTenantTransaction(appId, tenantId, null, async (c) => {
    if (causeId) {
      const { rows } = await c.query(
        `SELECT suggested_amounts_cents
           FROM platform_donations.causes WHERE id = $1 LIMIT 1`,
        [causeId],
      )
      const override = rows[0]?.suggested_amounts_cents
      if (Array.isArray(override) && override.length > 0) {
        return override.map((n) => Number(n))
      }
    }
    const settings = await repo.find(c, { appId, tenantId, subTenantId: null })
    return (settings?.default_suggested_amounts_cents ?? []).map((n) => Number(n))
  })
}
