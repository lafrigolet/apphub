// Returns / RMA service. Owns the FSM and emits platform events for every
// transition so other modules can react:
//   inventory  → consumes return.restocked   to bump qty_on_hand
//   splitpay   → consumes return.refund.requested to issue a Stripe refund
//   notifications → confirmations / status updates to the buyer
//
// Status FSM:
//   requested → approved   → label_issued → shipped → received → restocked → refunded
//             ↘ rejected
//             ↘ cancelled (also from approved)
import { pool, withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/returns.repository.js'
import { ConflictError, NotFoundError, ValidationError, ForbiddenError } from '../utils/errors.js'

const TRANSITIONS = {
  requested:    ['approved', 'rejected', 'cancelled'],
  approved:     ['label_issued', 'cancelled'],
  rejected:     [],
  label_issued: ['shipped'],
  shipped:      ['received'],
  received:     ['restocked', 'refunded'],
  restocked:    ['refunded'],
  refunded:     [],
  cancelled:    [],
}

function transitionAllowed(from, to) {
  return TRANSITIONS[from]?.includes(to) ?? false
}

function isStaff(role) { return ['staff', 'super_admin', 'owner', 'admin'].includes(role) }

async function loadFull(client, appId, tenantId, id) {
  const ret = await repo.findReturnById(client, appId, tenantId, id)
  if (!ret) throw new NotFoundError('return')
  const items = await repo.listReturnItems(client, appId, tenantId, id)
  return { ...ret, items }
}

export async function createReturn(ctx, body) {
  if (!body.items?.length) throw new ValidationError('return requires at least 1 item')
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const ret = await repo.insertReturn(c, ctx.appId, ctx.tenantId, {
      orderId:      body.orderId,
      buyerUserId:  ctx.userId,
      status:       'requested',
      reason:       body.reason,
    })
    for (const it of body.items) {
      await repo.insertReturnItem(c, ctx.appId, ctx.tenantId, ret.id, it)
    }
    await publish({
      type: 'return.requested',
      payload: {
        appId: ctx.appId, tenantId: ctx.tenantId,
        returnId: ret.id, orderId: ret.order_id, buyerUserId: ret.buyer_user_id,
      },
    })
    return loadFull(c, ctx.appId, ctx.tenantId, ret.id)
  })
}

export async function listReturns(ctx, opts) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.listReturns(c, ctx.appId, ctx.tenantId, opts),
  )
}

export async function getReturn(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    loadFull(c, ctx.appId, ctx.tenantId, id),
  )
}

async function transition(ctx, id, toStatus, fields = {}, eventPayloadExtra = {}) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const ret = await repo.findReturnById(c, ctx.appId, ctx.tenantId, id)
    if (!ret) throw new NotFoundError('return')
    if (!transitionAllowed(ret.status, toStatus)) {
      throw new ConflictError(`cannot transition return from ${ret.status} to ${toStatus}`)
    }
    const updated = await repo.updateReturn(c, ctx.appId, ctx.tenantId, id, { status: toStatus, ...fields })
    await publish({
      type: `return.${toStatus}`,
      payload: {
        appId: ctx.appId, tenantId: ctx.tenantId,
        returnId: id, orderId: ret.order_id, buyerUserId: ret.buyer_user_id,
        ...eventPayloadExtra,
      },
    })
    return loadFull(c, ctx.appId, ctx.tenantId, id)
  })
}

export async function approveReturn(ctx, id, decisionNotes) {
  if (!isStaff(ctx.role)) throw new ForbiddenError('only staff/admin can approve returns')
  return transition(ctx, id, 'approved', { approvedAt: new Date(), decisionNotes })
}

export async function rejectReturn(ctx, id, decisionNotes) {
  if (!isStaff(ctx.role)) throw new ForbiddenError('only staff/admin can reject returns')
  return transition(ctx, id, 'rejected', { rejectedAt: new Date(), decisionNotes })
}

export async function cancelReturn(ctx, id, reason) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const ret = await repo.findReturnById(c, ctx.appId, ctx.tenantId, id)
    if (!ret) throw new NotFoundError('return')
    if (ret.buyer_user_id !== ctx.userId && !isStaff(ctx.role)) {
      throw new ForbiddenError('only the buyer or staff can cancel a return')
    }
    if (!transitionAllowed(ret.status, 'cancelled')) {
      throw new ConflictError(`cannot cancel a return in status ${ret.status}`)
    }
    await repo.updateReturn(c, ctx.appId, ctx.tenantId, id, {
      status: 'cancelled', cancelledAt: new Date(), decisionNotes: reason,
    })
    await publish({
      type: 'return.cancelled',
      payload: { appId: ctx.appId, tenantId: ctx.tenantId, returnId: id, orderId: ret.order_id },
    })
    return loadFull(c, ctx.appId, ctx.tenantId, id)
  })
}

export async function issueReturnLabel(ctx, id, { carrier, trackingCode, inboundShipmentId } = {}) {
  if (!isStaff(ctx.role)) throw new ForbiddenError('only staff/admin can issue return labels')
  return transition(ctx, id, 'label_issued',
    { carrier, trackingCode, inboundShipmentId },
    { carrier, trackingCode },
  )
}

export async function markShipped(ctx, id, trackingCode) {
  return transition(ctx, id, 'shipped', { shippedAt: new Date(), trackingCode }, { trackingCode })
}

export async function receiveReturn(ctx, id, { items = [] } = {}) {
  if (!isStaff(ctx.role)) throw new ForbiddenError('only staff/warehouse can record receipt')
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const ret = await repo.findReturnById(c, ctx.appId, ctx.tenantId, id)
    if (!ret) throw new NotFoundError('return')
    if (!transitionAllowed(ret.status, 'received')) {
      throw new ConflictError(`cannot mark received from ${ret.status}`)
    }
    for (const li of items) {
      const existing = await repo.findReturnItemById(c, ctx.appId, ctx.tenantId, li.id)
      if (!existing) throw new NotFoundError(`return item ${li.id}`)
      if (existing.return_id !== id) throw new ValidationError('return item belongs to a different return')
      const qty = li.qtyReceived ?? existing.qty
      if (qty > existing.qty) throw new ValidationError(`qtyReceived (${qty}) > requested qty (${existing.qty})`)
      await repo.setReturnItemReceived(c, ctx.appId, ctx.tenantId, li.id, qty, li.condition)
    }
    const updated = await repo.updateReturn(c, ctx.appId, ctx.tenantId, id, {
      status: 'received', receivedAt: new Date(),
    })
    const allItems = await repo.listReturnItems(c, ctx.appId, ctx.tenantId, id)
    await publish({
      type: 'return.received',
      payload: {
        appId: ctx.appId, tenantId: ctx.tenantId, returnId: id, orderId: ret.order_id,
        items: allItems.map((i) => ({ sku: i.sku, qtyReceived: i.qty_received, condition: i.condition })),
      },
    })
    return loadFull(c, ctx.appId, ctx.tenantId, id)
  })
}

export async function restockReturn(ctx, id) {
  if (!isStaff(ctx.role)) throw new ForbiddenError('only staff/admin can restock returns')
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const ret = await repo.findReturnById(c, ctx.appId, ctx.tenantId, id)
    if (!ret) throw new NotFoundError('return')
    if (!transitionAllowed(ret.status, 'restocked')) {
      throw new ConflictError(`cannot restock from ${ret.status}`)
    }
    const items = await repo.listReturnItems(c, ctx.appId, ctx.tenantId, id)

    // Only items received in 'new' or 'open_box' condition flow back to
    // sellable stock. damaged/used/missing rows stay on the return for
    // reporting but inventory ignores them.
    const restockable = items.filter((i) => i.qty_received > 0 && ['new', 'open_box'].includes(i.condition ?? ''))

    await repo.updateReturn(c, ctx.appId, ctx.tenantId, id, {
      status: 'restocked', restockedAt: new Date(),
    })
    await publish({
      type: 'return.restocked',
      payload: {
        appId: ctx.appId, tenantId: ctx.tenantId, returnId: id, orderId: ret.order_id,
        items: restockable.map((i) => ({ sku: i.sku, qty: i.qty_received })),
      },
    })
    // Also publish per-SKU inventory.restock.requested so the inventory
    // module can react without parsing the return aggregate.
    for (const i of restockable) {
      await publish({
        type: 'inventory.restock.requested',
        payload: {
          appId: ctx.appId, tenantId: ctx.tenantId,
          sku: i.sku, qty: i.qty_received,
          source: 'return', returnId: id, orderId: ret.order_id,
        },
      })
    }
    return loadFull(c, ctx.appId, ctx.tenantId, id)
  })
}

export async function refundReturn(ctx, id, { amountCents, currency } = {}) {
  if (!isStaff(ctx.role)) throw new ForbiddenError('only staff/admin can issue refunds')
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const ret = await repo.findReturnById(c, ctx.appId, ctx.tenantId, id)
    if (!ret) throw new NotFoundError('return')
    if (!transitionAllowed(ret.status, 'refunded')) {
      throw new ConflictError(`cannot refund a return in status ${ret.status}`)
    }
    if (!(amountCents > 0)) throw new ValidationError('amountCents > 0 required')
    await repo.updateReturn(c, ctx.appId, ctx.tenantId, id, {
      status: 'refunded',
      refundedAt: new Date(),
      refundAmountCents: amountCents,
      refundCurrency: currency ?? null,
    })
    // splitpay listens for return.refund.requested to issue the Stripe refund.
    await publish({
      type: 'return.refund.requested',
      payload: {
        appId: ctx.appId, tenantId: ctx.tenantId,
        returnId: id, orderId: ret.order_id,
        amountCents, currency: currency ?? null,
        requestedByUserId: ctx.userId,
      },
    })
    await publish({
      type: 'return.refunded',
      payload: { appId: ctx.appId, tenantId: ctx.tenantId, returnId: id, orderId: ret.order_id, amountCents },
    })
    return loadFull(c, ctx.appId, ctx.tenantId, id)
  })
}
