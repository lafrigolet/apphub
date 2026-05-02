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
