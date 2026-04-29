/**
 * Integration tests for platform/pos — require a running Postgres + Redis.
 * Start dependencies:  docker compose up postgres redis -d
 * Run:                 pnpm --filter @apphub/platform-pos test:integration
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import pg from 'pg'
import Redis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'

import { runMigrations } from '../../lib/migrate.js'
import {
  openBill, addItem, splitBill, payBill, closeBill, getBill, listBills,
} from '../../services/pos.service.js'
import { ConflictError, ValidationError } from '../../utils/errors.js'

const APP_ID    = 'int-test-pos'
const TENANT_ID = '00000000-0000-0000-0000-0000000000e1'

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
  await adminPool.query(`DELETE FROM platform_pos.bill_splits   WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_pos.bill_payments WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_pos.bill_items    WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_pos.bills         WHERE app_id = $1`, [APP_ID])
})

const ctx = (overrides = {}) => ({
  appId: APP_ID, tenantId: TENANT_ID, subTenantId: null,
  userId: '11111111-1111-1111-1111-111111111111', role: 'server', ...overrides,
})

describe('open / add items / totals', () => {
  it('opens a bill and computes totals as items are added (10% tax default)', async () => {
    const b = await openBill(ctx(), { tableCode: 'T1' })
    expect(b.status).toBe('open')
    expect(Number(b.total_cents)).toBe(0)

    await addItem(ctx(), b.id, { sku: 'BURG', name: 'Burger', qty: 2, unitPriceCents: 1000 })
    const after1 = await addItem(ctx(), b.id, { sku: 'COKE', name: 'Coke',   qty: 1, unitPriceCents: 200 })
    expect(Number(after1.subtotal_cents)).toBe(2200)
    expect(Number(after1.tax_cents)).toBe(220)
    expect(Number(after1.total_cents)).toBe(2420)
  })

  it('addItem rejects when bill is not open', async () => {
    const b = await openBill(ctx(), {})
    // close the bill first by paying the zero total via direct SQL — emulate paid status
    await adminPool.query(`UPDATE platform_pos.bills SET status='paid' WHERE id=$1`, [b.id])
    await expect(addItem(ctx(), b.id, { sku: 'X', name: 'X', qty: 1, unitPriceCents: 100 })).rejects.toThrow(ConflictError)
  })
})

describe('full payment flow', () => {
  it('full single payment marks bill paid and emits pos.bill.paid', async () => {
    const b = await openBill(ctx(), { tableCode: 'T1' })
    await addItem(ctx(), b.id, { sku: 'X', name: 'X', qty: 1, unitPriceCents: 1000 })

    const sub = new Redis(process.env.REDIS_URL)
    const events = []
    await sub.subscribe('platform.events')
    sub.on('message', (_c, raw) => { try { events.push(JSON.parse(raw)) } catch {} })
    await new Promise((r) => setTimeout(r, 50))

    try {
      // total = 1000 + 10% tax = 1100
      const final = await payBill(ctx(), b.id, { method: 'card', amountCents: 1100 })
      expect(final.status).toBe('paid')

      const deadline = Date.now() + 2000
      while (Date.now() < deadline && !events.some((e) => e.type === 'pos.bill.paid')) {
        await new Promise((r) => setTimeout(r, 50))
      }
      const paidEvt = events.find((e) => e.type === 'pos.bill.paid' && e.payload.billId === b.id)
      expect(paidEvt).toBeTruthy()
      expect(Number(paidEvt.payload.totalCents)).toBe(1100)
    } finally {
      sub.disconnect()
    }
  })

  it('partial payments accumulate; bill closes when sum matches', async () => {
    const b = await openBill(ctx(), {})
    await addItem(ctx(), b.id, { sku: 'X', name: 'X', qty: 1, unitPriceCents: 1000 })

    let r1 = await payBill(ctx(), b.id, { method: 'cash', amountCents: 600 })
    expect(r1.status).toBe('open')
    let r2 = await payBill(ctx(), b.id, { method: 'card', amountCents: 500 })  // 1100 total
    expect(r2.status).toBe('paid')
  })
})

describe('split bill', () => {
  it('equal split distributes amount with rounding remainder', async () => {
    const b = await openBill(ctx(), {})
    await addItem(ctx(), b.id, { sku: 'X', name: 'X', qty: 1, unitPriceCents: 912 })  // total = 1003

    const splits = await splitBill(ctx(), b.id, 'equal', { shares: 3 })
    expect(splits.map((s) => Number(s.amount_cents))).toEqual([335, 334, 334])

    // pay each split — bill is fully paid only after the last one
    let r = await payBill(ctx(), b.id, { method: 'card', amountCents: 335, splitId: splits[0].id })
    expect(r.status).toBe('split')
    r = await payBill(ctx(), b.id, { method: 'card', amountCents: 334, splitId: splits[1].id })
    expect(r.status).toBe('split')
    r = await payBill(ctx(), b.id, { method: 'cash', amountCents: 334, splitId: splits[2].id })
    expect(r.status).toBe('paid')
  })

  it('amounts split rejects mismatched sum', async () => {
    const b = await openBill(ctx(), {})
    await addItem(ctx(), b.id, { sku: 'X', name: 'X', qty: 1, unitPriceCents: 1000 })  // total 1100
    await expect(splitBill(ctx(), b.id, 'amounts', { amountsCents: [500, 500] })).rejects.toThrow(ValidationError)
  })

  it('percent split must sum to 100', async () => {
    const b = await openBill(ctx(), {})
    await addItem(ctx(), b.id, { sku: 'X', name: 'X', qty: 1, unitPriceCents: 1000 })
    await expect(splitBill(ctx(), b.id, 'percent', { percents: [40, 40] })).rejects.toThrow(ValidationError)
  })
})

describe('close bill', () => {
  it('rejects close on open bill', async () => {
    const b = await openBill(ctx(), {})
    await expect(closeBill(ctx(), b.id)).rejects.toThrow(ConflictError)
  })

  it('closes a paid bill and emits pos.bill.closed', async () => {
    const b = await openBill(ctx(), {})
    await addItem(ctx(), b.id, { sku: 'X', name: 'X', qty: 1, unitPriceCents: 1000 })
    await payBill(ctx(), b.id, { method: 'card', amountCents: 1100 })

    const sub = new Redis(process.env.REDIS_URL)
    const events = []
    await sub.subscribe('platform.events')
    sub.on('message', (_c, raw) => { try { events.push(JSON.parse(raw)) } catch {} })
    await new Promise((r) => setTimeout(r, 50))

    try {
      const closed = await closeBill(ctx(), b.id)
      expect(closed.status).toBe('closed')
      const deadline = Date.now() + 2000
      while (Date.now() < deadline && !events.some((e) => e.type === 'pos.bill.closed')) {
        await new Promise((r) => setTimeout(r, 50))
      }
      expect(events.find((e) => e.type === 'pos.bill.closed' && e.payload.billId === b.id)).toBeTruthy()
    } finally {
      sub.disconnect()
    }
  })
})

describe('listBills', () => {
  it('filters by status', async () => {
    const b1 = await openBill(ctx(), { tableCode: 'A' })
    const b2 = await openBill(ctx(), { tableCode: 'B' })
    await addItem(ctx(), b1.id, { sku: 'X', name: 'X', qty: 1, unitPriceCents: 100 })
    await payBill(ctx(), b1.id, { method: 'cash', amountCents: 110 })

    const open = await listBills(ctx(), { status: 'open' })
    expect(open.find((x) => x.id === b2.id)).toBeTruthy()
    expect(open.find((x) => x.id === b1.id)).toBeFalsy()
  })
})

describe('getBill', () => {
  it('returns bill with items, payments, splits', async () => {
    const b = await openBill(ctx(), {})
    await addItem(ctx(), b.id, { sku: 'X', name: 'X', qty: 1, unitPriceCents: 1000 })
    const splits = await splitBill(ctx(), b.id, 'equal', { shares: 2 })
    const full = await getBill(ctx(), b.id)
    expect(full.items).toHaveLength(1)
    expect(full.splits).toHaveLength(2)
    expect(full.splits[0].id).toBe(splits[0].id)
  })
})

describe('tenant isolation', () => {
  it('listBills only returns bills for the calling tenant', async () => {
    const T2 = '00000000-0000-0000-0000-0000000000e2'
    await openBill(ctx(), { tableCode: 'mine' })
    await openBill(ctx({ tenantId: T2 }), { tableCode: 'other' })
    const list = await listBills(ctx(), {})
    expect(list.every((b) => b.tenant_id === TENANT_ID)).toBe(true)
    await adminPool.query(`DELETE FROM platform_pos.bills WHERE app_id = $1 AND tenant_id = $2`, [APP_ID, T2])
  })
})
