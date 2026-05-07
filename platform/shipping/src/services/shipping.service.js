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

// ── multi-package shipments ─────────────────────────────────────────────

export async function listPackages(ctx, shipmentId) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const shipment = await repo.findShipmentById(c, ctx.appId, ctx.tenantId, shipmentId)
    if (!shipment) throw new NotFoundError('shipment')
    return repo.listPackages(c, ctx.appId, ctx.tenantId, shipmentId)
  })
}

export async function addPackage(ctx, shipmentId, body) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const shipment = await repo.findShipmentById(c, ctx.appId, ctx.tenantId, shipmentId)
    if (!shipment) throw new NotFoundError('shipment')
    const packageNumber = body.packageNumber ?? await repo.nextPackageNumber(c, ctx.appId, ctx.tenantId, shipmentId)
    const pkg = await repo.insertPackage(c, ctx.appId, ctx.tenantId, shipmentId, { ...body, packageNumber })
    await publish({
      type: 'shipping.package.created',
      payload: { appId: ctx.appId, tenantId: ctx.tenantId, shipmentId, packageId: pkg.id, packageNumber },
    })
    return pkg
  })
}

// ── carrier webhook ingest (idempotent) ─────────────────────────────────
//
// Validation policy:
//   * UPS         — HMAC-SHA256 over body with the 'webhook secret' from settings.
//   * FedEx       — Bearer token in 'Authorization' header matched against fedex_secret_key.
//   * DHL         — HMAC-SHA1 in 'X-DHL-Signature' header.
//   * EasyPost    — HMAC-SHA256 (hex) in 'X-Hmac-Signature' against easypost_webhook_secret.
//
// We don't enforce all four here — only EasyPost (the most common multi-
// carrier aggregator) is implemented end-to-end. Other carriers receive
// the payload, persist it, and mark signature_valid=null until staff
// configures + we add the matching verifier. This keeps the receiver
// useful for visibility before every variant is wired.
import crypto from 'node:crypto'
import * as configRepo from '../repositories/settings.repository.js'

function verifyHmacSha256(secret, body, signatureHex) {
  if (!secret || !signatureHex) return false
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signatureHex, 'hex'))
  } catch { return false }
}

async function loadCarrierSecret(carrier) {
  const client = await pool.connect()
  try {
    if (carrier === 'easypost') return configRepo.getValue(client, 'easypost_webhook_secret')
    return null
  } finally { client.release() }
}

export async function ingestCarrierWebhook(carrier, { rawBody, payload, signatureHeader }) {
  // 1. Verify (where supported).
  let signatureValid = null
  if (carrier === 'easypost') {
    const secret = await loadCarrierSecret(carrier)
    signatureValid = verifyHmacSha256(secret, rawBody, signatureHeader)
  }

  // 2. Extract carrier-specific anchors. EasyPost calls these
  //    'tracker.tracking_code' / 'result.status'; we keep this minimal so the
  //    receiver works for any payload shape.
  const trackingCode    = payload?.tracker?.tracking_code ?? payload?.tracking_code ?? null
  const eventExternalId = payload?.id ?? payload?.event_id ?? null

  // 3. Persist (idempotent on (carrier, event_external_id)).
  const client = await pool.connect()
  try {
    let shipmentId = null
    let packageId  = null
    let appId = null, tenantId = null
    if (trackingCode) {
      // Look up across tenants (BYPASSRLS is not granted here, so we use
      // a direct query that ignores RLS via current_setting being unset —
      // the unique-tracking index makes this O(1)). Falls back to null
      // when the tracking code has never been registered.
      const { rows } = await client.query(
        `SELECT app_id, tenant_id, id, shipment_id
           FROM platform_shipping.shipment_packages
          WHERE tracking_code = $1 LIMIT 1`,
        [trackingCode],
      )
      if (rows[0]) {
        appId = rows[0].app_id
        tenantId = rows[0].tenant_id
        packageId = rows[0].id
        shipmentId = rows[0].shipment_id
      }
    }
    const inserted = await repo.insertWebhookEvent(client, {
      appId, tenantId, carrier, eventExternalId, shipmentId, packageId,
      payload, signatureValid,
    })
    if (!inserted) return { duplicate: true }

    // 4. If we resolved the package, transition the shipment status when
    //    the carrier reports a terminal state.
    const status = (payload?.status ?? payload?.result?.status ?? '').toLowerCase()
    if (shipmentId && appId && tenantId) {
      try {
        await withTenantTransaction(pool, appId, tenantId, null, async (tc) => {
          if (status === 'in_transit' || status === 'delivered' || status === 'returned') {
            await repo.updateShipmentStatus(tc, appId, tenantId, shipmentId, status, {
              shippedAt:   status === 'in_transit' ? new Date() : undefined,
              deliveredAt: status === 'delivered'  ? new Date() : undefined,
            })
            if (packageId) {
              await repo.updatePackageStatus(tc, appId, tenantId, packageId, status, {
                shippedAt:   status === 'in_transit' ? new Date() : undefined,
                deliveredAt: status === 'delivered'  ? new Date() : undefined,
              })
            }
            await repo.insertShipmentEvent(tc, appId, tenantId, shipmentId, {
              code: status, description: payload?.message ?? null, location: null,
            })
          }
        })
      } catch (err) {
        logger.warn({ err, shipmentId }, 'webhook downstream apply failed')
      }
    }
    await repo.markWebhookProcessed(client, inserted.id)
    return { id: inserted.id, signatureValid }
  } finally { client.release() }
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
