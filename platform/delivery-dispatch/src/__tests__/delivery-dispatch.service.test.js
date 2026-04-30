import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn() },
  withTenantTransaction: vi.fn(),
}))
vi.mock('../lib/redis.js', () => ({
  publish: vi.fn(),
}))
vi.mock('../repositories/delivery-dispatch.repository.js')

import * as service from '../services/delivery-dispatch.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/delivery-dispatch.repository.js'
import { ConflictError, NotFoundError } from '@apphub/platform-sdk/errors'

const APP_ID    = 'yoga-studio'
const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const DEL_ID    = '11111111-1111-1111-1111-111111111111'
const RIDER_ID  = '22222222-2222-2222-2222-222222222222'
const ORDER_ID  = '33333333-3333-3333-3333-333333333333'

const ctx = { appId: APP_ID, tenantId: TENANT_ID, subTenantId: null, userId: 'u1', role: 'dispatcher' }

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
})

// ── zones / riders ──────────────────────────────────────────────────────
describe('zones / riders', () => {
  it('createZone scopes to tenant', async () => {
    repo.insertZone.mockResolvedValue({ id: 'z1' })
    await service.createZone(ctx, { name: 'Centro', polygon: { type: 'Polygon' } })
    expect(repo.insertZone).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      appId: APP_ID, tenantId: TENANT_ID, name: 'Centro',
    }))
  })

  it('createRider scopes to tenant', async () => {
    repo.insertRider.mockResolvedValue({ id: RIDER_ID })
    await service.createRider(ctx, { displayName: 'Ana', vehicle: 'bike' })
    expect(repo.insertRider).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      appId: APP_ID, tenantId: TENANT_ID, displayName: 'Ana', vehicle: 'bike',
    }))
  })

  it('pingRiderLocation throws NotFoundError when rider missing', async () => {
    repo.updateRiderLocation.mockResolvedValue(null)
    await expect(service.pingRiderLocation(ctx, RIDER_ID, { lat: 1, lng: 2 })).rejects.toThrow(NotFoundError)
  })

  it('pingRiderLocation returns updated rider', async () => {
    repo.updateRiderLocation.mockResolvedValue({ id: RIDER_ID, last_lat: 1, last_lng: 2 })
    const result = await service.pingRiderLocation(ctx, RIDER_ID, { lat: 1, lng: 2, status: 'available' })
    expect(repo.updateRiderLocation).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, RIDER_ID, { lat: 1, lng: 2, status: 'available' })
    expect(result.last_lat).toBe(1)
  })
})

// ── createDelivery ──────────────────────────────────────────────────────
describe('createDelivery', () => {
  it('persists, scopes, emits delivery.created', async () => {
    repo.insertDelivery.mockResolvedValue({ id: DEL_ID, order_id: ORDER_ID, carrier: 'own' })
    await service.createDelivery(ctx, { orderId: ORDER_ID, dropAddress: { line1: 'Calle 1' } })
    expect(repo.insertDelivery).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      appId: APP_ID, tenantId: TENANT_ID, orderId: ORDER_ID,
    }))
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'delivery.created',
      payload: expect.objectContaining({ deliveryId: DEL_ID, orderId: ORDER_ID, carrier: 'own' }),
    }))
  })
})

// ── getDelivery ─────────────────────────────────────────────────────────
describe('getDelivery', () => {
  it('returns delivery with events', async () => {
    repo.findDeliveryById.mockResolvedValue({ id: DEL_ID })
    repo.listDeliveryEvents.mockResolvedValue([{ event_type: 'dispatched' }])
    const result = await service.getDelivery(ctx, DEL_ID)
    expect(result).toEqual({ id: DEL_ID, events: [{ event_type: 'dispatched' }] })
  })

  it('throws NotFoundError when missing', async () => {
    repo.findDeliveryById.mockResolvedValue(null)
    await expect(service.getDelivery(ctx, DEL_ID)).rejects.toThrow(NotFoundError)
  })
})

// ── assignRider ─────────────────────────────────────────────────────────
describe('assignRider', () => {
  it('only allows assigning while delivery is pending', async () => {
    repo.findDeliveryById.mockResolvedValue({ id: DEL_ID, status: 'dispatched' })
    await expect(service.assignRider(ctx, DEL_ID, RIDER_ID)).rejects.toThrow(ConflictError)
  })

  it('throws NotFoundError when delivery missing', async () => {
    repo.findDeliveryById.mockResolvedValue(null)
    await expect(service.assignRider(ctx, DEL_ID, RIDER_ID)).rejects.toThrow(NotFoundError)
  })

  it('assigns rider, transitions to dispatched, emits delivery.dispatched', async () => {
    repo.findDeliveryById.mockResolvedValue({ id: DEL_ID, status: 'pending' })
    repo.assignRider.mockResolvedValue({ id: DEL_ID, rider_id: RIDER_ID, order_id: ORDER_ID, carrier: 'own' })
    await service.assignRider(ctx, DEL_ID, RIDER_ID)
    expect(repo.assignRider).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, DEL_ID, RIDER_ID)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'delivery.dispatched',
      payload: expect.objectContaining({ deliveryId: DEL_ID, riderId: RIDER_ID }),
    }))
  })
})

// ── changeStatus FSM ────────────────────────────────────────────────────
describe('changeStatus FSM', () => {
  it('dispatched → picked_up: stamps picked_up_at and emits event', async () => {
    repo.findDeliveryById.mockResolvedValue({ id: DEL_ID, status: 'dispatched', order_id: ORDER_ID, carrier: 'own' })
    repo.setDeliveryStatus.mockResolvedValue({ id: DEL_ID, status: 'picked_up' })
    repo.insertDeliveryEvent.mockResolvedValue()
    await service.changeStatus(ctx, DEL_ID, 'picked_up', { lat: 40.4, lng: -3.7 })
    expect(repo.setDeliveryStatus).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, DEL_ID, 'picked_up', 'picked_up_at')
    expect(repo.insertDeliveryEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: 'picked_up', lat: 40.4, lng: -3.7,
    }))
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'delivery.picked_up' }))
  })

  it('picked_up → delivered: stamps delivered_at and emits event', async () => {
    repo.findDeliveryById.mockResolvedValue({ id: DEL_ID, status: 'picked_up', order_id: ORDER_ID, carrier: 'own' })
    repo.setDeliveryStatus.mockResolvedValue({ id: DEL_ID, status: 'delivered' })
    repo.insertDeliveryEvent.mockResolvedValue()
    await service.changeStatus(ctx, DEL_ID, 'delivered')
    expect(repo.setDeliveryStatus).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, DEL_ID, 'delivered', 'delivered_at')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'delivery.delivered' }))
  })

  it('rejects invalid transition pending → delivered', async () => {
    repo.findDeliveryById.mockResolvedValue({ id: DEL_ID, status: 'pending' })
    await expect(service.changeStatus(ctx, DEL_ID, 'delivered')).rejects.toThrow(ConflictError)
  })

  it('rejects from terminal status', async () => {
    repo.findDeliveryById.mockResolvedValue({ id: DEL_ID, status: 'delivered' })
    await expect(service.changeStatus(ctx, DEL_ID, 'failed')).rejects.toThrow(ConflictError)
  })

  it('throws NotFoundError when missing', async () => {
    repo.findDeliveryById.mockResolvedValue(null)
    await expect(service.changeStatus(ctx, DEL_ID, 'picked_up')).rejects.toThrow(NotFoundError)
  })
})

// ── handleEvent (subscribes to order.paid) ──────────────────────────────
describe('handleEvent', () => {
  it('creates delivery for order.paid with delivery fulfillment', async () => {
    repo.insertDelivery.mockResolvedValue({ id: DEL_ID, order_id: ORDER_ID, carrier: 'own' })
    await service.handleEvent({
      type: 'order.paid',
      payload: {
        appId: APP_ID, tenantId: TENANT_ID, orderId: ORDER_ID,
        fulfillmentMethod: 'delivery',
        dropAddress: { line1: 'Calle 1' }, deliveryFeeCents: 500,
      },
    })
    expect(repo.insertDelivery).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      orderId: ORDER_ID, feeCents: 500, dropAddress: { line1: 'Calle 1' },
    }))
  })

  it('skips when fulfillmentMethod is not delivery', async () => {
    await service.handleEvent({
      type: 'order.paid',
      payload: { appId: APP_ID, tenantId: TENANT_ID, orderId: ORDER_ID, fulfillmentMethod: 'pickup', dropAddress: {} },
    })
    expect(repo.insertDelivery).not.toHaveBeenCalled()
  })

  it('skips for unrelated events', async () => {
    await service.handleEvent({ type: 'order.created', payload: {} })
    expect(repo.insertDelivery).not.toHaveBeenCalled()
  })

  it('skips when dropAddress missing', async () => {
    await service.handleEvent({
      type: 'order.paid',
      payload: { appId: APP_ID, tenantId: TENANT_ID, orderId: ORDER_ID, fulfillmentMethod: 'delivery' },
    })
    expect(repo.insertDelivery).not.toHaveBeenCalled()
  })

  it('swallows downstream errors', async () => {
    repo.insertDelivery.mockRejectedValue(new Error('boom'))
    await expect(service.handleEvent({
      type: 'order.paid',
      payload: { appId: APP_ID, tenantId: TENANT_ID, orderId: ORDER_ID, fulfillmentMethod: 'delivery', dropAddress: { line1: 'X' } },
    })).resolves.toBeUndefined()
  })
})
