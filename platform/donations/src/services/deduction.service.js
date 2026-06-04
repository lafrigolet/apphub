// Servicio de cálculo de la deducción IRPF estimada por donativos de un
// NIF en un ejercicio (Ley 49/2002), incluyendo el tramo de
// fidelización (40 % a partir de 3 años consecutivos de donativo).
//
// Es un cálculo asistencial — no sustituye al asesoramiento fiscal. El
// importe real depende de la base liquidable del contribuyente y de los
// límites del 10 % de la base. Aquí estimamos sólo el porcentaje por
// tramos sobre lo donado al tenant.

import { withTenantTransaction } from '../lib/db.js'
import { normalizeNif, isValidNif } from '../lib/nif.js'
import { computeIrpfDeduction, consecutiveYearsForLoyalty } from '../lib/deduction.js'
import * as repo from '../repositories/donations.repository.js'
import { ForbiddenError, ValidationError } from '@apphub/platform-sdk/errors'

const ADMIN_ROLES = new Set(['owner', 'admin', 'staff', 'super_admin'])

function requireAdmin(identity) {
  if (!identity?.userId) throw new ForbiddenError()
  if (!ADMIN_ROLES.has(identity.role)) throw new ForbiddenError('Only admin/staff')
}

/**
 * Calcula la deducción estimada (céntimos) para un NIF y un ejercicio.
 * Determina la fidelización a partir de los años con donativo del NIF.
 */
export async function estimateDeduction(identity, { year, donorNif }) {
  requireAdmin(identity)
  if (!Number.isInteger(year)) throw new ValidationError('year debe ser entero')
  const nif = normalizeNif(donorNif)
  if (!nif) throw new ValidationError('donorNif requerido')
  if (!isValidNif(nif)) throw new ValidationError('donorNif no es un NIF/NIE/CIF válido')

  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId ?? null, async (c) => {
    const baseCents = await repo.totalForNifAndYear(c, nif, year)
    const years = await repo.listDonationYearsForNif(c, nif)
    const { consecutiveYears, loyal } = consecutiveYearsForLoyalty(years, year)
    const deduction = computeIrpfDeduction(baseCents, loyal)
    return {
      donorNif:         nif,
      fiscalYear:       year,
      consecutiveYears,
      ...deduction,
    }
  })
}
