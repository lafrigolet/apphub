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
//
// A package can be redeemed by its owner OR by any user listed in
// platform_packages.package_authorized_users (family/household sharing).
// System ctx (event-consumer driven from booking.completed) bypasses the
// check because the ownership has already been validated upstream.
async function ensureRedeemAllowed(client, ctx, packageId) {
  if (ctx.role === 'system' || ['staff', 'super_admin'].includes(ctx.role)) return
  const pkg = await repo.findPurchaseById(client, ctx.appId, ctx.tenantId, packageId)
  if (!pkg) throw new NotFoundError('package')
  if (pkg.client_user_id === ctx.userId) return
  const ok = await repo.isAuthorized(client, ctx.appId, ctx.tenantId, packageId, ctx.userId)
  if (!ok) throw new ConflictError('user is not authorised to redeem this package')
}

export async function redeem(ctx, { packageId, bookingId }) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    await ensureRedeemAllowed(c, ctx, packageId)
    // #5 Idempotencia: si este booking ya consumió una sesión, no repetir.
    if (bookingId && await repo.redeemExistsForBooking(c, ctx.appId, ctx.tenantId, bookingId)) {
      return repo.findPurchaseById(c, ctx.appId, ctx.tenantId, packageId)
    }
    const updated = await repo.decrementSessions(c, ctx.appId, ctx.tenantId, packageId, -1)
    if (!updated) throw new ConflictError('package has no remaining sessions or is invalid')
    await repo.insertRedemption(c, ctx.appId, ctx.tenantId, {
      packageId, bookingId, delta: -1, reason: 'redeem',
      redeemerUserId: ctx.role === 'system' ? null : ctx.userId,
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

// ── Family sharing ──────────────────────────────────────────────────────

export async function listAuthorizedUsers(ctx, packageId) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const pkg = await repo.findPurchaseById(c, ctx.appId, ctx.tenantId, packageId)
    if (!pkg) throw new NotFoundError('package')
    return repo.listAuthorizedUsers(c, ctx.appId, ctx.tenantId, packageId)
  })
}

export async function addAuthorizedUser(ctx, packageId, body) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const pkg = await repo.findPurchaseById(c, ctx.appId, ctx.tenantId, packageId)
    if (!pkg) throw new NotFoundError('package')
    if (pkg.client_user_id !== ctx.userId && !['staff', 'super_admin'].includes(ctx.role)) {
      throw new ConflictError('only the owner can share a package')
    }
    return repo.addAuthorizedUser(c, ctx.appId, ctx.tenantId, packageId, {
      userId:      body.userId,
      displayName: body.displayName,
      addedBy:     ctx.userId,
    })
  })
}

export async function removeAuthorizedUser(ctx, packageId, userId) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const pkg = await repo.findPurchaseById(c, ctx.appId, ctx.tenantId, packageId)
    if (!pkg) throw new NotFoundError('package')
    if (pkg.client_user_id !== ctx.userId && !['staff', 'super_admin'].includes(ctx.role)) {
      throw new ConflictError('only the owner can revoke shared access')
    }
    const ok = await repo.removeAuthorizedUser(c, ctx.appId, ctx.tenantId, packageId, userId)
    if (!ok) throw new NotFoundError('authorized user')
  })
}

// ── Transfer / gifting ──────────────────────────────────────────────────

export async function transferPackage(ctx, packageId, body) {
  const kind = body.kind === 'gift' ? 'gift' : 'transfer'
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const pkg = await repo.findPurchaseById(c, ctx.appId, ctx.tenantId, packageId)
    if (!pkg) throw new NotFoundError('package')
    if (pkg.client_user_id !== ctx.userId && !['staff', 'super_admin'].includes(ctx.role)) {
      throw new ConflictError('only the current owner can transfer a package')
    }
    if (pkg.client_user_id === body.toUserId) {
      throw new ConflictError('package already belongs to that user')
    }
    const r = await repo.transferOwnership(
      c, ctx.appId, ctx.tenantId, packageId,
      pkg.client_user_id, body.toUserId, kind, body.message, ctx.userId,
    )
    if (!r) throw new ConflictError('transfer failed (concurrent change?)')
    await publish({
      type: 'package.transferred',
      payload: {
        appId: ctx.appId, tenantId: ctx.tenantId,
        packageId, fromUserId: pkg.client_user_id, toUserId: body.toUserId, kind,
      },
    })
    return r
  })
}

export async function listTransfers(ctx, packageId) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.listTransfers(c, ctx.appId, ctx.tenantId, packageId),
  )
}

// ── Auto-renew toggle + manual renew ───────────────────────────────────

export async function setAutoRenew(ctx, packageId, autoRenew) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const pkg = await repo.findPurchaseById(c, ctx.appId, ctx.tenantId, packageId)
    if (!pkg) throw new NotFoundError('package')
    if (pkg.client_user_id !== ctx.userId && !['staff', 'super_admin'].includes(ctx.role)) {
      throw new ConflictError('only the owner can toggle auto-renew')
    }
    return repo.setAutoRenew(c, ctx.appId, ctx.tenantId, packageId, autoRenew)
  })
}

// Manually creates a renewal package (used by the owner from the UI; the
// cron-driven flow can call this same path with role='system' once the
// scheduler job is implemented).
export async function renewPackage(ctx, packageId) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const pkg = await repo.findPurchaseById(c, ctx.appId, ctx.tenantId, packageId)
    if (!pkg) throw new NotFoundError('package')
    if (pkg.client_user_id !== ctx.userId && !['staff', 'super_admin', 'system'].includes(ctx.role)) {
      throw new ConflictError('only the owner can renew a package')
    }
    const tmpl = await repo.findTemplateById(c, ctx.appId, ctx.tenantId, pkg.template_id)
    if (!tmpl) throw new NotFoundError('template')
    const renewed = await repo.insertRenewal(c, ctx.appId, ctx.tenantId, pkg, tmpl)
    await publish({
      type: 'package.renewed',
      payload: {
        appId: ctx.appId, tenantId: ctx.tenantId,
        oldPackageId: packageId, newPackageId: renewed.id,
        clientUserId: renewed.client_user_id,
      },
    })
    return renewed
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

// ── #8 Manual balance adjustment (staff only) ───────────────────────────
// Applies an arbitrary delta to remaining_sessions with reason='adjust'.
// Positive adds sessions, negative removes (clamped at 0 by decrementSessions).
export async function adjustBalance(ctx, packageId, { delta, note, bookingId }) {
  if (!['staff', 'super_admin'].includes(ctx.role)) {
    throw new ConflictError('only staff can manually adjust a package balance')
  }
  if (!Number.isInteger(delta) || delta === 0) {
    throw new ConflictError('delta must be a non-zero integer')
  }
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const pkg = await repo.findPurchaseById(c, ctx.appId, ctx.tenantId, packageId)
    if (!pkg) throw new NotFoundError('package')
    const updated = await repo.decrementSessions(c, ctx.appId, ctx.tenantId, packageId, delta)
    if (!updated) throw new ConflictError('adjustment would push balance below zero or above total')
    // Re-activate an exhausted package if sessions were added back.
    if (delta > 0 && pkg.status === 'exhausted') {
      await repo.setStatus(c, ctx.appId, ctx.tenantId, packageId, 'active')
    }
    await repo.insertRedemption(c, ctx.appId, ctx.tenantId, {
      packageId, bookingId: bookingId ?? null, delta, reason: 'adjust',
      redeemerUserId: ctx.userId,
    })
    return repo.findPurchaseById(c, ctx.appId, ctx.tenantId, packageId)
  })
}

// ── #9 Freeze / unfreeze / extend validity (staff only) ──────────────────
function ensureStaff(ctx, action) {
  if (!['staff', 'super_admin'].includes(ctx.role)) {
    throw new ConflictError(`only staff can ${action} a package`)
  }
}

export async function freezePackage(ctx, packageId, body = {}) {
  ensureStaff(ctx, 'freeze')
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const pkg = await repo.findPurchaseById(c, ctx.appId, ctx.tenantId, packageId)
    if (!pkg) throw new NotFoundError('package')
    const updated = await repo.freezePackage(c, ctx.appId, ctx.tenantId, packageId)
    if (!updated) throw new ConflictError('only an active package can be frozen')
    await repo.insertFreeze(c, ctx.appId, ctx.tenantId, {
      packageId, reason: body.reason, actorUserId: ctx.userId,
    })
    await publish({
      type: 'package.frozen',
      payload: { appId: ctx.appId, tenantId: ctx.tenantId, packageId, clientUserId: updated.client_user_id },
    })
    return updated
  })
}

export async function unfreezePackage(ctx, packageId) {
  ensureStaff(ctx, 'unfreeze')
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const pkg = await repo.findPurchaseById(c, ctx.appId, ctx.tenantId, packageId)
    if (!pkg) throw new NotFoundError('package')
    const updated = await repo.unfreezePackage(c, ctx.appId, ctx.tenantId, packageId)
    if (!updated) throw new ConflictError('package is not frozen')
    const daysAdded = updated.frozen_days_total - (pkg.frozen_days_total ?? 0)
    await repo.closeFreeze(c, ctx.appId, ctx.tenantId, packageId, daysAdded)
    await publish({
      type: 'package.unfrozen',
      payload: { appId: ctx.appId, tenantId: ctx.tenantId, packageId, clientUserId: updated.client_user_id, daysAdded },
    })
    return updated
  })
}

export async function extendExpiry(ctx, packageId, { days }) {
  ensureStaff(ctx, 'extend')
  if (!Number.isInteger(days) || days <= 0) throw new ConflictError('days must be a positive integer')
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const pkg = await repo.findPurchaseById(c, ctx.appId, ctx.tenantId, packageId)
    if (!pkg) throw new NotFoundError('package')
    const updated = await repo.extendExpiry(c, ctx.appId, ctx.tenantId, packageId, days)
    if (!updated) throw new ConflictError('package cannot be extended in its current status')
    return updated
  })
}

export async function listFreezes(ctx, packageId) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const pkg = await repo.findPurchaseById(c, ctx.appId, ctx.tenantId, packageId)
    if (!pkg) throw new NotFoundError('package')
    return repo.listFreezes(c, ctx.appId, ctx.tenantId, packageId)
  })
}

// ── #4 Cancellation with proportional monetary refund ────────────────────
// Marks the package status='refunded', computes the proportional refund amount
// for the unused sessions and publishes `package.refunded` so platform/payments
// can issue the actual Stripe refund. This module never calls Stripe directly.
export async function cancelPackage(ctx, packageId, body = {}) {
  ensureStaff(ctx, 'cancel')
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const pkg = await repo.findPurchaseById(c, ctx.appId, ctx.tenantId, packageId)
    if (!pkg) throw new NotFoundError('package')
    if (['refunded', 'cancelled'].includes(pkg.status)) {
      throw new ConflictError('package is already cancelled or refunded')
    }
    const penaltyPct = Number.isFinite(body.penaltyPct) ? Math.min(Math.max(body.penaltyPct, 0), 100) : 0
    const unused = pkg.remaining_sessions
    const grossRefund = pkg.total_sessions > 0
      ? Math.round((unused / pkg.total_sessions) * Number(pkg.price_paid_cents))
      : 0
    const refundCents = Math.round(grossRefund * (1 - penaltyPct / 100))

    const updated = await repo.setStatus(c, ctx.appId, ctx.tenantId, packageId, 'refunded')
    await repo.insertRedemption(c, ctx.appId, ctx.tenantId, {
      packageId, bookingId: null, delta: 0, reason: 'adjust',
      redeemerUserId: ctx.userId,
    })
    await publish({
      type: 'package.refunded',
      payload: {
        appId: ctx.appId, tenantId: ctx.tenantId, packageId,
        clientUserId: pkg.client_user_id,
        unusedSessions: unused, totalSessions: pkg.total_sessions,
        pricePaidCents: Number(pkg.price_paid_cents),
        refundCents, penaltyPct, currency: pkg.currency,
      },
    })
    return { ...updated, refundCents, unusedSessions: unused, penaltyPct }
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
        `SELECT package_id, client_user_id, service_id
           FROM platform_bookings.bookings
          WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
        [ctx.appId, ctx.tenantId, p.bookingId],
      )
      const booking = rows[0]
      if (!booking) return

      let packageId = booking.package_id
      // #1 FIFO fallback: if the booking isn't explicitly linked to a package
      // but its client owns an active package for the service, auto-select the
      // one expiring soonest (findActivePackageFor orders by expires_at ASC).
      if (!packageId
          && event.type === 'booking.completed'
          && booking.client_user_id && booking.service_id) {
        const pkg = await repo.findActivePackageFor(
          c, ctx.appId, ctx.tenantId, booking.client_user_id, booking.service_id,
        )
        packageId = pkg?.id
      }
      if (!packageId) return

      if (event.type === 'booking.completed') {
        // #5 Idempotencia: un booking.completed duplicado no consume dos veces.
        if (await repo.redeemExistsForBooking(c, ctx.appId, ctx.tenantId, p.bookingId)) return
        const updated = await repo.decrementSessions(c, ctx.appId, ctx.tenantId, packageId, -1)
        if (!updated) return
        await repo.insertRedemption(c, ctx.appId, ctx.tenantId, {
          packageId, bookingId: p.bookingId, delta: -1, reason: 'redeem',
          redeemerUserId: booking.client_user_id ?? null,
        })
        if (updated.status === 'exhausted') {
          await publish({
            type: 'package.exhausted',
            payload: { appId: ctx.appId, tenantId: ctx.tenantId, packageId, clientUserId: updated.client_user_id },
          })
        }
      } else if (event.type === 'booking.cancelled' || event.type === 'booking.no_show') {
        // Cancellation refund only when no_show=false, in this MVP we refund both.
        await repo.decrementSessions(c, ctx.appId, ctx.tenantId, packageId, +1)
        await repo.insertRedemption(c, ctx.appId, ctx.tenantId, {
          packageId, bookingId: p.bookingId, delta: +1, reason: 'refund',
          redeemerUserId: booking.client_user_id ?? null,
        })
      }
    })
  } catch (err) {
    logger.warn({ err, type: event.type }, 'packages event handler error')
  }
}

// Fulfillment de comercio: cuando platform/commerce confirma el pago de un bono
// (commerce.purchase.paid, kind=package), creamos la compra del bono. La
// unicidad la garantiza commerce (un único evento por checkout pagado).
export async function handleCommercePaid(event) {
  const p = event?.payload ?? {}
  if (p.kind !== 'package') return
  if (!p.appId || !p.tenantId || !p.refId) return
  const ctx = { appId: p.appId, tenantId: p.tenantId, subTenantId: p.subTenantId ?? null, userId: p.clientUserId ?? null, role: 'system' }
  try {
    await purchase(ctx, {
      templateId: p.refId,
      clientUserId: p.clientUserId ?? null,
      pricePaidCents: p.amountCents ?? null,
      metadata: { checkoutId: p.checkoutId, source: 'commerce' },
    })
    logger.info({ checkoutId: p.checkoutId, templateId: p.refId }, 'packages: bono creado desde commerce')
  } catch (err) {
    logger.warn({ err, checkoutId: p.checkoutId }, 'packages commerce fulfillment error')
  }
}

export { subscribe }
