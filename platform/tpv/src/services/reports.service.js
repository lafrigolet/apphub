import { NotFoundError, ConflictError } from '@apphub/platform-sdk/errors'
import { withTenantTransaction } from '../lib/db.js'
import * as sessionsRepo from '../repositories/cash-sessions.repository.js'
import * as movementsRepo from '../repositories/cash-movements.repository.js'
import * as reportsRepo from '../repositories/reports.repository.js'
import * as zReportsRepo from '../repositories/z-reports.repository.js'

// Agregación de una sesión: la misma para el informe X (en curso, en vivo)
// y para el snapshot del informe Z (al cierre, inmutable).
export async function buildSessionAggregates(client, session) {
  const [paymentsByMethod, receipts, taxByRate, creditNotes, theoreticalCashCents] = await Promise.all([
    reportsRepo.paymentsBySession(client, session.id),
    reportsRepo.receiptsSummaryBySession(client, session.id),
    reportsRepo.taxByRateBySession(client, session.id),
    reportsRepo.creditNotesSummaryBySession(client, session.id),
    movementsRepo.sumCashBySession(client, session.id),
  ])
  const grossCents = receipts.reduce((s, r) => s + r.totalCents, 0)
  const tipsCents = paymentsByMethod.reduce((s, p) => s + p.tipCents, 0)
  return {
    sessionId: session.id,
    deviceId: session.device_id,
    openedAt: session.opened_at,
    openedBy: session.opened_by,
    openingFloatCents: Number(session.opening_float_cents),
    paymentsByMethod,
    receipts,
    taxByRate,
    creditNotes,
    grossSalesCents: grossCents,
    netSalesCents: grossCents - creditNotes.totalCents,
    tipsCents,
    theoreticalCashCents,
  }
}

// Informe X: ventas acumuladas de la sesión en curso, sin cerrar nada.
export async function getXReport(identity, sessionId) {
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId, async (c) => {
    const session = await sessionsRepo.findById(c, sessionId)
    if (!session) throw new NotFoundError('Session not found')
    return { kind: 'X', generatedAt: new Date().toISOString(), ...(await buildSessionAggregates(c, session)) }
  })
}

// Informe Z: snapshot inmutable generado al cerrar la sesión (F4 lo invoca
// desde sessions.service.closeSession). Aquí solo lectura.
export async function getZReport(identity, sessionId) {
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId, async (c) => {
    const z = await zReportsRepo.findBySession(c, sessionId)
    if (!z) throw new NotFoundError('Z report not found for this session')
    return z
  })
}

export async function getPeriodReport(identity, { from, to, groupBy }) {
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId, async (c) => {
    const [buckets, creditNotes] = await Promise.all([
      reportsRepo.receiptsByPeriod(c, { from, to, groupBy }),
      reportsRepo.creditNotesByPeriod(c, { from, to }),
    ])
    const totals = buckets.reduce(
      (acc, b) => ({
        receipts: acc.receipts + b.receipts,
        baseCents: acc.baseCents + b.baseCents,
        taxCents: acc.taxCents + b.taxCents,
        totalCents: acc.totalCents + b.totalCents,
      }),
      { receipts: 0, baseCents: 0, taxCents: 0, totalCents: 0 },
    )
    return {
      from, to, groupBy: groupBy ?? 'day',
      buckets,
      creditNotes,
      totals: { ...totals, netCents: totals.totalCents - creditNotes.totalCents },
    }
  })
}

function csvEscape(v) {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function exportCsv(identity, { from, to }) {
  const rows = await withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId, (c) =>
    reportsRepo.exportRows(c, { from, to }))
  const header = [
    'num_serie', 'doc_kind', 'type', 'status', 'issued_at', 'currency',
    'base_cents', 'tax_cents', 'total_cents', 'tax_breakdown',
    'receptor_nif', 'receptor_name', 'bill_id',
  ]
  const lines = rows.map((r) => [
    r.num_serie, r.doc_kind, r.type, r.status, r.issued_at?.toISOString?.() ?? r.issued_at, r.currency,
    r.subtotal_cents, r.tax_cents, r.total_cents,
    r.tax_breakdown ? JSON.stringify(r.tax_breakdown) : '',
    r.receptor_nif, r.receptor_name, r.bill_id,
  ].map(csvEscape).join(';'))
  return [header.join(';'), ...lines].join('\n')
}
