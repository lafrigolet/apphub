import { pool, withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import * as repo from '../repositories/delivery-dispatch.repository.js'
import * as settingsRepo from '../repositories/settings.repository.js'
import * as carriers from './carriers.js'
import { haversineKm, pointInPolygon, polygonCentroid } from '../utils/geo.js'
import { ConflictError, NotFoundError, ValidationError, UnauthorizedError } from '../utils/errors.js'

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

export async function updateZone(ctx, id, patch) {
  const z = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const existing = await repo.findZoneById(client, ctx.appId, ctx.tenantId, id)
    if (!existing) throw new NotFoundError('zone')
    return repo.updateZone(client, ctx.appId, ctx.tenantId, id, patch)
  })
  return z
}

export async function deleteZone(ctx, id) {
  const deleted = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.deleteZone(client, ctx.appId, ctx.tenantId, id),
  )
  if (!deleted) throw new NotFoundError('zone')
  return { id: deleted.id, deleted: true }
}

// Quote a delivery fee for a drop point. Resolves the active zone that contains
// the point (point-in-polygon), then computes base_fee + per_km * distance.
// Distance is estimated from the drop point to the zone polygon centroid.
export async function quote(ctx, { lat, lng, orderTotalCents }) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const zones = await repo.listActiveZones(client, ctx.appId, ctx.tenantId)
    const point = { lat, lng }
    const zone = zones.find((z) => pointInPolygon(point, z.polygon))
    if (!zone) {
      return { deliverable: false, reason: 'OUT_OF_ZONE', zoneId: null, feeCents: null, distanceKm: null }
    }
    const centroid = polygonCentroid(zone.polygon)
    const distanceKm = centroid ? Number(haversineKm(point, centroid).toFixed(3)) : 0
    const baseFee = Number(zone.base_fee_cents)
    const perKm = Number(zone.per_km_cents)
    const minOrder = Number(zone.min_order_cents)
    const feeCents = Math.round(baseFee + perKm * distanceKm)
    const belowMinimum =
      orderTotalCents != null && minOrder > 0 && orderTotalCents < minOrder
    return {
      deliverable: !belowMinimum,
      reason: belowMinimum ? 'BELOW_MIN_ORDER' : null,
      zoneId: zone.id,
      zoneName: zone.name,
      feeCents,
      baseFeeCents: baseFee,
      perKmCents: perKm,
      distanceKm,
      minOrderCents: minOrder,
    }
  })
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

export async function updateRider(ctx, id, patch) {
  const updated = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const existing = await repo.findRiderById(client, ctx.appId, ctx.tenantId, id)
    if (!existing) throw new NotFoundError('rider')
    if (existing.deleted_at) throw new ConflictError('rider is deactivated')
    return repo.updateRider(client, ctx.appId, ctx.tenantId, id, patch)
  })
  return updated
}

export async function deactivateRider(ctx, id, reason) {
  const deleted = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.softDeleteRider(client, ctx.appId, ctx.tenantId, id, reason),
  )
  if (!deleted) throw new NotFoundError('rider')
  return deleted
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

// ── Inbound aggregator webhook ─────────────────────────────────────────────
// A provider (Uber/Glovo/Stuart) posts a status update for an external order.
// We verify the HMAC signature with the stored webhook secret, locate our
// internal delivery by (carrier, external_ref), map the provider status onto
// our FSM, and auto-transition. Verification reads the platform-wide settings
// table (no RLS); the transition runs in a tenant transaction.
async function readWebhookSecret(provider) {
  const client = await pool.connect()
  try {
    return await settingsRepo.getValue(client, carriers.webhookSecretKey(provider))
  } finally {
    client.release()
  }
}

export async function handleCarrierWebhook(provider, { rawBody, signature, body }) {
  if (!carriers.isProvider(provider)) throw new NotFoundError('provider')

  const secret = await readWebhookSecret(provider)
  if (!secret) throw new UnauthorizedError('webhook secret not configured')
  if (!carriers.verifyWebhookSignature(secret, rawBody, signature)) {
    throw new UnauthorizedError('invalid webhook signature')
  }

  const p = body ?? {}
  const appId = p.appId
  const tenantId = p.tenantId
  const externalRef = p.externalRef ?? p.external_ref ?? p.orderId ?? p.id
  const externalStatus = p.status ?? p.event ?? p.state
  if (!appId || !tenantId || !externalRef) {
    throw new ValidationError('appId, tenantId and externalRef are required')
  }

  const toStatus = carriers.mapCarrierStatus(provider, externalStatus)
  if (!toStatus) {
    return { matched: false, ignored: true, externalStatus }
  }

  const result = await withTenantTransaction(pool, appId, tenantId, null, async (client) => {
    const d = await repo.findDeliveryByExternalRef(client, appId, tenantId, provider, externalRef)
    if (!d) return { matched: false }
    if (d.status === toStatus) return { matched: true, delivery: d, transitioned: false }
    if (!transitionAllowed(d.status, toStatus)) {
      return { matched: true, delivery: d, transitioned: false, illegal: { from: d.status, to: toStatus } }
    }
    const tsCol = STATUS_TS[toStatus]
    const updated = await repo.setDeliveryStatus(client, appId, tenantId, d.id, toStatus, tsCol)
    await repo.insertDeliveryEvent(client, {
      appId, tenantId, deliveryId: d.id,
      eventType: toStatus, lat: p.lat, lng: p.lng,
      payload: { source: 'carrier_webhook', provider, externalStatus },
    })
    return { matched: true, delivery: updated, transitioned: true, toStatus }
  })

  if (result.transitioned) {
    await publish({
      type: `delivery.${result.toStatus}`,
      payload: {
        appId, tenantId,
        deliveryId: result.delivery.id, orderId: result.delivery.order_id, carrier: provider,
        source: 'carrier_webhook',
      },
    })
  }
  logger.info({ provider, externalRef, externalStatus, result: { matched: result.matched, transitioned: result.transitioned } }, 'carrier webhook handled')
  return result
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
