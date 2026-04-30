import { pool, withTenantTransaction } from '../lib/db.js'
import { publish, subscribe } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import * as repo from '../repositories/packages.repository.js'
import { ConflictError, NotFoundError } from '../utils/errors.js'

// ── Templates ───────────────────────────────────────────────────────
export async function createTemplate(ctx, body) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.insertTemplate(c, ctx.appId, ctx.tenantId, body),
  )
}

export async function listTemplates(ctx, opts) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.listTemplates(c, ctx.appId, ctx.tenantId, opts),
  )
}

// ── Purchase ────────────────────────────────────────────────────────
export async function purchase(ctx, body) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const tpl = await repo.findTemplateById(c, ctx.appId, ctx.tenantId, body.templateId)
    if (!tpl) throw new NotFoundError('package template')
    if (!tpl.is_active) throw new ConflictError('package template is not active')
    const expiresAt = new Date(Date.now() + tpl.validity_days * 24 * 60 * 60 * 1000).toISOString()
    const purchase = await repo.insertPurchase(c, ctx.appId, ctx.tenantId, {
      templateId: tpl.id,
      clientUserId: body.clientUserId ?? ctx.userId,
      serviceId: tpl.service_id,
      totalSessions: tpl.total_sessions,
      remainingSessions: tpl.total_sessions,
      pricePaidCents: body.pricePaidCents ?? tpl.price_cents,
      currency: tpl.currency,
      expiresAt,
      metadata: body.metadata ?? {},
    })
    await publish({
      type: 'package.purchased',
      payload: {
        appId: ctx.appId, tenantId: ctx.tenantId,
        packageId: purchase.id, clientUserId: purchase.client_user_id,
        serviceId: purchase.service_id, totalSessions: purchase.total_sessions,
        expiresAt: purchase.expires_at,
      },
    })
    return purchase
  })
}

export async function getPurchase(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const p = await repo.findPurchaseById(c, ctx.appId, ctx.tenantId, id)
    if (!p) throw new NotFoundError('package')
    const redemptions = await repo.listRedemptions(c, ctx.appId, ctx.tenantId, id)
    return { ...p, redemptions }
  })
}

export async function listPurchases(ctx, clientUserId, opts) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.listPurchasesForClient(c, ctx.appId, ctx.tenantId, clientUserId, opts),
  )
}

// ── Redeem ──────────────────────────────────────────────────────────
export async function redeem(ctx, { packageId, bookingId }) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const updated = await repo.decrementSessions(c, ctx.appId, ctx.tenantId, packageId, -1)
    if (!updated) throw new ConflictError('package has no remaining sessions or is invalid')
    await repo.insertRedemption(c, ctx.appId, ctx.tenantId, {
      packageId, bookingId, delta: -1, reason: 'redeem',
    })
    if (updated.status === 'exhausted') {
      await publish({
        type: 'package.exhausted',
        payload: { appId: ctx.appId, tenantId: ctx.tenantId, packageId, clientUserId: updated.client_user_id },
      })
    }
    return updated
  })
}

export async function refundSession(ctx, { packageId, bookingId }) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const p = await repo.findPurchaseById(c, ctx.appId, ctx.tenantId, packageId)
    if (!p) throw new NotFoundError('package')
    if (p.remaining_sessions >= p.total_sessions) {
      throw new ConflictError('cannot refund: all sessions still available')
    }
    const updated = await repo.decrementSessions(c, ctx.appId, ctx.tenantId, packageId, +1)
    await repo.insertRedemption(c, ctx.appId, ctx.tenantId, {
      packageId, bookingId, delta: +1, reason: 'refund',
    })
    // Refunding a session re-activates an exhausted package.
    if (p.status === 'exhausted') {
      await repo.setStatus(c, ctx.appId, ctx.tenantId, packageId, 'active')
    }
    return updated
  })
}

// Event consumer: when a booking is completed and references a package, redeem one session.
// When a booking is cancelled and was paid via package, refund one session.
export async function handleEvent(event) {
  try {
    const p = event?.payload ?? {}
    if (!p.appId || !p.tenantId || !p.bookingId) return
    const ctx = { appId: p.appId, tenantId: p.tenantId, subTenantId: null, userId: null, role: 'system' }

    await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT package_id FROM platform_bookings.bookings
         WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
        [ctx.appId, ctx.tenantId, p.bookingId],
      )
      const packageId = rows[0]?.package_id
      if (!packageId) return

      if (event.type === 'booking.completed') {
        await repo.decrementSessions(c, ctx.appId, ctx.tenantId, packageId, -1)
        await repo.insertRedemption(c, ctx.appId, ctx.tenantId, {
          packageId, bookingId: p.bookingId, delta: -1, reason: 'redeem',
        })
      } else if (event.type === 'booking.cancelled' || event.type === 'booking.no_show') {
        // Cancellation refund only when no_show=false, in this MVP we refund both.
        await repo.decrementSessions(c, ctx.appId, ctx.tenantId, packageId, +1)
        await repo.insertRedemption(c, ctx.appId, ctx.tenantId, {
          packageId, bookingId: p.bookingId, delta: +1, reason: 'refund',
        })
      }
    })
  } catch (err) {
    logger.warn({ err, type: event.type }, 'packages event handler error')
  }
}

export { subscribe }
