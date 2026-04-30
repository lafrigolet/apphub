/**
 * Integration tests for platform/delivery-dispatch — require Postgres + Redis.
 * Start dependencies:  docker compose up postgres redis -d
 * Run:                 pnpm --filter @apphub/platform-delivery-dispatch test:integration
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import pg from 'pg'
import Redis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'

import { runMigrations } from '../../lib/migrate.js'
import {
  createZone, listZones, createRider, listRiders, pingRiderLocation,
  createDelivery, listDeliveries, getDelivery, assignRider, changeStatus, handleEvent,
} from '../../services/delivery-dispatch.service.js'
import { ConflictError, NotFoundError } from '../../utils/errors.js'

const APP_ID    = 'int-test-dd'
const TENANT_ID = '00000000-0000-0000-0000-0000000000f1'

let adminPool
let redis

beforeAll(async () => {
  await runMigrations(process.env.MIGRATION_DATABASE_URL)
  adminPool = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL })
  redis = new Redis(process.env.REDIS_URL)
  await adminPool.query('SELECT 1')
  await redis.ping()
})

afterAll(async () => {
  await adminPool.end()
  redis.disconnect()
})

afterEach(async () => {
  await adminPool.query(`DELETE FROM platform_delivery_dispatch.delivery_events WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_delivery_dispatch.deliveries      WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_delivery_dispatch.riders          WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_delivery_dispatch.zones           WHERE app_id = $1`, [APP_ID])
})

const ctx = (overrides = {}) => ({
  appId: APP_ID, tenantId: TENANT_ID, subTenantId: null,
  userId: '11111111-1111-1111-1111-111111111111', role: 'dispatcher', ...overrides,
})

describe('zones / riders', () => {
  it('creates and lists zones', async () => {
    const z = await createZone(ctx(), {
      name: 'Centro',
      polygon: { type: 'Polygon', coordinates: [[[0,0],[0,1],[1,1],[1,0],[0,0]]] },
      baseFeeCents: 200, perKmCents: 50,
    })
    expect(z.app_id).toBe(APP_ID)
    const zones = await listZones(ctx())
    expect(zones.find((x) => x.id === z.id)).toBeTruthy()
  })

  it('creates and lists riders, supports ping', async () => {
    const r = await createRider(ctx(), { displayName: 'Ana', vehicle: 'bike' })
    expect(r.status).toBe('offline')
    const all = await listRiders(ctx(), {})
    expect(all.find((x) => x.id === r.id)).toBeTruthy()

    const updated = await pingRiderLocation(ctx(), r.id, { lat: 40.4, lng: -3.7, status: 'available' })
    expect(updated.status).toBe('available')
    expect(Number(updated.last_lat)).toBeCloseTo(40.4, 1)

    const available = await listRiders(ctx(), { status: 'available' })
    expect(available.map((x) => x.id)).toContain(r.id)
  })

  it('pingRiderLocation throws NotFoundError on unknown rider', async () => {
    await expect(pingRiderLocation(ctx(), uuidv4(), { lat: 0, lng: 0 })).rejects.toThrow(NotFoundError)
  })
})

describe('delivery lifecycle', () => {
  it('creates → assigns → picked_up → delivered with audit trail', async () => {
    const r = await createRider(ctx(), { displayName: 'Ana', vehicle: 'bike' })
    const d = await createDelivery(ctx(), {
      orderId: uuidv4(), dropAddress: { line1: 'Calle 1' }, feeCents: 500,
    })
    expect(d.status).toBe('pending')

    const assigned = await assignRider(ctx(), d.id, r.id)
    expect(assigned.status).toBe('dispatched')
    expect(assigned.rider_id).toBe(r.id)
    expect(assigned.dispatched_at).toBeTruthy()

    await changeStatus(ctx(), d.id, 'picked_up', { lat: 40.4, lng: -3.7 })
    const final = await changeStatus(ctx(), d.id, 'delivered', { lat: 40.5, lng: -3.6 })
    expect(final.status).toBe('delivered')
    expect(final.delivered_at).toBeTruthy()

    const full = await getDelivery(ctx(), d.id)
    expect(full.events.map((e) => e.event_type)).toEqual(['picked_up', 'delivered'])
  })

  it('rejects assign on already-dispatched delivery', async () => {
    const r = await createRider(ctx(), { displayName: 'A' })
    const d = await createDelivery(ctx(), { orderId: uuidv4(), dropAddress: { line1: 'X' } })
    await assignRider(ctx(), d.id, r.id)
    await expect(assignRider(ctx(), d.id, r.id)).rejects.toThrow(ConflictError)
  })

  it('rejects invalid status transition pending → delivered', async () => {
    const d = await createDelivery(ctx(), { orderId: uuidv4(), dropAddress: { line1: 'X' } })
    await expect(changeStatus(ctx(), d.id, 'delivered')).rejects.toThrow(ConflictError)
  })

  it('listDeliveries filters by status', async () => {
    const r = await createRider(ctx(), { displayName: 'A' })
    const a = await createDelivery(ctx(), { orderId: uuidv4(), dropAddress: { line1: 'A' } })
    const b = await createDelivery(ctx(), { orderId: uuidv4(), dropAddress: { line1: 'B' } })
    await assignRider(ctx(), a.id, r.id)
    const dispatched = await listDeliveries(ctx(), { status: 'dispatched' })
    expect(dispatched.find((x) => x.id === a.id)).toBeTruthy()
    expect(dispatched.find((x) => x.id === b.id)).toBeFalsy()
  })

  it('getDelivery throws NotFoundError on unknown id', async () => {
    await expect(getDelivery(ctx(), uuidv4())).rejects.toThrow(NotFoundError)
  })
})

describe('handleEvent (order.paid)', () => {
  it('auto-creates a delivery for delivery-fulfilled orders', async () => {
    const orderId = uuidv4()
    await handleEvent({
      type: 'order.paid',
      payload: {
        appId: APP_ID, tenantId: TENANT_ID, orderId,
        fulfillmentMethod: 'delivery',
        dropAddress: { line1: 'Calle 1', city: 'Madrid' },
        deliveryFeeCents: 500,
      },
    })

    const list = await listDeliveries(ctx(), {})
    const created = list.find((x) => x.order_id === orderId)
    expect(created).toBeTruthy()
    expect(Number(created.fee_cents)).toBe(500)
  })

  it('skips when fulfillmentMethod is pickup', async () => {
    const orderId = uuidv4()
    await handleEvent({
      type: 'order.paid',
      payload: { appId: APP_ID, tenantId: TENANT_ID, orderId, fulfillmentMethod: 'pickup', dropAddress: {} },
    })
    const list = await listDeliveries(ctx(), {})
    expect(list.find((x) => x.order_id === orderId)).toBeFalsy()
  })
})

describe('redis events', () => {
  it('emits delivery.created → delivery.dispatched → delivery.delivered', async () => {
    const sub = new Redis(process.env.REDIS_URL)
    const events = []
    await sub.subscribe('platform.events')
    sub.on('message', (_c, raw) => { try { events.push(JSON.parse(raw)) } catch {} })
    await new Promise((r) => setTimeout(r, 50))

    try {
      const r = await createRider(ctx(), { displayName: 'Ana' })
      const d = await createDelivery(ctx(), { orderId: uuidv4(), dropAddress: { line1: 'X' } })
      await assignRider(ctx(), d.id, r.id)
      await changeStatus(ctx(), d.id, 'picked_up')
      await changeStatus(ctx(), d.id, 'delivered')

      const wantTypes = ['delivery.created', 'delivery.dispatched', 'delivery.picked_up', 'delivery.delivered']
      const deadline = Date.now() + 3000
      while (Date.now() < deadline && !wantTypes.every((t) => events.some((e) => e.type === t))) {
        await new Promise((rs) => setTimeout(rs, 50))
      }
      for (const t of wantTypes) {
        expect(events.find((e) => e.type === t && e.payload.deliveryId === d.id)).toBeTruthy()
      }
    } finally {
      sub.disconnect()
    }
  })
})

describe('tenant isolation', () => {
  it('listDeliveries only returns deliveries for the calling tenant', async () => {
    const T2 = '00000000-0000-0000-0000-0000000000f2'
    await createDelivery(ctx(), { orderId: uuidv4(), dropAddress: { line1: 'mine' } })
    await createDelivery(ctx({ tenantId: T2 }), { orderId: uuidv4(), dropAddress: { line1: 'other' } })
    const list = await listDeliveries(ctx(), {})
    expect(list.every((d) => d.tenant_id === TENANT_ID)).toBe(true)
    await adminPool.query(`DELETE FROM platform_delivery_dispatch.deliveries WHERE app_id = $1 AND tenant_id = $2`, [APP_ID, T2])
  })
})
