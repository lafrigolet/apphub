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
export async function closePeriod(ctx, { practitionerId, periodStart, periodEnd, currency }) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const accruals = await repo.listAccruals(c, ctx.appId, ctx.tenantId, {
      practitionerId, status: 'accrued', from: periodStart, to: periodEnd,
    })
    if (!accruals.length) throw new ConflictError('no accruals in period')
    const total = accruals.reduce((s, a) => s + Number(a.commission_cents), 0)
    const payout = await repo.insertPayout(c, ctx.appId, ctx.tenantId, {
      practitionerId, periodStart, periodEnd,
      totalCommissionCents: total, currency: currency ?? 'EUR',
    })
    await repo.attachAccrualsToPayout(c, ctx.appId, ctx.tenantId, payout.id, practitionerId, periodStart, periodEnd)
    await publish({
      type: 'payout.created',
      payload: {
        appId: ctx.appId, tenantId: ctx.tenantId, payoutId: payout.id,
        practitionerId, totalCommissionCents: total,
      },
    })
    return payout
  })
}

export async function markPayoutPaid(ctx, id, externalRef) {
  const updated = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.setPayoutStatus(c, ctx.appId, ctx.tenantId, id, 'paid', externalRef),
  )
  if (!updated) throw new NotFoundError('payout')
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

// Compute commission for a (gross, rule) pair — extracted for reuse + testing.
export function computeCommission({ grossCents, ratePct, flatFeeCents = 0 }) {
  const pct = Number(ratePct ?? 0) / 100
  return Math.max(0, Math.round(Number(grossCents) * pct) + Number(flatFeeCents ?? 0))
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
      // Reverse any previously-accrued commission for this booking.
      await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
        const accrual = await repo.findAccrualByBooking(c, ctx.appId, ctx.tenantId, p.bookingId)
        if (accrual && accrual.status === 'accrued') {
          await repo.reverseAccrual(c, ctx.appId, ctx.tenantId, accrual.id)
        }
      })
    }
  } catch (err) {
    logger.warn({ err, type: event.type }, 'practitioner-payouts event handler error')
  }
}

export { subscribe }
