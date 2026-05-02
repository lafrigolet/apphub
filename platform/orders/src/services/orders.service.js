import { pool, withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import * as repo from '../repositories/orders.repository.js'
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors.js'

// Allowed status transitions. Tighter than the universe so accidental
// PATCHes can't move backward. Includes "shortcut" transitions so a shipment
// going straight to delivered (without an intermediate shipped event) still
// advances the order — common in MVP setups without real carrier integration.
const TRANSITIONS = {
  pending:   ['paid', 'cancelled'],
  paid:      ['fulfilled', 'shipped', 'delivered', 'cancelled', 'refunded'],
  fulfilled: ['shipped', 'delivered', 'refunded'],
  shipped:   ['delivered', 'refunded'],
  delivered: ['completed', 'refunded'],
  completed: [],
  cancelled: [],
  refunded:  [],
}

function transitionAllowed(from, to) {
  return TRANSITIONS[from]?.includes(to) ?? false
}

function totals(items, taxCents = 0, shippingCents = 0) {
  const subtotalCents = items.reduce((sum, i) => sum + i.unitPriceCents * i.qty, 0)
  return { subtotalCents, taxCents, shippingCents, totalCents: subtotalCents + taxCents + shippingCents }
}

export async function createOrder(ctx, input) {
  if (!input.items?.length) throw new ValidationError('order requires at least 1 item')

  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    if (input.idempotencyKey) {
      const existing = await repo.findOrderByIdempotencyKey(client, ctx.appId, ctx.tenantId, input.idempotencyKey)
      if (existing) return loadFullOrder(client, ctx, existing.id)
    }

    const t = totals(input.items, input.taxCents, input.shippingCents)

    const order = await repo.insertOrder(client, {
      appId: ctx.appId,
      tenantId: ctx.tenantId,
      subTenantId: ctx.subTenantId,
      buyerUserId: ctx.userId,
      status: 'pending',
      currency: input.currency,
      subtotalCents: t.subtotalCents,
      taxCents: t.taxCents,
      shippingCents: t.shippingCents,
      totalCents: t.totalCents,
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata,
    })

    await repo.insertItems(client, order.id, ctx.appId, ctx.tenantId, input.items)
    if (input.shippingAddress) await repo.insertAddress(client, order.id, ctx.appId, ctx.tenantId, { kind: 'shipping', ...input.shippingAddress })
    if (input.billingAddress)  await repo.insertAddress(client, order.id, ctx.appId, ctx.tenantId, { kind: 'billing',  ...input.billingAddress  })

    await repo.recordStatusChange(client, order.id, ctx.appId, ctx.tenantId, null, 'pending', { userId: ctx.userId, role: ctx.role }, 'order created')

    await publish({
      type: 'order.created',
      payload: {
        orderId: order.id,
        appId: ctx.appId,
        tenantId: ctx.tenantId,
        buyerUserId: ctx.userId,
        items: input.items.map((i) => ({ sku: i.sku, qty: i.qty })),
        totalCents: t.totalCents,
        currency: input.currency,
      },
    })

    return loadFullOrder(client, ctx, order.id)
  })
}

async function loadFullOrder(client, ctx, orderId) {
  const order     = await repo.findOrderById(client, ctx.appId, ctx.tenantId, orderId)
  if (!order) throw new NotFoundError('order')
  const items     = await repo.findItemsByOrderId(client, ctx.appId, ctx.tenantId, orderId)
  const addresses = await repo.findAddressesByOrderId(client, ctx.appId, ctx.tenantId, orderId)
  const history   = await repo.findHistoryByOrderId(client, ctx.appId, ctx.tenantId, orderId)
  return { ...order, items, addresses, history }
}

export async function getOrder(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    loadFullOrder(client, ctx, id),
  )
}

export async function listOrders(ctx, opts) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.listOrders(client, ctx.appId, ctx.tenantId, opts),
  )
}

export async function changeStatus(ctx, id, toStatus, reason) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const order = await repo.findOrderById(client, ctx.appId, ctx.tenantId, id)
    if (!order) throw new NotFoundError('order')
    if (!transitionAllowed(order.status, toStatus)) {
      throw new ConflictError(`cannot transition from ${order.status} to ${toStatus}`)
    }
    const updated = await repo.updateStatus(client, ctx.appId, ctx.tenantId, id, toStatus)
    await repo.recordStatusChange(client, id, ctx.appId, ctx.tenantId, order.status, toStatus, { userId: ctx.userId, role: ctx.role }, reason)
    const items = await repo.findItemsByOrderId(client, ctx.appId, ctx.tenantId, id)

    // Hydrate the buyer's email so the notifications module can deliver
    // an email on transitions without doing a cross-module HTTP call. The
    // grant on platform_auth.users is added in this module's migration 0002.
    // If the lookup fails (auth not deployed, RLS, etc.) we publish anyway
    // so the order FSM doesn't depend on auth availability.
    let buyerEmail = null
    try {
      const u = await client.query(
        `SELECT email FROM platform_auth.users WHERE id = $1 LIMIT 1`,
        [order.buyer_user_id],
      )
      buyerEmail = u.rows[0]?.email ?? null
    } catch (err) {
      logger.warn({ err, userId: order.buyer_user_id }, 'orders: buyer email lookup failed')
    }

    await publish({
      type: `order.${toStatus}`,
      payload: {
        orderId: id,
        appId: ctx.appId,
        tenantId: ctx.tenantId,
        buyerUserId: order.buyer_user_id,
        buyerEmail,
        items: items.map((i) => ({ sku: i.sku, qty: i.qty })),
        totalCents: order.total_cents,
        currency: order.currency,
        reason,
      },
    })

    return updated
  })
}

export async function cancelOrder(ctx, id, reason) {
  return changeStatus(ctx, id, 'cancelled', reason)
}

export async function refundOrder(ctx, id, reason) {
  return changeStatus(ctx, id, 'refunded', reason)
}

// ── Order modifications (post-creation audit trail) ─────────────────────

const MUTABLE_STATUSES = new Set(['pending', 'paid'])

function ensureMutable(order) {
  if (!MUTABLE_STATUSES.has(order.status)) {
    throw new ConflictError(`order in status ${order.status} cannot be modified`)
  }
}

export async function listModifications(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const order = await repo.findOrderById(client, ctx.appId, ctx.tenantId, id)
    if (!order) throw new NotFoundError('order')
    return repo.listModifications(client, ctx.appId, ctx.tenantId, id)
  })
}

export async function changeShippingAddress(ctx, id, address, reason) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const order = await repo.findOrderById(client, ctx.appId, ctx.tenantId, id)
    if (!order) throw new NotFoundError('order')
    ensureMutable(order)
    const before = await repo.findShippingAddress(client, ctx.appId, ctx.tenantId, id)
    await repo.replaceShippingAddress(client, ctx.appId, ctx.tenantId, id, address)
    const mod = await repo.insertModification(client, {
      appId: ctx.appId, tenantId: ctx.tenantId, orderId: id,
      type: 'shipping_address_changed',
      before, after: address, reason,
      actorUserId: ctx.userId, actorRole: ctx.role,
    })
    await publish({
      type: 'order.modified',
      payload: {
        appId: ctx.appId, tenantId: ctx.tenantId, orderId: id,
        buyerUserId: order.buyer_user_id,
        modificationType: 'shipping_address_changed', modificationId: mod.id,
      },
    })
    return mod
  })
}

export async function addOrderNote(ctx, id, note) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const order = await repo.findOrderById(client, ctx.appId, ctx.tenantId, id)
    if (!order) throw new NotFoundError('order')
    return repo.insertModification(client, {
      appId: ctx.appId, tenantId: ctx.tenantId, orderId: id,
      type: 'note_added',
      before: null, after: { note },
      actorUserId: ctx.userId, actorRole: ctx.role,
    })
  })
}

// ── Event consumer: react to upstream events ─────────────────────────────
export async function handleEvent(event) {
  try {
    if (event.type === 'splitpay.payment.completed' && event.payload?.orderId) {
      const ctx = { appId: event.payload.appId, tenantId: event.payload.tenantId, subTenantId: null, userId: null, role: 'system' }
      await changeStatus(ctx, event.payload.orderId, 'paid', 'splitpay payment completed')
    } else if (event.type === 'shipping.shipment.delivered' && event.payload?.orderId) {
      const ctx = { appId: event.payload.appId, tenantId: event.payload.tenantId, subTenantId: null, userId: null, role: 'system' }
      await changeStatus(ctx, event.payload.orderId, 'delivered', 'shipment delivered')
    }
  } catch (err) {
    logger.warn({ err, type: event.type }, 'orders event handler error')
  }
}
