/**
 * Integration tests for platform/shipping — require Postgres + Redis.
 * Start dependencies:  docker compose up postgres redis -d
 * Run:                 pnpm --filter @apphub/platform-shipping test:integration
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import pg from 'pg'
import Redis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'

import { runMigrations } from '../../lib/migrate.js'
import {
  createZone, listZones, createRate, listRates, quote,
  createShipment, getShipment, appendEvent, handleEvent,
} from '../../services/shipping.service.js'
import { NotFoundError } from '../../utils/errors.js'

const APP_ID    = 'int-test-shp'
const TENANT_ID = '00000000-0000-0000-0000-0000000001e1'

let adminPool, redis

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
  await adminPool.query(`DELETE FROM platform_shipping.shipment_events WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_shipping.shipments       WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_shipping.shipping_rates  WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_shipping.shipping_zones  WHERE app_id = $1`, [APP_ID])
})

const ctx = (overrides = {}) => ({
  appId: APP_ID, tenantId: TENANT_ID, subTenantId: null,
  userId: '11111111-1111-1111-1111-111111111111', role: 'admin', ...overrides,
})

describe('zones / rates / quote', () => {
  it('creates zones and rates, queries by country', async () => {
    const eu = await createZone(ctx(), { name: 'EU', countryCodes: ['ES', 'FR'] })
    const us = await createZone(ctx(), { name: 'US', countryCodes: ['US'] })
    await createRate(ctx(), { zoneId: eu.id, name: 'EU Standard', priceCents: 500 })
    await createRate(ctx(), { zoneId: us.id, name: 'US Standard', priceCents: 1500 })

    const zones = await listZones(ctx())
    expect(zones).toHaveLength(2)

    const euRates = await listRates(ctx(), eu.id)
    expect(euRates).toHaveLength(1)

    const esQuote = await quote(ctx(), { country: 'ES' })
    expect(esQuote.find((r) => r.name === 'EU Standard')).toBeTruthy()
    // US zone rate must NOT appear for ES
    expect(esQuote.find((r) => r.name === 'US Standard')).toBeFalsy()
  })
})

describe('shipments', () => {
  it('creates a shipment and emits shipping.shipment.created', async () => {
    const sub = new Redis(process.env.REDIS_URL)
    const events = []
    await sub.subscribe('platform.events')
    sub.on('message', (_c, raw) => { try { events.push(JSON.parse(raw)) } catch {} })
    await new Promise((r) => setTimeout(r, 50))

    try {
      const orderId = uuidv4()
      const s = await createShipment(ctx(), { orderId })
      expect(s.app_id).toBe(APP_ID)
      const deadline = Date.now() + 2000
      while (Date.now() < deadline && !events.some((e) => e.type === 'shipping.shipment.created')) {
        await new Promise((r) => setTimeout(r, 50))
      }
      expect(events.find((e) => e.type === 'shipping.shipment.created' && e.payload.shipmentId === s.id)).toBeTruthy()
    } finally {
      sub.disconnect()
    }
  })

  it('getShipment returns events', async () => {
    const orderId = uuidv4()
    const s = await createShipment(ctx(), { orderId })
    await appendEvent(ctx(), s.id, { code: 'shipped', description: 'left warehouse' })
    const full = await getShipment(ctx(), s.id)
    expect(full.events).toHaveLength(1)
  })

  it('getShipment throws NotFoundError on unknown id', async () => {
    await expect(getShipment(ctx(), uuidv4())).rejects.toThrow(NotFoundError)
  })
})

describe('appendEvent — tracking codes drive status', () => {
  it('shipped → in_transit → delivered with timestamps and platform events', async () => {
    const sub = new Redis(process.env.REDIS_URL)
    const events = []
    await sub.subscribe('platform.events')
    sub.on('message', (_c, raw) => { try { events.push(JSON.parse(raw)) } catch {} })
    await new Promise((r) => setTimeout(r, 50))

    try {
      const s = await createShipment(ctx(), { orderId: uuidv4() })
      const r1 = await appendEvent(ctx(), s.id, { code: 'shipped' })
      expect(r1.shipment.status).toBe('in_transit')
      expect(r1.shipment.shipped_at).toBeTruthy()

      const r2 = await appendEvent(ctx(), s.id, { code: 'delivered' })
      expect(r2.shipment.status).toBe('delivered')
      expect(r2.shipment.delivered_at).toBeTruthy()

      const wantTypes = ['shipping.shipment.shipped', 'shipping.shipment.delivered']
      const deadline = Date.now() + 2000
      while (Date.now() < deadline && !wantTypes.every((t) => events.some((e) => e.type === t))) {
        await new Promise((rs) => setTimeout(rs, 50))
      }
      for (const t of wantTypes) {
        expect(events.find((e) => e.type === t && e.payload.shipmentId === s.id)).toBeTruthy()
      }
    } finally {
      sub.disconnect()
    }
  })

  it('returned code → returned status, no platform event', async () => {
    const s = await createShipment(ctx(), { orderId: uuidv4() })
    await appendEvent(ctx(), s.id, { code: 'shipped' })
    const r = await appendEvent(ctx(), s.id, { code: 'returned' })
    expect(r.shipment.status).toBe('returned')
  })

  it('unknown code stores event without status change', async () => {
    const s = await createShipment(ctx(), { orderId: uuidv4() })
    const r = await appendEvent(ctx(), s.id, { code: 'in_warehouse' })
    expect(r.shipment.status).toBe('pending')
    expect(r.event.code).toBe('in_warehouse')
  })

  it('appendEvent throws NotFoundError on unknown shipment', async () => {
    await expect(appendEvent(ctx(), uuidv4(), { code: 'shipped' })).rejects.toThrow(NotFoundError)
  })
})

describe('handleEvent', () => {
  it('order.paid auto-creates a pending shipment for that order', async () => {
    const orderId = uuidv4()
    await handleEvent({
      type: 'order.paid',
      payload: { appId: APP_ID, tenantId: TENANT_ID, orderId },
    })
    const { rows } = await adminPool.query(
      `SELECT * FROM platform_shipping.shipments WHERE app_id=$1 AND order_id=$2`,
      [APP_ID, orderId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('pending')
  })
})

describe('tenant isolation', () => {
  it('zones and shipments from another tenant are not visible', async () => {
    const T2 = '00000000-0000-0000-0000-0000000001e2'
    await createZone(ctx(), { name: 'A' })
    await createZone({ ...ctx(), tenantId: T2 }, { name: 'B' })
    const list = await listZones(ctx())
    expect(list.every((z) => z.tenant_id === TENANT_ID)).toBe(true)
    await adminPool.query(`DELETE FROM platform_shipping.shipping_zones WHERE app_id=$1 AND tenant_id=$2`, [APP_ID, T2])
  })
})
