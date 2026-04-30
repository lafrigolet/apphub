/**
 * Integration tests for platform/inventory — require Postgres + Redis.
 * Start dependencies:  docker compose up postgres redis -d
 * Run:                 pnpm --filter @apphub/platform-inventory test:integration
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import pg from 'pg'
import Redis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'

import { runMigrations } from '../../lib/migrate.js'
import {
  upsertItem, getItem, listItems, reserveItem, releaseItem, commitItem, handleOrderEvent,
} from '../../services/inventory.service.js'
import { ConflictError, NotFoundError } from '../../utils/errors.js'

const APP_ID    = 'int-test-inv'
const TENANT_ID = '00000000-0000-0000-0000-0000000001b1'

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
  await adminPool.query(`DELETE FROM platform_inventory.stock_movements WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_inventory.inventory_items WHERE app_id = $1`, [APP_ID])
})

const ctx = (overrides = {}) => ({
  appId: APP_ID, tenantId: TENANT_ID, subTenantId: null,
  userId: '11111111-1111-1111-1111-111111111111', role: 'admin', ...overrides,
})

describe('upsertItem', () => {
  it('creates new and increments delta on update', async () => {
    const sku = 'INV-' + uuidv4().slice(0, 6)
    const a = await upsertItem(ctx(), { sku, qtyOnHand: 10 })
    expect(a.qty_on_hand).toBe(10)
    const b = await upsertItem(ctx(), { sku, qtyOnHand: 12 })
    expect(b.qty_on_hand).toBe(12)

    const moves = await adminPool.query(
      `SELECT delta, reason FROM platform_inventory.stock_movements
       WHERE app_id=$1 AND sku=$2 ORDER BY created_at`,
      [APP_ID, sku],
    )
    expect(moves.rows.map((m) => m.delta)).toEqual([10, 2])
    expect(moves.rows.every((m) => m.reason === 'adjust')).toBe(true)
  })

  it('skips movement when qty unchanged', async () => {
    const sku = 'INV-' + uuidv4().slice(0, 6)
    await upsertItem(ctx(), { sku, qtyOnHand: 5 })
    await upsertItem(ctx(), { sku, qtyOnHand: 5 })
    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS c FROM platform_inventory.stock_movements WHERE app_id=$1 AND sku=$2`,
      [APP_ID, sku],
    )
    expect(rows[0].c).toBe(1)
  })
})

describe('reserve / release / commit', () => {
  it('reserve decrements available stock; release restores it; commit reduces qty_on_hand', async () => {
    const sku = 'INV-' + uuidv4().slice(0, 6)
    await upsertItem(ctx(), { sku, qtyOnHand: 10 })

    const r1 = await reserveItem(ctx(), { sku, qty: 3, refType: 'order', refId: uuidv4() })
    expect(r1.qty_reserved).toBe(3)
    expect(r1.qty_on_hand).toBe(10)

    const r2 = await releaseItem(ctx(), { sku, qty: 2 })
    expect(r2.qty_reserved).toBe(1)

    const r3 = await commitItem(ctx(), { sku, qty: 1 })
    expect(r3.qty_on_hand).toBe(9)
    expect(r3.qty_reserved).toBe(0)
  })

  it('reserveItem throws ConflictError when over-reserving', async () => {
    const sku = 'INV-' + uuidv4().slice(0, 6)
    await upsertItem(ctx(), { sku, qtyOnHand: 1 })
    await expect(reserveItem(ctx(), { sku, qty: 5 })).rejects.toThrow(ConflictError)
  })

  it('reserveItem throws NotFoundError when item missing', async () => {
    await expect(reserveItem(ctx(), { sku: 'GHOST-' + uuidv4().slice(0, 6), qty: 1 })).rejects.toThrow(NotFoundError)
  })

  it('commitItem throws NotFoundError when stock too low or item missing', async () => {
    await expect(commitItem(ctx(), { sku: 'GHOST-' + uuidv4().slice(0, 6), qty: 1 })).rejects.toThrow(NotFoundError)

    const sku = 'INV-' + uuidv4().slice(0, 6)
    await upsertItem(ctx(), { sku, qtyOnHand: 1 })
    await expect(commitItem(ctx(), { sku, qty: 5 })).rejects.toThrow(NotFoundError)
  })
})

describe('depleted event', () => {
  it('publishes inventory.depleted when commit drops qty_on_hand at/below threshold', async () => {
    const sku = 'INV-' + uuidv4().slice(0, 6)
    await upsertItem(ctx(), { sku, qtyOnHand: 6, lowStockThreshold: 3 })

    const sub = new Redis(process.env.REDIS_URL)
    const events = []
    await sub.subscribe('platform.events')
    sub.on('message', (_c, raw) => { try { events.push(JSON.parse(raw)) } catch {} })
    await new Promise((r) => setTimeout(r, 50))

    try {
      await commitItem(ctx(), { sku, qty: 4 })  // remaining = 2 ≤ threshold 3
      const deadline = Date.now() + 2000
      while (Date.now() < deadline && !events.some((e) => e.type === 'inventory.depleted' && e.payload.sku === sku)) {
        await new Promise((r) => setTimeout(r, 50))
      }
      const evt = events.find((e) => e.type === 'inventory.depleted' && e.payload.sku === sku)
      expect(evt).toBeTruthy()
      expect(evt.payload.qtyOnHand).toBe(2)
    } finally {
      sub.disconnect()
    }
  })
})

describe('handleOrderEvent', () => {
  it('order.created reserves, order.paid commits, order.cancelled releases', async () => {
    const sku = 'INV-' + uuidv4().slice(0, 6)
    const orderId = uuidv4()
    await upsertItem(ctx(), { sku, qtyOnHand: 10 })

    await handleOrderEvent({
      type: 'order.created',
      payload: { appId: APP_ID, tenantId: TENANT_ID, orderId, items: [{ sku, qty: 3 }] },
    })
    let item = await getItem(ctx(), sku)
    expect(item.qty_reserved).toBe(3)
    expect(item.qty_on_hand).toBe(10)

    await handleOrderEvent({
      type: 'order.paid',
      payload: { appId: APP_ID, tenantId: TENANT_ID, orderId, items: [{ sku, qty: 3 }] },
    })
    item = await getItem(ctx(), sku)
    expect(item.qty_on_hand).toBe(7)
    expect(item.qty_reserved).toBe(0)

    // cancellation no-op (already committed) — release tolerated, no negative reservation
    await handleOrderEvent({
      type: 'order.cancelled',
      payload: { appId: APP_ID, tenantId: TENANT_ID, orderId, items: [{ sku, qty: 3 }] },
    })
    item = await getItem(ctx(), sku)
    expect(item.qty_reserved).toBe(0)
  })
})

describe('tenant isolation', () => {
  it('items from another tenant are not visible', async () => {
    const T2 = '00000000-0000-0000-0000-0000000001b2'
    const sku = 'INV-' + uuidv4().slice(0, 6)
    await upsertItem(ctx(), { sku, qtyOnHand: 1 })
    await upsertItem(ctx({ tenantId: T2 }), { sku, qtyOnHand: 99 })

    const list = await listItems(ctx(), {})
    expect(list.every((x) => x.tenant_id === TENANT_ID)).toBe(true)

    await adminPool.query(`DELETE FROM platform_inventory.stock_movements WHERE app_id=$1 AND tenant_id=$2`, [APP_ID, T2])
    await adminPool.query(`DELETE FROM platform_inventory.inventory_items WHERE app_id=$1 AND tenant_id=$2`, [APP_ID, T2])
  })
})
