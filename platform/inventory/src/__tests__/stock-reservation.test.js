// Race condition guard: reserveItem llama a repo.reserve que en la
// implementación real hace `UPDATE … WHERE qty_on_hand - qty_reserved >= $qty`
// (atómico SQL — la DB resuelve la concurrencia con un único row lock).
// Si la UPDATE no afecta filas (stock insuficiente), repo.reserve devuelve
// null y el service lanza ConflictError.
//
// Aquí cubrimos el contrato del SERVICE: 2 reservas simultáneas con qty
// total > stock → solo una gana, la otra recibe ConflictError. La parte
// SQL (FOR UPDATE) se cubre en integration.

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
vi.mock('../lib/redis.js', () => ({ publish: vi.fn() }))
vi.mock('../repositories/inventory.repository.js')

import { reserveItem, releaseItem, commitItem } from '../services/inventory.service.js'
import { withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/inventory.repository.js'

const ctx = { appId: 'shop', tenantId: '00000000-0000-0000-0000-000000000001', subTenantId: null, userId: 'u1' }

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
})

// ── reserve ──────────────────────────────────────────────────────────

describe('reserveItem — happy path', () => {
  it('si hay stock, repo.reserve devuelve la fila actualizada y movement queda registrado', async () => {
    repo.reserve.mockResolvedValue({ qty_on_hand: 10, qty_reserved: 3 })
    const r = await reserveItem(ctx, { sku: 'SKU-A', qty: 2, refType: 'order', refId: 'o1' })

    expect(repo.reserve).toHaveBeenCalledWith(expect.anything(), ctx.appId, ctx.tenantId, 'SKU-A', 2)
    expect(repo.recordMovement).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      sku: 'SKU-A', reason: 'reserve', delta: 0, refType: 'order', refId: 'o1',
    }))
    expect(r.qty_reserved).toBe(3)
  })
})

describe('reserveItem — race condition guard', () => {
  it('si repo.reserve devuelve null Y el SKU no existe → NotFoundError', async () => {
    repo.reserve.mockResolvedValue(null)
    repo.findBySku.mockResolvedValue(null)
    await expect(reserveItem(ctx, { sku: 'ghost', qty: 1 })).rejects.toMatchObject({ statusCode: 404 })
    expect(repo.recordMovement).not.toHaveBeenCalled()
  })

  it('si repo.reserve devuelve null Y el SKU existe pero sin stock → ConflictError con detalle', async () => {
    repo.reserve.mockResolvedValue(null)   // UPDATE no afectó filas → race lost
    repo.findBySku.mockResolvedValue({ qty_on_hand: 5, qty_reserved: 4 })  // available=1
    await expect(reserveItem(ctx, { sku: 'SKU-B', qty: 3 })).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('insufficient stock'),
    })
    expect(repo.recordMovement).not.toHaveBeenCalled()
  })

  it('2 reservas concurrentes con stock=10 cada una pide 7 — solo una gana (la otra ConflictError)', async () => {
    // Simulamos atomicidad de repo.reserve: la primera gana, la segunda recibe null.
    repo.reserve
      .mockResolvedValueOnce({ qty_on_hand: 10, qty_reserved: 7 })   // 1ª gana
      .mockResolvedValueOnce(null)                                   // 2ª pierde
    repo.findBySku.mockResolvedValue({ qty_on_hand: 10, qty_reserved: 7 })

    const [r1, r2] = await Promise.allSettled([
      reserveItem(ctx, { sku: 'SKU-C', qty: 7 }),
      reserveItem(ctx, { sku: 'SKU-C', qty: 7 }),
    ])

    expect(r1.status).toBe('fulfilled')
    expect(r2.status).toBe('rejected')
    expect(r2.reason.statusCode).toBe(409)
  })
})

// ── release ──────────────────────────────────────────────────────────

describe('releaseItem', () => {
  it('libera la reserva y registra el movement (reason="release")', async () => {
    repo.release.mockResolvedValue({ qty_on_hand: 10, qty_reserved: 1 })
    await releaseItem(ctx, { sku: 'SKU-A', qty: 2, refType: 'order', refId: 'o1' })
    expect(repo.release).toHaveBeenCalledWith(expect.anything(), ctx.appId, ctx.tenantId, 'SKU-A', 2)
    expect(repo.recordMovement).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      reason: 'release', delta: 0,
    }))
  })

  it('SKU desconocido → NotFoundError', async () => {
    repo.release.mockResolvedValue(null)
    await expect(releaseItem(ctx, { sku: 'ghost', qty: 1 })).rejects.toMatchObject({ statusCode: 404 })
  })
})

// ── commit ───────────────────────────────────────────────────────────

describe('commitItem — convierte reserva en venta efectiva', () => {
  it('commit decrementa qty_on_hand, registra delta=-qty con reason="commit"', async () => {
    repo.commit.mockResolvedValue({ qty_on_hand: 8, qty_reserved: 0, low_stock_threshold: 5 })
    await commitItem(ctx, { sku: 'SKU-A', qty: 2 })
    expect(repo.recordMovement).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      reason: 'commit', delta: -2,
    }))
  })

  it('al cruzar low_stock_threshold publica inventory.depleted', async () => {
    repo.commit.mockResolvedValue({ qty_on_hand: 3, qty_reserved: 0, low_stock_threshold: 5 })
    const { publish } = await import('../lib/redis.js')
    await commitItem(ctx, { sku: 'SKU-A', qty: 1 })
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'inventory.depleted',
        payload: expect.objectContaining({ sku: 'SKU-A', qtyOnHand: 3, threshold: 5 }),
      }),
    )
  })

  it('por encima del threshold NO publica inventory.depleted', async () => {
    repo.commit.mockResolvedValue({ qty_on_hand: 50, qty_reserved: 0, low_stock_threshold: 5 })
    const { publish } = await import('../lib/redis.js')
    await commitItem(ctx, { sku: 'SKU-A', qty: 1 })
    expect(publish).not.toHaveBeenCalled()
  })

  it('SKU inexistente o stock insuficiente → NotFoundError', async () => {
    repo.commit.mockResolvedValue(null)
    await expect(commitItem(ctx, { sku: 'no', qty: 1 })).rejects.toMatchObject({ statusCode: 404 })
  })
})
