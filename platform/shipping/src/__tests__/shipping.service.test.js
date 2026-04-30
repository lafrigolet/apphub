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
vi.mock('../repositories/shipping.repository.js')

import * as service from '../services/shipping.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/shipping.repository.js'
import { NotFoundError } from '@apphub/platform-sdk/errors'

const APP_ID    = 'yoga-studio'
const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const ORDER_ID  = '11111111-1111-1111-1111-111111111111'
const SHIP_ID   = '22222222-2222-2222-2222-222222222222'
const ZONE_ID   = '33333333-3333-3333-3333-333333333333'

const ctx = { appId: APP_ID, tenantId: TENANT_ID, subTenantId: null, userId: 'u1', role: 'admin' }

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
})

// ── zones / rates ──────────────────────────────────────────────────────
describe('zones / rates', () => {
  it('createZone delegates to repository', async () => {
    repo.insertZone.mockResolvedValue({ id: ZONE_ID, name: 'EU' })
    await service.createZone(ctx, { name: 'EU', countryCodes: ['ES', 'FR'] })
    expect(repo.insertZone).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, expect.objectContaining({ name: 'EU' }))
  })

  it('listZones delegates', async () => {
    repo.listZones.mockResolvedValue([{ id: ZONE_ID }])
    const r = await service.listZones(ctx)
    expect(r).toHaveLength(1)
  })

  it('createRate delegates', async () => {
    repo.insertRate.mockResolvedValue({ id: 'r1' })
    await service.createRate(ctx, { name: 'Standard', priceCents: 500 })
    expect(repo.insertRate).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, expect.objectContaining({ priceCents: 500 }))
  })

  it('listRates filters by zoneId', async () => {
    repo.listRates.mockResolvedValue([])
    await service.listRates(ctx, ZONE_ID)
    expect(repo.listRates).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, ZONE_ID)
  })
})

// ── quote ──────────────────────────────────────────────────────────────
describe('quote', () => {
  it('queries rates by country', async () => {
    repo.findRatesForCountry.mockResolvedValue([{ id: 'r1', price_cents: 500 }])
    const rates = await service.quote(ctx, { country: 'ES' })
    expect(repo.findRatesForCountry).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, 'ES')
    expect(rates).toHaveLength(1)
  })
})

// ── createShipment ─────────────────────────────────────────────────────
describe('createShipment', () => {
  it('persists and publishes shipping.shipment.created', async () => {
    repo.insertShipment.mockResolvedValue({ id: SHIP_ID, order_id: ORDER_ID })
    await service.createShipment(ctx, { orderId: ORDER_ID })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'shipping.shipment.created',
      payload: expect.objectContaining({ shipmentId: SHIP_ID, orderId: ORDER_ID }),
    }))
  })
})

// ── getShipment ────────────────────────────────────────────────────────
describe('getShipment', () => {
  it('returns shipment with events', async () => {
    repo.findShipmentById.mockResolvedValue({ id: SHIP_ID })
    repo.listShipmentEvents.mockResolvedValue([{ code: 'shipped' }])
    const r = await service.getShipment(ctx, SHIP_ID)
    expect(r.events).toHaveLength(1)
  })

  it('throws NotFoundError when missing', async () => {
    repo.findShipmentById.mockResolvedValue(null)
    await expect(service.getShipment(ctx, SHIP_ID)).rejects.toThrow(NotFoundError)
  })
})

// ── appendEvent — tracking events drive status FSM ─────────────────────
describe('appendEvent', () => {
  it('shipped code → in_transit + emits shipping.shipment.shipped', async () => {
    repo.findShipmentById.mockResolvedValue({ id: SHIP_ID, order_id: ORDER_ID, status: 'pending' })
    repo.insertShipmentEvent.mockResolvedValue({ id: 'ev1', code: 'shipped' })
    repo.updateShipmentStatus.mockResolvedValue({ id: SHIP_ID, status: 'in_transit' })

    const r = await service.appendEvent(ctx, SHIP_ID, { code: 'shipped' })
    expect(repo.updateShipmentStatus).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, SHIP_ID, 'in_transit', expect.objectContaining({ shippedAt: expect.any(Date) }))
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'shipping.shipment.shipped' }))
    expect(r.shipment.status).toBe('in_transit')
  })

  it('in_transit code is treated like shipped', async () => {
    repo.findShipmentById.mockResolvedValue({ id: SHIP_ID, order_id: ORDER_ID, status: 'pending' })
    repo.insertShipmentEvent.mockResolvedValue({ id: 'ev1' })
    repo.updateShipmentStatus.mockResolvedValue({ id: SHIP_ID, status: 'in_transit' })
    await service.appendEvent(ctx, SHIP_ID, { code: 'in_transit' })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'shipping.shipment.shipped' }))
  })

  it('delivered code → delivered + emits shipping.shipment.delivered', async () => {
    repo.findShipmentById.mockResolvedValue({ id: SHIP_ID, order_id: ORDER_ID, status: 'in_transit' })
    repo.insertShipmentEvent.mockResolvedValue({ id: 'ev1' })
    repo.updateShipmentStatus.mockResolvedValue({ id: SHIP_ID, status: 'delivered' })
    await service.appendEvent(ctx, SHIP_ID, { code: 'delivered' })
    expect(repo.updateShipmentStatus).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, SHIP_ID, 'delivered', expect.objectContaining({ deliveredAt: expect.any(Date) }))
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'shipping.shipment.delivered' }))
  })

  it('returned code → returned, no platform event published', async () => {
    repo.findShipmentById.mockResolvedValue({ id: SHIP_ID, order_id: ORDER_ID, status: 'in_transit' })
    repo.insertShipmentEvent.mockResolvedValue({ id: 'ev1' })
    repo.updateShipmentStatus.mockResolvedValue({ id: SHIP_ID, status: 'returned' })
    await service.appendEvent(ctx, SHIP_ID, { code: 'returned' })
    expect(repo.updateShipmentStatus).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, SHIP_ID, 'returned')
    expect(publish).not.toHaveBeenCalled()
  })

  it('unknown code stores event without status change', async () => {
    repo.findShipmentById.mockResolvedValue({ id: SHIP_ID, order_id: ORDER_ID, status: 'in_transit' })
    repo.insertShipmentEvent.mockResolvedValue({ id: 'ev1' })
    await service.appendEvent(ctx, SHIP_ID, { code: 'in_warehouse' })
    expect(repo.updateShipmentStatus).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('throws NotFoundError when shipment missing', async () => {
    repo.findShipmentById.mockResolvedValue(null)
    await expect(service.appendEvent(ctx, SHIP_ID, { code: 'shipped' })).rejects.toThrow(NotFoundError)
  })
})

// ── handleEvent — order.paid auto-creates shipment ─────────────────────
describe('handleEvent', () => {
  it('order.paid → createShipment(pending)', async () => {
    repo.insertShipment.mockResolvedValue({ id: SHIP_ID, order_id: ORDER_ID })
    await service.handleEvent({
      type: 'order.paid',
      payload: { appId: APP_ID, tenantId: TENANT_ID, orderId: ORDER_ID },
    })
    expect(repo.insertShipment).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID,
      expect.objectContaining({ orderId: ORDER_ID, status: 'pending' }))
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'shipping.shipment.created' }))
  })

  it('ignores other event types', async () => {
    await service.handleEvent({ type: 'order.created', payload: { appId: APP_ID, tenantId: TENANT_ID, orderId: ORDER_ID } })
    expect(repo.insertShipment).not.toHaveBeenCalled()
  })

  it('swallows downstream errors', async () => {
    repo.insertShipment.mockRejectedValue(new Error('boom'))
    await expect(service.handleEvent({
      type: 'order.paid',
      payload: { appId: APP_ID, tenantId: TENANT_ID, orderId: ORDER_ID },
    })).resolves.toBeUndefined()
  })
})
