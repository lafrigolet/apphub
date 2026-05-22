// delivery-dispatch — pingRiderLocation + changeStatus FSM + GPS coords en eventos.
// Contrato:
//   - pingRiderLocation: rider inexistente → NotFoundError; happy path actualiza lat/lng.
//   - GPS coords son numéricos puros (no nombres, no teléfono — anti-PII en payloads).
//   - assignRider: solo desde 'pending'; en otro estado → 409.
//     Publish 'delivery.dispatched' con orderId + riderId + carrier.
//   - changeStatus FSM:
//       pending    → dispatched | cancelled
//       dispatched → picked_up | cancelled | failed
//       picked_up  → delivered | failed
//       delivered/cancelled/failed → terminales.
//     Stamp timestamp column según STATUS_TS map.
//     Publish 'delivery.<status>' con eventPayload merged (lat/lng GPS).
//   - handleEvent: solo procesa order.paid con fulfillmentMethod='delivery' (o ausente).

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTenantTransaction: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn() }))
vi.mock('../repositories/delivery-dispatch.repository.js')

import {
  pingRiderLocation, assignRider, changeStatus, handleEvent, createDelivery,
} from '../services/delivery-dispatch.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/delivery-dispatch.repository.js'

const ctx = {
  appId: 'demo-restaurant', tenantId: 't1', subTenantId: null, userId: 'dispatcher-1',
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn({}))
})

// ── pingRiderLocation (GPS) ──────────────────────────────────────────

describe('pingRiderLocation', () => {
  it('happy: actualiza lat/lng + retorna rider', async () => {
    repo.updateRiderLocation.mockResolvedValue({ id: 'r1', lat: 40.4168, lng: -3.7038 })
    const r = await pingRiderLocation(ctx, 'r1', { lat: 40.4168, lng: -3.7038 })
    expect(repo.updateRiderLocation).toHaveBeenCalledWith(
      expect.anything(), ctx.appId, ctx.tenantId, 'r1', { lat: 40.4168, lng: -3.7038 },
    )
    expect(r.lat).toBe(40.4168)
  })

  it('rider inexistente → NotFoundError 404', async () => {
    repo.updateRiderLocation.mockResolvedValue(null)
    await expect(pingRiderLocation(ctx, 'ghost', { lat: 0, lng: 0 })).rejects.toMatchObject({ statusCode: 404 })
  })
})

// ── assignRider ──────────────────────────────────────────────────────

describe('assignRider', () => {
  it('happy: pending → dispatched (vía repo.assignRider) + publish delivery.dispatched', async () => {
    repo.findDeliveryById.mockResolvedValue({ id: 'd1', status: 'pending', order_id: 'ord-1', carrier: 'own' })
    repo.assignRider.mockResolvedValue({ id: 'd1', status: 'dispatched', order_id: 'ord-1', carrier: 'own' })
    await assignRider(ctx, 'd1', 'r1')
    expect(publish).toHaveBeenCalledWith({
      type: 'delivery.dispatched',
      payload: {
        appId: ctx.appId, tenantId: ctx.tenantId,
        deliveryId: 'd1', orderId: 'ord-1', riderId: 'r1', carrier: 'own',
      },
    })
  })

  it('delivery NO pending (e.g. picked_up) → ConflictError 409', async () => {
    repo.findDeliveryById.mockResolvedValue({ id: 'd1', status: 'picked_up' })
    await expect(assignRider(ctx, 'd1', 'r1')).rejects.toMatchObject({
      statusCode: 409, message: expect.stringContaining('not pending'),
    })
    expect(repo.assignRider).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('delivery inexistente → NotFoundError', async () => {
    repo.findDeliveryById.mockResolvedValue(null)
    await expect(assignRider(ctx, 'ghost', 'r1')).rejects.toMatchObject({ statusCode: 404 })
  })
})

// ── changeStatus FSM ────────────────────────────────────────────────

describe('changeStatus FSM — transiciones válidas', () => {
  it.each([
    ['pending',    'dispatched', 'dispatched_at'],
    ['pending',    'cancelled',  undefined],
    ['dispatched', 'picked_up',  'picked_up_at'],
    ['dispatched', 'cancelled',  undefined],
    ['dispatched', 'failed',     undefined],
    ['picked_up',  'delivered',  'delivered_at'],
    ['picked_up',  'failed',     undefined],
  ])('%s → %s stamp col=%s', async (from, to, expectedTsCol) => {
    repo.findDeliveryById.mockResolvedValue({ id: 'd1', status: from, order_id: 'ord-1', carrier: 'own' })
    repo.setDeliveryStatus.mockResolvedValue({ id: 'd1', status: to })
    await changeStatus(ctx, 'd1', to)
    expect(repo.setDeliveryStatus).toHaveBeenCalledWith(
      expect.anything(), ctx.appId, ctx.tenantId, 'd1', to, expectedTsCol,
    )
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: `delivery.${to}` }))
  })
})

describe('changeStatus FSM — transiciones inválidas', () => {
  it.each([
    ['pending',   'picked_up'],   // skip dispatched
    ['pending',   'delivered'],
    ['dispatched','delivered'],   // skip picked_up
    ['picked_up', 'cancelled'],   // demasiado tarde
    ['picked_up', 'dispatched'],  // back-transition
    ['delivered', 'failed'],      // terminal
    ['cancelled', 'dispatched'],
    ['failed',    'picked_up'],
  ])('%s → %s → 409', async (from, to) => {
    repo.findDeliveryById.mockResolvedValue({ id: 'd1', status: from })
    await expect(changeStatus(ctx, 'd1', to)).rejects.toMatchObject({ statusCode: 409 })
    expect(publish).not.toHaveBeenCalled()
  })
})

// ── GPS coords en eventos ───────────────────────────────────────────

describe('GPS coords payload', () => {
  it('changeStatus con lat/lng → graba evento con coords + publish con coords', async () => {
    repo.findDeliveryById.mockResolvedValue({ id: 'd1', status: 'dispatched', order_id: 'ord-1', carrier: 'own' })
    repo.setDeliveryStatus.mockResolvedValue({ id: 'd1', status: 'picked_up' })
    await changeStatus(ctx, 'd1', 'picked_up', { lat: 40.4168, lng: -3.7038 })

    expect(repo.insertDeliveryEvent).toHaveBeenCalledWith(expect.anything(), {
      appId: ctx.appId, tenantId: ctx.tenantId, deliveryId: 'd1',
      eventType: 'picked_up',
      lat: 40.4168, lng: -3.7038,
      payload: { lat: 40.4168, lng: -3.7038 },
    })

    expect(publish).toHaveBeenCalledWith({
      type: 'delivery.picked_up',
      payload: expect.objectContaining({ lat: 40.4168, lng: -3.7038 }),
    })
  })

  it('payload publicado NO incluye datos de rider/customer (anti-PII)', async () => {
    repo.findDeliveryById.mockResolvedValue({
      id: 'd1', status: 'dispatched', order_id: 'ord-1', carrier: 'own',
      rider_phone: '+34600000', customer_email: 'priv@x.com',
    })
    repo.setDeliveryStatus.mockResolvedValue({ id: 'd1', status: 'picked_up' })
    await changeStatus(ctx, 'd1', 'picked_up', { lat: 40, lng: -3 })

    const publishedPayload = publish.mock.calls[0][0].payload
    expect(publishedPayload).not.toHaveProperty('rider_phone')
    expect(publishedPayload).not.toHaveProperty('customer_email')
  })
})

// ── handleEvent (order.paid → createDelivery) ───────────────────────

describe('handleEvent', () => {
  it('ignora eventos != order.paid', async () => {
    await handleEvent({ type: 'order.created', payload: {} })
    expect(repo.insertDelivery).not.toHaveBeenCalled()
  })

  it('order.paid con fulfillmentMethod="pickup" → ignora', async () => {
    await handleEvent({
      type: 'order.paid',
      payload: {
        appId: 'a', tenantId: 't', orderId: 'o',
        fulfillmentMethod: 'pickup', dropAddress: 'X',
      },
    })
    expect(repo.insertDelivery).not.toHaveBeenCalled()
  })

  it('order.paid SIN dropAddress → ignora (no delivery sin destino)', async () => {
    await handleEvent({
      type: 'order.paid',
      payload: { appId: 'a', tenantId: 't', orderId: 'o', fulfillmentMethod: 'delivery' },
    })
    expect(repo.insertDelivery).not.toHaveBeenCalled()
  })

  it('order.paid happy → createDelivery con carrier default "own"', async () => {
    repo.insertDelivery.mockResolvedValue({ id: 'd1', order_id: 'o', carrier: 'own' })
    await handleEvent({
      type: 'order.paid',
      payload: {
        appId: 'a', tenantId: 't', orderId: 'o',
        fulfillmentMethod: 'delivery', dropAddress: 'Calle X 1',
      },
    })
    expect(repo.insertDelivery).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      orderId: 'o', carrier: 'own', dropAddress: 'Calle X 1',
    }))
  })

  it('errores en createDelivery se loguean pero NO crashean el handler', async () => {
    repo.insertDelivery.mockRejectedValue(new Error('boom'))
    await expect(handleEvent({
      type: 'order.paid',
      payload: { appId: 'a', tenantId: 't', orderId: 'o', dropAddress: 'X' },
    })).resolves.toBeUndefined()
  })
})
