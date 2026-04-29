/**
 * Integration tests for platform/orders — require Postgres + Redis.
 * Start dependencies:  docker compose up postgres redis -d
 * Run:                 pnpm --filter @apphub/platform-orders test:integration
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import pg from 'pg'
import Redis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'

import { runMigrations } from '../../lib/migrate.js'
import {
  createOrder, getOrder, listOrders, changeStatus, cancelOrder, refundOrder, handleEvent,
} from '../../services/orders.service.js'
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors.js'

const APP_ID    = 'int-test-orders'
const TENANT_ID = '00000000-0000-0000-0000-0000000001a1'

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
  await adminPool.query(`DELETE FROM platform_orders.order_status_history WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_orders.order_addresses      WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_orders.order_items          WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_orders.orders               WHERE app_id = $1`, [APP_ID])
})

const ctx = (overrides = {}) => ({
  appId: APP_ID, tenantId: TENANT_ID, subTenantId: null,
  userId: '11111111-1111-1111-1111-111111111111', role: 'buyer', ...overrides,
})

const items = () => [{ sku: 'X', productName: 'X', qty: 2, unitPriceCents: 1000 }]

describe('createOrder / getOrder', () => {
  it('persists order with totals, items and history row', async () => {
    const o = await createOrder(ctx(), { currency: 'EUR', items: items(), taxCents: 200 })
    expect(o.app_id).toBe(APP_ID)
    expect(Number(o.subtotal_cents)).toBe(2000)
    expect(Number(o.total_cents)).toBe(2200)
    expect(o.items).toHaveLength(1)
    expect(o.history.map((h) => h.to_status)).toEqual(['pending'])

    const fetched = await getOrder(ctx(), o.id)
    expect(fetched.id).toBe(o.id)
  })

  it('rejects empty items', async () => {
    await expect(createOrder(ctx(), { currency: 'EUR', items: [] })).rejects.toThrow(ValidationError)
  })

  it('idempotency — duplicate key returns existing order', async () => {
    const key = 'idem-' + uuidv4()
    const a = await createOrder(ctx(), { currency: 'EUR', items: items(), idempotencyKey: key })
    const b = await createOrder(ctx(), { currency: 'EUR', items: items(), idempotencyKey: key })
    expect(b.id).toBe(a.id)
  })

  it('persists shipping + billing addresses', async () => {
    const o = await createOrder(ctx(), {
      currency: 'EUR', items: items(),
      shippingAddress: { line1: 'Calle 1', country: 'ES' },
      billingAddress:  { line1: 'Calle 2', country: 'ES' },
    })
    expect(o.addresses).toHaveLength(2)
    expect(o.addresses.map((a) => a.kind).sort()).toEqual(['billing', 'shipping'])
  })

  it('getOrder throws NotFoundError on unknown id', async () => {
    await expect(getOrder(ctx(), uuidv4())).rejects.toThrow(NotFoundError)
  })
})

describe('status FSM', () => {
  it('walks pending → paid → shipped → delivered → completed and records history', async () => {
    const o = await createOrder(ctx(), { currency: 'EUR', items: items() })
    await changeStatus(ctx(), o.id, 'paid')
    await changeStatus(ctx(), o.id, 'shipped')
    await changeStatus(ctx(), o.id, 'delivered')
    const final = await changeStatus(ctx(), o.id, 'completed')
    expect(final.status).toBe('completed')

    const full = await getOrder(ctx(), o.id)
    expect(full.history.map((h) => h.to_status)).toEqual(['pending', 'paid', 'shipped', 'delivered', 'completed'])
  })

  it('rejects invalid transition pending → delivered', async () => {
    const o = await createOrder(ctx(), { currency: 'EUR', items: items() })
    await expect(changeStatus(ctx(), o.id, 'delivered')).rejects.toThrow(ConflictError)
  })

  it('cancelOrder + refundOrder shorthand', async () => {
    const a = await createOrder(ctx(), { currency: 'EUR', items: items() })
    const cancelled = await cancelOrder(ctx(), a.id, 'changed mind')
    expect(cancelled.status).toBe('cancelled')

    const b = await createOrder(ctx(), { currency: 'EUR', items: items() })
    await changeStatus(ctx(), b.id, 'paid')
    const refunded = await refundOrder(ctx(), b.id, 'broken')
    expect(refunded.status).toBe('refunded')
  })
})

describe('redis events', () => {
  it('publishes order.created and order.paid', async () => {
    const sub = new Redis(process.env.REDIS_URL)
    const events = []
    await sub.subscribe('platform.events')
    sub.on('message', (_c, raw) => { try { events.push(JSON.parse(raw)) } catch {} })
    await new Promise((r) => setTimeout(r, 50))

    try {
      const o = await createOrder(ctx(), { currency: 'EUR', items: items() })
      await changeStatus(ctx(), o.id, 'paid')

      const deadline = Date.now() + 2000
      while (Date.now() < deadline && !events.some((e) => e.type === 'order.paid' && e.payload.orderId === o.id)) {
        await new Promise((r) => setTimeout(r, 50))
      }
      expect(events.find((e) => e.type === 'order.created' && e.payload.orderId === o.id)).toBeTruthy()
      expect(events.find((e) => e.type === 'order.paid' && e.payload.orderId === o.id)).toBeTruthy()
    } finally {
      sub.disconnect()
    }
  })
})

describe('handleEvent', () => {
  it('splitpay.payment.completed advances pending → paid', async () => {
    const o = await createOrder(ctx(), { currency: 'EUR', items: items() })
    await handleEvent({
      type: 'splitpay.payment.completed',
      payload: { appId: APP_ID, tenantId: TENANT_ID, orderId: o.id },
    })
    const after = await getOrder(ctx(), o.id)
    expect(after.status).toBe('paid')
  })

  it('shipping.shipment.delivered advances paid → delivered', async () => {
    const o = await createOrder(ctx(), { currency: 'EUR', items: items() })
    await changeStatus(ctx(), o.id, 'paid')
    await handleEvent({
      type: 'shipping.shipment.delivered',
      payload: { appId: APP_ID, tenantId: TENANT_ID, orderId: o.id },
    })
    const after = await getOrder(ctx(), o.id)
    expect(after.status).toBe('delivered')
  })
})

describe('tenant isolation', () => {
  it('orders from another tenant are not visible', async () => {
    const T2 = '00000000-0000-0000-0000-0000000001a2'
    await createOrder(ctx(), { currency: 'EUR', items: items() })
    await createOrder(ctx({ tenantId: T2 }), { currency: 'EUR', items: items() })
    const list = await listOrders(ctx(), {})
    expect(list.every((o) => o.tenant_id === TENANT_ID)).toBe(true)
    await adminPool.query(`DELETE FROM platform_orders.order_items WHERE app_id = $1 AND tenant_id = $2`, [APP_ID, T2])
    await adminPool.query(`DELETE FROM platform_orders.orders      WHERE app_id = $1 AND tenant_id = $2`, [APP_ID, T2])
  })
})
