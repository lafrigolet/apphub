import { pool, withTenantTransaction } from '../lib/db.js'
import { publish, subscribe } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import * as repo from '../repositories/practitioner-payouts.repository.js'
import { ConflictError, NotFoundError } from '../utils/errors.js'

// ── Commission rules ────────────────────────────────────────────────
export async function createRule(ctx, body) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.insertCommissionRule(c, ctx.appId, ctx.tenantId, body),
  )
}

export async function listRules(ctx, opts) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.listCommissionRules(c, ctx.appId, ctx.tenantId, opts),
  )
}

// ── Accruals ────────────────────────────────────────────────────────
export async function createAccrual(ctx, body) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.insertAccrual(c, ctx.appId, ctx.tenantId, body),
  )
}

export async function listAccruals(ctx, opts) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.listAccruals(c, ctx.appId, ctx.tenantId, opts),
  )
}

// ── Payouts ─────────────────────────────────────────────────────────
// Apply an IRPF-style withholding to a gross commission. Returns the integer
// cents withheld and the net (gross - withheld). Negative gross (net advances
// / deductions dominating) yields zero withholding and a negative net.
export function applyWithholding(grossCents, withholdingPct) {
  const gross = Number(grossCents)
  const pct = Number(withholdingPct ?? 0)
  if (gross <= 0 || pct <= 0) return { withholdingCents: 0, netCents: gross }
  const withholdingCents = Math.round(gross * (pct / 100))
  return { withholdingCents, netCents: gross - withholdingCents }
}

export async function closePeriod(ctx, { practitionerId, periodStart, periodEnd, currency }) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const accruals = await repo.listAccruals(c, ctx.appId, ctx.tenantId, {
      practitionerId, status: 'accrued', from: periodStart, to: periodEnd,
    })
    if (!accruals.length) throw new ConflictError('no accruals in period')
    const total = accruals.reduce((s, a) => s + Number(a.commission_cents), 0)

    // IRPF withholding: per-practitioner override wins over tenant default.
    const withholdingPct = await repo.resolveWithholdingPct(c, ctx.appId, ctx.tenantId, practitionerId)
    const { withholdingCents, netCents } = applyWithholding(total, withholdingPct)

    const payout = await repo.insertPayout(c, ctx.appId, ctx.tenantId, {
      practitionerId, periodStart, periodEnd,
      totalCommissionCents: total,
      grossCommissionCents: total,
      withholdingPct,
      withholdingCents,
      netCommissionCents: netCents,
      currency: currency ?? 'EUR',
    })
    await repo.attachAccrualsToPayout(c, ctx.appId, ctx.tenantId, payout.id, practitionerId, periodStart, periodEnd)
    await publish({
      type: 'payout.created',
      payload: {
        appId: ctx.appId, tenantId: ctx.tenantId, payoutId: payout.id,
        practitionerId, totalCommissionCents: total,
        withholdingCents, netCommissionCents: netCents,
      },
    })
    return payout
  })
}

export async function markPayoutPaid(ctx, id, externalRef) {
  const updated = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    // Guard: only a 'pending' payout can transition to 'paid'. If the row
    // exists but isn't pending (already paid / cancelled) → ConflictError.
    const ok = await repo.setPayoutStatus(c, ctx.appId, ctx.tenantId, id, 'paid', externalRef, { expectedStatus: 'pending' })
    if (ok) return ok
    const existing = await repo.findPayoutById(c, ctx.appId, ctx.tenantId, id)
    if (!existing) throw new NotFoundError('payout')
    throw new ConflictError(`payout not pending (status=${existing.status})`)
  })
  await publish({
    type: 'payout.paid',
    payload: { appId: ctx.appId, tenantId: ctx.tenantId, payoutId: id, externalRef },
  })
  return updated
}

export async function getPayout(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const p = await repo.findPayoutById(c, ctx.appId, ctx.tenantId, id)
    if (!p) throw new NotFoundError('payout')
    return p
  })
}

export async function listPayouts(ctx, opts) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.listPayouts(c, ctx.appId, ctx.tenantId, opts),
  )
}

// ── Withholding (IRPF) settings ─────────────────────────────────────────
export async function listWithholdingSettings(ctx) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.listWithholdingSettings(c, ctx.appId, ctx.tenantId),
  )
}

export async function upsertWithholdingSetting(ctx, body) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.upsertWithholdingSetting(c, ctx.appId, ctx.tenantId, body),
  )
}

// ── Payout schedules CRUD ───────────────────────────────────────────────
export async function createSchedule(ctx, body) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.insertSchedule(c, ctx.appId, ctx.tenantId, body),
  )
}

export async function listSchedules(ctx, opts) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.listSchedules(c, ctx.appId, ctx.tenantId, opts),
  )
}

export async function getSchedule(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const s = await repo.findScheduleById(c, ctx.appId, ctx.tenantId, id)
    if (!s) throw new NotFoundError('schedule')
    return s
  })
}

export async function updateSchedule(ctx, id, patch) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const existing = await repo.findScheduleById(c, ctx.appId, ctx.tenantId, id)
    if (!existing) throw new NotFoundError('schedule')
    return repo.updateSchedule(c, ctx.appId, ctx.tenantId, id, patch)
  })
}

export async function deleteSchedule(ctx, id) {
  const deleted = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.deleteSchedule(c, ctx.appId, ctx.tenantId, id),
  )
  if (!deleted) throw new NotFoundError('schedule')
  return { id: deleted.id }
}

// Compute commission for a (gross, rule) pair — extracted for reuse + testing.
export function computeCommission({ grossCents, ratePct, flatFeeCents = 0 }) {
  const pct = Number(ratePct ?? 0) / 100
  return Math.max(0, Math.round(Number(grossCents) * pct) + Number(flatFeeCents ?? 0))
}

// Event consumer for scheduled payout closure. Listens to payout.period_due
// (published by platform-scheduler) and runs closePeriod for the schedule's
// (practitionerId, periodStart, periodEnd). Failures are swallowed so a single
// bad schedule doesn't block subsequent payouts.
export async function handleScheduledPayout(event) {
  try {
    if (event.type !== 'payout.period_due') return
    const p = event.payload ?? {}
    if (!p.appId || !p.tenantId || !p.practitionerId || !p.periodStart || !p.periodEnd) return
    const ctx = { appId: p.appId, tenantId: p.tenantId, subTenantId: null, userId: null, role: 'system' }
    try {
      await closePeriod(ctx, {
        practitionerId: p.practitionerId,
        periodStart:    p.periodStart,
        periodEnd:      p.periodEnd,
      })
    } catch (err) {
      // 'no accruals in period' is the expected no-op case for inactive
      // practitioners — log info, not warn.
      if (err?.code === 'CONFLICT') {
        logger.info({ scheduleId: p.scheduleId, reason: err.message }, 'scheduled close: no accruals')
      } else {
        logger.warn({ err, scheduleId: p.scheduleId }, 'scheduled close failed')
      }
    }
  } catch (err) {
    logger.warn({ err }, 'handleScheduledPayout error')
  }
}

// Event consumer: when a booking is completed (and has price), accrue commission
// for each practitioner-resource attached to the booking.
export async function handleEvent(event) {
  try {
    const p = event?.payload ?? {}
    if (!p.appId || !p.tenantId || !p.bookingId) return
    const ctx = { appId: p.appId, tenantId: p.tenantId, subTenantId: null, userId: null, role: 'system' }

    if (event.type === 'booking.completed') {
      await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
        // Cross-schema lookup of the booking + practitioner resource(s).
        const { rows: bookingRows } = await c.query(
          `SELECT b.id, b.service_id, b.price_cents
           FROM platform_bookings.bookings b
           WHERE b.app_id=$1 AND b.tenant_id=$2 AND b.id=$3`,
          [ctx.appId, ctx.tenantId, p.bookingId],
        )
        const booking = bookingRows[0]
        if (!booking || !booking.price_cents) return

        const { rows: practitioners } = await c.query(
          `SELECT r.id AS practitioner_id
           FROM platform_bookings.booking_resources br
           JOIN platform_resources.resources r ON r.id = br.resource_id
           WHERE br.app_id=$1 AND br.tenant_id=$2 AND br.booking_id=$3 AND r.kind='practitioner'`,
          [ctx.appId, ctx.tenantId, p.bookingId],
        )
        if (!practitioners.length) return

        // Split gross evenly across practitioners (rounding remainder on the first).
        const gross = Number(booking.price_cents)
        const baseShare = Math.floor(gross / practitioners.length)
        const remainder = gross - baseShare * practitioners.length

        for (let i = 0; i < practitioners.length; i++) {
          const share = baseShare + (i === 0 ? remainder : 0)
          const rule  = await repo.findApplicableRule(
            c, ctx.appId, ctx.tenantId, practitioners[i].practitioner_id, booking.service_id, new Date().toISOString(),
          )
          if (!rule) continue
          const commission = computeCommission({
            grossCents: share, ratePct: rule.rate_pct, flatFeeCents: rule.flat_fee_cents,
          })
          await repo.insertAccrual(c, ctx.appId, ctx.tenantId, {
            practitionerId: practitioners[i].practitioner_id,
            serviceId: booking.service_id,
            bookingId: p.bookingId,
            grossCents: share,
            commissionCents: commission,
          })
        }
      })
    } else if (event.type === 'booking.cancelled' || event.type === 'booking.no_show') {
      // Reverse (if not yet liquidated) or clawback (if already paid) the
      // commission accrued for this booking.
      await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
        const accrual = await repo.findAccrualByBooking(c, ctx.appId, ctx.tenantId, p.bookingId)
        if (!accrual) return
        if (accrual.status === 'accrued') {
          await repo.reverseAccrual(c, ctx.appId, ctx.tenantId, accrual.id)
          await publish({
            type: 'accrual.reversed',
            payload: {
              appId: ctx.appId, tenantId: ctx.tenantId, accrualId: accrual.id,
              practitionerId: accrual.practitioner_id, bookingId: p.bookingId, mode: 'reversed',
            },
          })
        } else if (accrual.status === 'paid') {
          // Already liquidated → cannot reverse the closed payout. Create a
          // negative 'adjustment' clawback accrual that deducts the same
          // commission from the NEXT period close.
          const clawback = await repo.insertAccrual(c, ctx.appId, ctx.tenantId, {
            practitionerId:  accrual.practitioner_id,
            serviceId:       accrual.service_id,
            bookingId:       p.bookingId,
            grossCents:      -Number(accrual.gross_cents),
            commissionCents: -Number(accrual.commission_cents),
            type:            'adjustment',
            metadata: {
              reason: `clawback for ${event.type}`,
              source_accrual_id: accrual.id,
              source_payout_id: accrual.payout_id ?? null,
            },
          })
          await publish({
            type: 'accrual.reversed',
            payload: {
              appId: ctx.appId, tenantId: ctx.tenantId, accrualId: accrual.id,
              clawbackAccrualId: clawback.id, practitionerId: accrual.practitioner_id,
              bookingId: p.bookingId, mode: 'clawback',
            },
          })
        }
      })
    }
  } catch (err) {
    logger.warn({ err, type: event.type }, 'practitioner-payouts event handler error')
  }
}

export { subscribe }

// ── PDF report (period statement) ───────────────────────────────────────
import { createTextPdf } from '@apphub/platform-sdk/simple-pdf'

function fmtAmount(cents, currency) {
  if (cents == null) return ''
  try {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency: currency || 'EUR' })
      .format(cents / 100)
  } catch { return `${(cents / 100).toFixed(2)} ${currency || ''}`.trim() }
}

export async function exportPayoutPdf(ctx, payoutId) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const payout = await repo.findPayoutById(c, ctx.appId, ctx.tenantId, payoutId)
    if (!payout) throw new NotFoundError('payout')
    const accruals = await repo.listAccruals(c, ctx.appId, ctx.tenantId, {
      practitionerId: payout.practitioner_id,
      from:           payout.period_start,
      to:             payout.period_end,
    })

    const lines = []
    lines.push(`Profesional: ${payout.practitioner_id}`)
    lines.push(`Periodo: ${new Date(payout.period_start).toLocaleDateString('es-ES')} — ${new Date(payout.period_end).toLocaleDateString('es-ES')}`)
    lines.push(`Estado: ${payout.status}`)
    if (payout.external_ref) lines.push(`Referencia externa: ${payout.external_ref}`)
    lines.push(`Moneda: ${payout.currency ?? 'EUR'}`)
    // Prefer the real payout columns; fall back to legacy aliases for safety.
    const grossCents = payout.gross_commission_cents ?? payout.gross_amount_cents ?? payout.total_commission_cents
    const netCents   = payout.net_commission_cents   ?? payout.net_amount_cents   ?? payout.total_commission_cents
    lines.push('')
    lines.push(`Total bruto: ${fmtAmount(grossCents, payout.currency)}`)
    if (payout.withholding_cents != null && Number(payout.withholding_cents) > 0) {
      lines.push(`Retención IRPF (${Number(payout.withholding_pct ?? 0)}%): -${fmtAmount(payout.withholding_cents, payout.currency)}`)
    }
    lines.push(`Total neto: ${fmtAmount(netCents, payout.currency)}`)
    lines.push('')
    lines.push(`Devengos del periodo (${accruals.length}):`)
    lines.push('-'.repeat(70))
    for (const a of accruals) {
      const at = new Date(a.occurred_at ?? a.created_at).toLocaleDateString('es-ES')
      const amount = a.commission_cents ?? a.amount_cents
      lines.push(`${at} · booking ${a.booking_id?.slice(0, 8) ?? '—'} · ${fmtAmount(amount, payout.currency)} · ${a.status}`)
    }

    return {
      filename: `payout-${payoutId.slice(0, 8)}.pdf`,
      pdf: createTextPdf({
        title: 'Liquidación profesional',
        lines,
      }),
    }
  })
}
