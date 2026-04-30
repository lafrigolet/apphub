import { pool, withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import * as repo from '../repositories/delivery-dispatch.repository.js'
import { ConflictError, NotFoundError } from '../utils/errors.js'

const STATUS_TS = {
  dispatched: 'dispatched_at',
  picked_up:  'picked_up_at',
  delivered:  'delivered_at',
}
const TRANSITIONS = {
  pending:    ['dispatched','cancelled'],
  dispatched: ['picked_up','cancelled','failed'],
  picked_up:  ['delivered','failed'],
  delivered:  [],
  cancelled:  [],
  failed:     [],
}
const transitionAllowed = (f, t) => TRANSITIONS[f]?.includes(t) ?? false

export async function createZone(ctx, body) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.insertZone(client, { ...body, appId: ctx.appId, tenantId: ctx.tenantId }),
  )
}
export async function listZones(ctx) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.listZones(client, ctx.appId, ctx.tenantId),
  )
}

export async function createRider(ctx, body) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.insertRider(client, { ...body, appId: ctx.appId, tenantId: ctx.tenantId }),
  )
}
export async function listRiders(ctx, opts) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.listRiders(client, ctx.appId, ctx.tenantId, opts),
  )
}
export async function pingRiderLocation(ctx, id, body) {
  const updated = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.updateRiderLocation(client, ctx.appId, ctx.tenantId, id, body),
  )
  if (!updated) throw new NotFoundError('rider')
  return updated
}

export async function createDelivery(ctx, body) {
  const d = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.insertDelivery(client, { ...body, appId: ctx.appId, tenantId: ctx.tenantId }),
  )
  await publish({
    type: 'delivery.created',
    payload: { appId: ctx.appId, tenantId: ctx.tenantId, deliveryId: d.id, orderId: d.order_id, carrier: d.carrier },
  })
  return d
}

export async function listDeliveries(ctx, opts) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.listDeliveries(client, ctx.appId, ctx.tenantId, opts),
  )
}

export async function getDelivery(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const d = await repo.findDeliveryById(client, ctx.appId, ctx.tenantId, id)
    if (!d) throw new NotFoundError('delivery')
    const events = await repo.listDeliveryEvents(client, ctx.appId, ctx.tenantId, id)
    return { ...d, events }
  })
}

export async function assignRider(ctx, deliveryId, riderId) {
  const d = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const existing = await repo.findDeliveryById(client, ctx.appId, ctx.tenantId, deliveryId)
    if (!existing) throw new NotFoundError('delivery')
    if (existing.status !== 'pending') throw new ConflictError('delivery is not pending')
    return repo.assignRider(client, ctx.appId, ctx.tenantId, deliveryId, riderId)
  })
  await publish({
    type: 'delivery.dispatched',
    payload: { appId: ctx.appId, tenantId: ctx.tenantId, deliveryId, orderId: d.order_id, riderId, carrier: d.carrier },
  })
  return d
}

export async function changeStatus(ctx, id, toStatus, eventPayload = {}) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const d = await repo.findDeliveryById(client, ctx.appId, ctx.tenantId, id)
    if (!d) throw new NotFoundError('delivery')
    if (!transitionAllowed(d.status, toStatus)) {
      throw new ConflictError(`cannot transition delivery from ${d.status} to ${toStatus}`)
    }
    const tsCol = STATUS_TS[toStatus]
    const updated = await repo.setDeliveryStatus(client, ctx.appId, ctx.tenantId, id, toStatus, tsCol)
    await repo.insertDeliveryEvent(client, {
      appId: ctx.appId, tenantId: ctx.tenantId, deliveryId: id,
      eventType: toStatus, lat: eventPayload.lat, lng: eventPayload.lng, payload: eventPayload,
    })
    await publish({
      type: `delivery.${toStatus}`,
      payload: {
        appId: ctx.appId, tenantId: ctx.tenantId,
        deliveryId: id, orderId: d.order_id, carrier: d.carrier,
        ...eventPayload,
      },
    })
    return updated
  })
}

// React to upstream events: when an order is paid (and is delivery) create the delivery.
export async function handleEvent(event) {
  try {
    if (event.type !== 'order.paid') return
    const p = event.payload ?? {}
    if (p.fulfillmentMethod && p.fulfillmentMethod !== 'delivery') return
    if (!p.appId || !p.tenantId || !p.orderId || !p.dropAddress) return

    const ctx = { appId: p.appId, tenantId: p.tenantId, subTenantId: null, userId: null, role: 'system' }
    await createDelivery(ctx, {
      orderId:        p.orderId,
      carrier:        p.carrier ?? 'own',
      externalRef:    p.externalRef ?? null,
      zoneId:         p.zoneId ?? null,
      pickupAddress:  p.pickupAddress ?? null,
      dropAddress:    p.dropAddress,
      feeCents:       p.deliveryFeeCents ?? 0,
      estimatedMinutes: p.estimatedMinutes ?? null,
    })
  } catch (err) {
    logger.warn({ err, type: event.type }, 'delivery-dispatch event handler error')
  }
}
