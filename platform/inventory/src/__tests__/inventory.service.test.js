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
vi.mock('../repositories/inventory.repository.js')

import * as service from '../services/inventory.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/inventory.repository.js'
import { ConflictError, NotFoundError } from '@apphub/platform-sdk/errors'

const APP_ID    = 'yoga-studio'
const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const ORDER_ID  = '11111111-1111-1111-1111-111111111111'
const USER_ID   = '22222222-2222-2222-2222-222222222222'

const ctx = { appId: APP_ID, tenantId: TENANT_ID, subTenantId: null, userId: USER_ID, role: 'admin' }

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
})

// ── upsertItem ────────────────────────────────────────────────────────
describe('upsertItem', () => {
  it('inserts new item, records movement, publishes inventory.adjusted', async () => {
    repo.findBySku.mockResolvedValue(null)
    repo.upsert.mockResolvedValue({ sku: 'X', qty_on_hand: 10, low_stock_threshold: 0 })
    repo.recordMovement.mockResolvedValue()
    await service.upsertItem(ctx, { sku: 'X', qtyOnHand: 10 })
    expect(repo.recordMovement).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      sku: 'X', delta: 10, reason: 'adjust',
    }))
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'inventory.adjusted' }))
  })

  it('updates existing item — delta is the diff', async () => {
    repo.findBySku.mockResolvedValue({ sku: 'X', qty_on_hand: 5 })
    repo.upsert.mockResolvedValue({ sku: 'X', qty_on_hand: 8, low_stock_threshold: 0 })
    repo.recordMovement.mockResolvedValue()
    await service.upsertItem(ctx, { sku: 'X', qtyOnHand: 8 })
    expect(repo.recordMovement).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ delta: 3 }))
  })

  it('skips movement when qty unchanged', async () => {
    repo.findBySku.mockResolvedValue({ sku: 'X', qty_on_hand: 5 })
    repo.upsert.mockResolvedValue({ sku: 'X', qty_on_hand: 5, low_stock_threshold: 0 })
    await service.upsertItem(ctx, { sku: 'X', qtyOnHand: 5 })
    expect(repo.recordMovement).not.toHaveBeenCalled()
  })
})

// ── reserve / release / commit ────────────────────────────────────────
describe('reserveItem', () => {
  it('reserves and records movement', async () => {
    repo.reserve.mockResolvedValue({ sku: 'X', qty_on_hand: 10, qty_reserved: 2 })
    repo.recordMovement.mockResolvedValue()
    await service.reserveItem(ctx, { sku: 'X', qty: 2, refType: 'order', refId: ORDER_ID })
    expect(repo.reserve).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, 'X', 2)
    expect(repo.recordMovement).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      sku: 'X', delta: 0, reason: 'reserve', refType: 'order', refId: ORDER_ID,
    }))
  })

  it('throws ConflictError when stock insufficient (item exists)', async () => {
    repo.reserve.mockResolvedValue(null)
    repo.findBySku.mockResolvedValue({ sku: 'X', qty_on_hand: 1, qty_reserved: 0 })
    await expect(service.reserveItem(ctx, { sku: 'X', qty: 5 })).rejects.toThrow(ConflictError)
  })

  it('throws NotFoundError when item missing', async () => {
    repo.reserve.mockResolvedValue(null)
    repo.findBySku.mockResolvedValue(null)
    await expect(service.reserveItem(ctx, { sku: 'X', qty: 1 })).rejects.toThrow(NotFoundError)
  })
})

describe('releaseItem', () => {
  it('releases and records movement', async () => {
    repo.release.mockResolvedValue({ sku: 'X', qty_reserved: 0 })
    repo.recordMovement.mockResolvedValue()
    await service.releaseItem(ctx, { sku: 'X', qty: 2 })
    expect(repo.release).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, 'X', 2)
    expect(repo.recordMovement).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reason: 'release' }))
  })

  it('throws NotFoundError when item missing', async () => {
    repo.release.mockResolvedValue(null)
    await expect(service.releaseItem(ctx, { sku: 'X', qty: 1 })).rejects.toThrow(NotFoundError)
  })
})

describe('commitItem', () => {
  it('commits, records movement, publishes inventory.depleted when at/below threshold', async () => {
    repo.findBySku.mockResolvedValue({ sku: 'X', qty_on_hand: 10 })
    repo.commit.mockResolvedValue({ sku: 'X', qty_on_hand: 1, low_stock_threshold: 5 })
    repo.recordMovement.mockResolvedValue()
    await service.commitItem(ctx, { sku: 'X', qty: 9 })
    expect(repo.commit).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, 'X', 9)
    expect(repo.recordMovement).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      reason: 'commit', delta: -9,
    }))
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'inventory.depleted',
      payload: expect.objectContaining({ sku: 'X', qtyOnHand: 1, threshold: 5 }),
    }))
  })

  it('does NOT publish inventory.depleted when above threshold', async () => {
    repo.findBySku.mockResolvedValue({ sku: 'X', qty_on_hand: 51 })
    repo.commit.mockResolvedValue({ sku: 'X', qty_on_hand: 50, low_stock_threshold: 5 })
    repo.recordMovement.mockResolvedValue()
    await service.commitItem(ctx, { sku: 'X', qty: 1 })
    expect(publish).not.toHaveBeenCalled()
  })

  it('publishes inventory.out_of_stock (not depleted) when on-hand hits 0', async () => {
    repo.findBySku.mockResolvedValue({ sku: 'X', qty_on_hand: 2 })
    repo.commit.mockResolvedValue({ sku: 'X', qty_on_hand: 0, low_stock_threshold: 5 })
    repo.recordMovement.mockResolvedValue()
    await service.commitItem(ctx, { sku: 'X', qty: 2 })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'inventory.out_of_stock' }))
    expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'inventory.depleted' }))
  })

  it('throws NotFoundError when commit returns null', async () => {
    repo.findBySku.mockResolvedValue({ sku: 'X', qty_on_hand: 0 })
    repo.commit.mockResolvedValue(null)
    await expect(service.commitItem(ctx, { sku: 'X', qty: 1 })).rejects.toThrow(NotFoundError)
  })
})

// ── restockItem (reverse commit) ──────────────────────────────────────
describe('restockItem', () => {
  it('increments on-hand, records movement with given reason, publishes adjusted', async () => {
    repo.findBySku.mockResolvedValue({ sku: 'X', qty_on_hand: 3, low_stock_threshold: 0 })
    repo.adjustOnHand.mockResolvedValue({ sku: 'X', qty_on_hand: 5, low_stock_threshold: 0 })
    repo.recordMovement.mockResolvedValue()
    await service.restockItem(ctx, { sku: 'X', qty: 2, reason: 'return', refType: 'order', refId: ORDER_ID })
    expect(repo.adjustOnHand).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, 'X', 2)
    expect(repo.recordMovement).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      delta: 2, reason: 'return', refType: 'order', refId: ORDER_ID,
    }))
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'inventory.adjusted' }))
  })

  it('publishes back_in_stock when on-hand goes 0 → positive', async () => {
    repo.findBySku.mockResolvedValue({ sku: 'X', qty_on_hand: 0, low_stock_threshold: 0 })
    repo.adjustOnHand.mockResolvedValue({ sku: 'X', qty_on_hand: 4, low_stock_threshold: 0 })
    repo.recordMovement.mockResolvedValue()
    await service.restockItem(ctx, { sku: 'X', qty: 4 })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'inventory.back_in_stock' }))
  })

  it('defaults reason to restock', async () => {
    repo.findBySku.mockResolvedValue({ sku: 'X', qty_on_hand: 1, low_stock_threshold: 0 })
    repo.adjustOnHand.mockResolvedValue({ sku: 'X', qty_on_hand: 2, low_stock_threshold: 0 })
    repo.recordMovement.mockResolvedValue()
    await service.restockItem(ctx, { sku: 'X', qty: 1 })
    expect(repo.recordMovement).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reason: 'restock' }))
  })

  it('throws NotFoundError when item missing', async () => {
    repo.findBySku.mockResolvedValue(null)
    await expect(service.restockItem(ctx, { sku: 'X', qty: 1 })).rejects.toThrow(NotFoundError)
  })

  it('throws ConflictError on non-positive qty', async () => {
    await expect(service.restockItem(ctx, { sku: 'X', qty: 0 })).rejects.toThrow(ConflictError)
  })
})

// ── listMovements ─────────────────────────────────────────────────────
describe('listMovements', () => {
  it('delegates to repo when item exists', async () => {
    repo.findBySku.mockResolvedValue({ sku: 'X' })
    repo.listMovements.mockResolvedValue([{ id: 'm1' }])
    const r = await service.listMovements(ctx, 'X', { reason: 'commit' })
    expect(repo.listMovements).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, 'X', { reason: 'commit' })
    expect(r).toEqual([{ id: 'm1' }])
  })

  it('throws NotFoundError when item missing', async () => {
    repo.findBySku.mockResolvedValue(null)
    await expect(service.listMovements(ctx, 'NOPE', {})).rejects.toThrow(NotFoundError)
  })
})

// ── handleOrderEvent ─────────────────────────────────────────────────
describe('handleOrderEvent', () => {
  it('order.created → reserves each item', async () => {
    repo.reserve.mockResolvedValue({ sku: 'X', qty_on_hand: 10, qty_reserved: 1 })
    repo.recordMovement.mockResolvedValue()
    await service.handleOrderEvent({
      type: 'order.created',
      payload: { appId: APP_ID, tenantId: TENANT_ID, orderId: ORDER_ID, items: [{ sku: 'X', qty: 1 }, { sku: 'Y', qty: 2 }] },
    })
    expect(repo.reserve).toHaveBeenCalledTimes(2)
  })

  it('order.paid → commits each item', async () => {
    repo.commit.mockResolvedValue({ sku: 'X', qty_on_hand: 9, low_stock_threshold: 0 })
    repo.recordMovement.mockResolvedValue()
    await service.handleOrderEvent({
      type: 'order.paid',
      payload: { appId: APP_ID, tenantId: TENANT_ID, orderId: ORDER_ID, items: [{ sku: 'X', qty: 1 }] },
    })
    expect(repo.commit).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, 'X', 1)
  })

  it('order.cancelled → releases each item', async () => {
    repo.release.mockResolvedValue({ sku: 'X', qty_reserved: 0 })
    repo.recordMovement.mockResolvedValue()
    await service.handleOrderEvent({
      type: 'order.cancelled',
      payload: { appId: APP_ID, tenantId: TENANT_ID, orderId: ORDER_ID, items: [{ sku: 'X', qty: 1 }] },
    })
    expect(repo.release).toHaveBeenCalled()
  })

  it('order.returned → restocks (reverse commit) each item', async () => {
    repo.findBySku.mockResolvedValue({ sku: 'X', qty_on_hand: 2, low_stock_threshold: 0 })
    repo.adjustOnHand.mockResolvedValue({ sku: 'X', qty_on_hand: 5, low_stock_threshold: 0 })
    repo.recordMovement.mockResolvedValue()
    await service.handleOrderEvent({
      type: 'order.returned',
      payload: { appId: APP_ID, tenantId: TENANT_ID, orderId: ORDER_ID, items: [{ sku: 'X', qty: 3 }] },
    })
    expect(repo.adjustOnHand).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, 'X', 3)
    expect(repo.recordMovement).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reason: 'return' }))
  })

  it('skips when items missing', async () => {
    await service.handleOrderEvent({ type: 'order.created', payload: { appId: APP_ID, tenantId: TENANT_ID } })
    expect(repo.reserve).not.toHaveBeenCalled()
  })

  it('continues on per-item errors (logged & swallowed)', async () => {
    repo.reserve
      .mockResolvedValueOnce(null)         // first item fails
      .mockResolvedValueOnce({ sku: 'Y' }) // second succeeds
    repo.findBySku.mockResolvedValue({ sku: 'X', qty_on_hand: 1, qty_reserved: 1 })
    repo.recordMovement.mockResolvedValue()
    await service.handleOrderEvent({
      type: 'order.created',
      payload: { appId: APP_ID, tenantId: TENANT_ID, orderId: ORDER_ID, items: [{ sku: 'X', qty: 5 }, { sku: 'Y', qty: 1 }] },
    })
    expect(repo.reserve).toHaveBeenCalledTimes(2)
  })
})

// ── getItem / listItems ──────────────────────────────────────────────
describe('getItem / listItems', () => {
  it('getItem delegates to repository', async () => {
    repo.findBySku.mockResolvedValue({ sku: 'X', qty_on_hand: 5 })
    const r = await service.getItem(ctx, 'X')
    expect(repo.findBySku).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, 'X')
    expect(r.sku).toBe('X')
  })

  it('listItems passes pagination through', async () => {
    repo.listByTenant.mockResolvedValue([])
    await service.listItems(ctx, { limit: 10, offset: 0 })
    expect(repo.listByTenant).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, { limit: 10, offset: 0 })
  })
})
