import { pool, withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import * as repo from '../repositories/shipping.repository.js'
import { NotFoundError } from '../utils/errors.js'

// ── zones / rates ─────────────────────────────────────────────────────────
export async function listZones(ctx) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.listZones(c, ctx.appId, ctx.tenantId),
  )
}
export async function createZone(ctx, input) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.insertZone(c, ctx.appId, ctx.tenantId, input),
  )
}
export async function listRates(ctx, zoneId) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.listRates(c, ctx.appId, ctx.tenantId, zoneId),
  )
}
export async function createRate(ctx, input) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.insertRate(c, ctx.appId, ctx.tenantId, input),
  )
}

// ── quote ─────────────────────────────────────────────────────────────────
export async function quote(ctx, { country }) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.findRatesForCountry(c, ctx.appId, ctx.tenantId, country),
  )
}

// ── shipments ─────────────────────────────────────────────────────────────
export async function createShipment(ctx, input) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const shipment = await repo.insertShipment(c, ctx.appId, ctx.tenantId, input)
    await publish({
      type: 'shipping.shipment.created',
      payload: { shipmentId: shipment.id, orderId: shipment.order_id, appId: ctx.appId, tenantId: ctx.tenantId },
    })
    return shipment
  })
}

export async function getShipment(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const shipment = await repo.findShipmentById(c, ctx.appId, ctx.tenantId, id)
    if (!shipment) throw new NotFoundError('shipment')
    const events = await repo.listShipmentEvents(c, ctx.appId, ctx.tenantId, id)
    return { ...shipment, events }
  })
}

export async function appendEvent(ctx, shipmentId, ev) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const shipment = await repo.findShipmentById(c, ctx.appId, ctx.tenantId, shipmentId)
    if (!shipment) throw new NotFoundError('shipment')
    const event = await repo.insertShipmentEvent(c, ctx.appId, ctx.tenantId, shipmentId, ev)

    // Map well-known codes to status transitions + outbound platform events.
    const code = (ev.code ?? '').toLowerCase()
    let updated = shipment
    if (code === 'shipped' || code === 'in_transit') {
      updated = await repo.updateShipmentStatus(c, ctx.appId, ctx.tenantId, shipmentId, 'in_transit', { shippedAt: new Date() })
      await publish({ type: 'shipping.shipment.shipped',   payload: { shipmentId, orderId: shipment.order_id, appId: ctx.appId, tenantId: ctx.tenantId } })
    } else if (code === 'delivered') {
      updated = await repo.updateShipmentStatus(c, ctx.appId, ctx.tenantId, shipmentId, 'delivered', { deliveredAt: new Date() })
      await publish({ type: 'shipping.shipment.delivered', payload: { shipmentId, orderId: shipment.order_id, appId: ctx.appId, tenantId: ctx.tenantId } })
    } else if (code === 'returned') {
      updated = await repo.updateShipmentStatus(c, ctx.appId, ctx.tenantId, shipmentId, 'returned')
    }
    return { shipment: updated, event }
  })
}

// ── event consumer ────────────────────────────────────────────────────────
export async function handleEvent(event) {
  try {
    if (event.type === 'order.paid' && event.payload?.orderId) {
      const ctx = { appId: event.payload.appId, tenantId: event.payload.tenantId, subTenantId: null, userId: null }
      await createShipment(ctx, { orderId: event.payload.orderId, status: 'pending' })
    }
  } catch (err) {
    logger.warn({ err, type: event.type }, 'shipping event handler error')
  }
}
