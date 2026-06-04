import { withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/donors.repository.js'
import { ForbiddenError, NotFoundError } from '@apphub/platform-sdk/errors'

const ADMIN_ROLES = new Set(['owner', 'admin', 'staff', 'super_admin'])

function requireAdmin(identity) {
  if (!identity?.userId) throw new ForbiddenError()
  if (!ADMIN_ROLES.has(identity.role)) throw new ForbiddenError('Only admin/staff')
}

export async function listDonors(identity, filters) {
  requireAdmin(identity)
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId ?? null, (c) =>
    repo.listUniqueDonors(c, filters),
  )
}

export async function getDonor(identity, donorKey) {
  requireAdmin(identity)
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId ?? null, async (c) => {
    const donor = await repo.getDonorByKey(c, donorKey)
    if (!donor) throw new NotFoundError('Donor')
    return donor
  })
}

// Escapa un campo para CSV RFC-4180: envuelve en comillas si contiene
// coma, comilla o salto de línea; duplica las comillas internas.
function csvField(value) {
  if (value == null) return ''
  const s = String(value)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

const CSV_HEADER = [
  'donor_key', 'donor_nif', 'donor_email', 'donor_name', 'registered',
  'donations_count', 'total_cents', 'first_donation_at', 'last_donation_at',
]

// Exporta el listado de donantes a CSV (UTF-8). Devuelve { filename, csv }.
// Reutiliza el listado agregado sin paginar (limit alto) para el export.
export async function exportDonorsCsv(identity, filters = {}) {
  requireAdmin(identity)
  const rows = await withTenantTransaction(
    identity.appId, identity.tenantId, identity.subTenantId ?? null,
    (c) => repo.listUniqueDonors(c, { ...filters, limit: 10000, offset: 0 }),
  )
  const lines = [CSV_HEADER.join(',')]
  for (const r of rows) {
    lines.push([
      csvField(r.donor_key),
      csvField(r.donor_nif),
      csvField(r.donor_email),
      csvField(r.donor_name),
      csvField(r.registered),
      csvField(r.donations_count),
      csvField(r.total_cents),
      csvField(r.first_donation_at ? new Date(r.first_donation_at).toISOString() : ''),
      csvField(r.last_donation_at ? new Date(r.last_donation_at).toISOString() : ''),
    ].join(','))
  }
  // CRLF entre filas — máxima compatibilidad con Excel.
  const csv = lines.join('\r\n') + '\r\n'
  const filename = `donantes_${new Date().toISOString().slice(0, 10)}.csv`
  return { filename, csv, count: rows.length }
}
