// Regla CLAUDE.md #3 aplicada a orders: POST /orders con misma
// idempotencyKey NO crea segundo order. La 2ª llamada devuelve el
// mismo row (no un duplicate paid en Stripe / inventory).

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
vi.mock('../repositories/orders.repository.js')

import * as service from '../services/orders.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/orders.repository.js'

const ctx = { appId: 'aikikan', tenantId: '00000000-0000-0000-0000-000000000001', subTenantId: null, userId: 'u1', role: 'buyer' }
const items = [{ sku: 'X', productName: 'Prod X', qty: 2, unitPriceCents: 1000 }]

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
})

describe('createOrder — idempotencyKey', () => {
  it('1ª llamada (key no existe): crea el order, inserta items, publish order.created', async () => {
    repo.findOrderByIdempotencyKey.mockResolvedValue(null)
    repo.insertOrder.mockResolvedValue({ id: 'order-1' })
    repo.findOrderById.mockResolvedValue({ id: 'order-1', status: 'pending' })
    repo.findItemsByOrderId.mockResolvedValue(items)
    repo.findAddressesByOrderId.mockResolvedValue([])
    repo.findHistoryByOrderId.mockResolvedValue([])

    await service.createOrder(ctx, { currency: 'EUR', items, idempotencyKey: 'idem-A' })

    expect(repo.insertOrder).toHaveBeenCalledTimes(1)
    expect(repo.insertItems).toHaveBeenCalledTimes(1)
    expect(repo.recordStatusChange).toHaveBeenCalledWith(
      expect.anything(), 'order-1', ctx.appId, ctx.tenantId,
      null, 'pending', expect.any(Object), 'order created',
    )
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'order.created',
        payload: expect.objectContaining({ orderId: 'order-1' }),
      }),
    )
  })

  it('2ª llamada con MISMA idempotencyKey: NO crea otro order, devuelve el existente', async () => {
    repo.findOrderByIdempotencyKey.mockResolvedValue({ id: 'order-1' })
    repo.findOrderById.mockResolvedValue({ id: 'order-1', status: 'pending' })
    repo.findItemsByOrderId.mockResolvedValue(items)
    repo.findAddressesByOrderId.mockResolvedValue([])
    repo.findHistoryByOrderId.mockResolvedValue([])

    const r = await service.createOrder(ctx, { currency: 'EUR', items, idempotencyKey: 'idem-A' })

    expect(repo.insertOrder).not.toHaveBeenCalled()
    expect(repo.insertItems).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
    expect(r.id).toBe('order-1')
  })

  it('sin idempotencyKey: cada llamada crea un order nuevo (no es idempotente por defecto)', async () => {
    repo.findOrderByIdempotencyKey.mockResolvedValue(null)
    repo.insertOrder
      .mockResolvedValueOnce({ id: 'order-A' })
      .mockResolvedValueOnce({ id: 'order-B' })
    repo.findOrderById.mockImplementation(async (_, _a, _t, id) => ({ id, status: 'pending' }))
    repo.findItemsByOrderId.mockResolvedValue(items)
    repo.findAddressesByOrderId.mockResolvedValue([])
    repo.findHistoryByOrderId.mockResolvedValue([])

    const r1 = await service.createOrder(ctx, { currency: 'EUR', items })
    const r2 = await service.createOrder(ctx, { currency: 'EUR', items })

    expect(r1.id).toBe('order-A')
    expect(r2.id).toBe('order-B')
    expect(repo.insertOrder).toHaveBeenCalledTimes(2)
    expect(repo.findOrderByIdempotencyKey).not.toHaveBeenCalled()   // sin key NO se consulta
  })

  it('idempotencyKey lookup pasa el (appId, tenantId, key) — anti cross-tenant', async () => {
    repo.findOrderByIdempotencyKey.mockResolvedValue(null)
    repo.insertOrder.mockResolvedValue({ id: 'order-1' })
    repo.findOrderById.mockResolvedValue({ id: 'order-1', status: 'pending' })
    repo.findItemsByOrderId.mockResolvedValue([])
    repo.findAddressesByOrderId.mockResolvedValue([])
    repo.findHistoryByOrderId.mockResolvedValue([])

    await service.createOrder(ctx, { currency: 'EUR', items, idempotencyKey: 'idem-X' })

    expect(repo.findOrderByIdempotencyKey).toHaveBeenCalledWith(
      expect.anything(), ctx.appId, ctx.tenantId, 'idem-X',
    )
  })

  it('la idempotencyKey se persiste en el row (para que el lookup en futuras llamadas funcione)', async () => {
    repo.findOrderByIdempotencyKey.mockResolvedValue(null)
    repo.insertOrder.mockResolvedValue({ id: 'order-1' })
    repo.findOrderById.mockResolvedValue({ id: 'order-1', status: 'pending' })
    repo.findItemsByOrderId.mockResolvedValue([])
    repo.findAddressesByOrderId.mockResolvedValue([])
    repo.findHistoryByOrderId.mockResolvedValue([])

    await service.createOrder(ctx, { currency: 'EUR', items, idempotencyKey: 'idem-Y' })

    expect(repo.insertOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ idempotencyKey: 'idem-Y' }),
    )
  })
})
