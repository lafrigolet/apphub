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
vi.mock('../repositories/orders.repository.js')

import * as service from '../services/orders.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/orders.repository.js'
import { ConflictError, NotFoundError, ValidationError } from '@apphub/platform-sdk/errors'

const APP_ID    = 'yoga-studio'
const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const ORDER_ID  = '11111111-1111-1111-1111-111111111111'
const USER_ID   = '22222222-2222-2222-2222-222222222222'

const ctx = { appId: APP_ID, tenantId: TENANT_ID, subTenantId: null, userId: USER_ID, role: 'buyer' }

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
})

// ── createOrder ────────────────────────────────────────────────────────
describe('createOrder', () => {
  const items = [{ sku: 'X', productName: 'X', qty: 2, unitPriceCents: 1000 }]

  it('rejects empty items', async () => {
    await expect(service.createOrder(ctx, { currency: 'EUR', items: [] })).rejects.toThrow(ValidationError)
  })

  it('persists, computes totals, and publishes order.created', async () => {
    repo.findOrderByIdempotencyKey.mockResolvedValue(null)
    repo.insertOrder.mockResolvedValue({ id: ORDER_ID })
    repo.insertItems.mockResolvedValue()
    repo.insertAddress.mockResolvedValue()
    repo.recordStatusChange.mockResolvedValue()
    repo.findOrderById.mockResolvedValue({ id: ORDER_ID, status: 'pending' })
    repo.findItemsByOrderId.mockResolvedValue(items)
    repo.findAddressesByOrderId.mockResolvedValue([])
    repo.findHistoryByOrderId.mockResolvedValue([])

    const result = await service.createOrder(ctx, {
      currency: 'EUR', items, taxCents: 200, shippingCents: 100, idempotencyKey: 'key-1',
    })

    expect(repo.insertOrder).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      appId: APP_ID, tenantId: TENANT_ID, buyerUserId: USER_ID, status: 'pending',
      subtotalCents: 2000, taxCents: 200, shippingCents: 100, totalCents: 2300,
    }))
    expect(repo.recordStatusChange).toHaveBeenCalledWith(
      expect.anything(), ORDER_ID, APP_ID, TENANT_ID, null, 'pending',
      { userId: USER_ID, role: 'buyer' }, 'order created',
    )
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'order.created',
      payload: expect.objectContaining({ orderId: ORDER_ID, totalCents: 2300, currency: 'EUR' }),
    }))
    expect(result.id).toBe(ORDER_ID)
  })

  it('returns existing order when idempotency key matches (no-op insert)', async () => {
    repo.findOrderByIdempotencyKey.mockResolvedValue({ id: ORDER_ID })
    repo.findOrderById.mockResolvedValue({ id: ORDER_ID, status: 'paid' })
    repo.findItemsByOrderId.mockResolvedValue(items)
    repo.findAddressesByOrderId.mockResolvedValue([])
    repo.findHistoryByOrderId.mockResolvedValue([])

    const result = await service.createOrder(ctx, { currency: 'EUR', items, idempotencyKey: 'k' })
    expect(repo.insertOrder).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
    expect(result.id).toBe(ORDER_ID)
  })

  it('persists shipping and billing addresses when provided', async () => {
    repo.findOrderByIdempotencyKey.mockResolvedValue(null)
    repo.insertOrder.mockResolvedValue({ id: ORDER_ID })
    repo.findOrderById.mockResolvedValue({ id: ORDER_ID })
    repo.findItemsByOrderId.mockResolvedValue([])
    repo.findAddressesByOrderId.mockResolvedValue([])
    repo.findHistoryByOrderId.mockResolvedValue([])

    await service.createOrder(ctx, {
      currency: 'EUR', items,
      shippingAddress: { line1: 'A' }, billingAddress: { line1: 'B' },
    })
    expect(repo.insertAddress).toHaveBeenCalledWith(expect.anything(), ORDER_ID, APP_ID, TENANT_ID, expect.objectContaining({ kind: 'shipping' }))
    expect(repo.insertAddress).toHaveBeenCalledWith(expect.anything(), ORDER_ID, APP_ID, TENANT_ID, expect.objectContaining({ kind: 'billing' }))
  })
})

// ── getOrder / listOrders ──────────────────────────────────────────────
describe('getOrder / listOrders', () => {
  it('getOrder throws NotFoundError when missing', async () => {
    repo.findOrderById.mockResolvedValue(null)
    await expect(service.getOrder(ctx, ORDER_ID)).rejects.toThrow(NotFoundError)
  })

  it('getOrder returns order with items, addresses, history', async () => {
    repo.findOrderById.mockResolvedValue({ id: ORDER_ID })
    repo.findItemsByOrderId.mockResolvedValue([{ sku: 'X' }])
    repo.findAddressesByOrderId.mockResolvedValue([{ kind: 'shipping' }])
    repo.findHistoryByOrderId.mockResolvedValue([{ to_status: 'pending' }])
    const r = await service.getOrder(ctx, ORDER_ID)
    expect(r.items).toHaveLength(1)
    expect(r.addresses).toHaveLength(1)
    expect(r.history).toHaveLength(1)
  })

  it('listOrders passes filters through', async () => {
    repo.listOrders.mockResolvedValue([])
    await service.listOrders(ctx, { buyerUserId: USER_ID, status: 'paid' })
    expect(repo.listOrders).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, { buyerUserId: USER_ID, status: 'paid' })
  })
})

// ── changeStatus FSM ──────────────────────────────────────────────────
describe('changeStatus FSM', () => {
  it('pending → paid: publishes order.paid with items', async () => {
    repo.findOrderById.mockResolvedValue({ id: ORDER_ID, status: 'pending', total_cents: 1000, buyer_user_id: USER_ID })
    repo.updateStatus.mockResolvedValue({ id: ORDER_ID, status: 'paid' })
    repo.recordStatusChange.mockResolvedValue()
    repo.findItemsByOrderId.mockResolvedValue([{ sku: 'X', qty: 2 }])
    await service.changeStatus(ctx, ORDER_ID, 'paid')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'order.paid',
      payload: expect.objectContaining({ orderId: ORDER_ID, items: [{ sku: 'X', qty: 2 }] }),
    }))
  })

  it('paid → delivered (shortcut) is allowed', async () => {
    repo.findOrderById.mockResolvedValue({ id: ORDER_ID, status: 'paid', total_cents: 1000, buyer_user_id: USER_ID })
    repo.updateStatus.mockResolvedValue({ id: ORDER_ID, status: 'delivered' })
    repo.recordStatusChange.mockResolvedValue()
    repo.findItemsByOrderId.mockResolvedValue([])
    await service.changeStatus(ctx, ORDER_ID, 'delivered')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'order.delivered' }))
  })

  it('rejects invalid transition pending → delivered', async () => {
    repo.findOrderById.mockResolvedValue({ id: ORDER_ID, status: 'pending' })
    await expect(service.changeStatus(ctx, ORDER_ID, 'delivered')).rejects.toThrow(ConflictError)
  })

  it('rejects from terminal state cancelled', async () => {
    repo.findOrderById.mockResolvedValue({ id: ORDER_ID, status: 'cancelled' })
    await expect(service.changeStatus(ctx, ORDER_ID, 'paid')).rejects.toThrow(ConflictError)
  })

  it('throws NotFoundError when order missing', async () => {
    repo.findOrderById.mockResolvedValue(null)
    await expect(service.changeStatus(ctx, ORDER_ID, 'paid')).rejects.toThrow(NotFoundError)
  })

  it('cancelOrder is shorthand for changeStatus(..., cancelled)', async () => {
    repo.findOrderById.mockResolvedValue({ id: ORDER_ID, status: 'pending', total_cents: 0, buyer_user_id: USER_ID })
    repo.updateStatus.mockResolvedValue({ id: ORDER_ID, status: 'cancelled' })
    repo.recordStatusChange.mockResolvedValue()
    repo.findItemsByOrderId.mockResolvedValue([])
    await service.cancelOrder(ctx, ORDER_ID, 'buyer changed mind')
    expect(repo.updateStatus).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, ORDER_ID, 'cancelled')
  })

  it('refundOrder is shorthand for changeStatus(..., refunded)', async () => {
    repo.findOrderById.mockResolvedValue({ id: ORDER_ID, status: 'paid', total_cents: 0, buyer_user_id: USER_ID })
    repo.updateStatus.mockResolvedValue({ id: ORDER_ID, status: 'refunded' })
    repo.recordStatusChange.mockResolvedValue()
    repo.findItemsByOrderId.mockResolvedValue([])
    await service.refundOrder(ctx, ORDER_ID, 'broken item')
    expect(repo.updateStatus).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, ORDER_ID, 'refunded')
  })
})

// ── handleEvent ───────────────────────────────────────────────────────
describe('handleEvent', () => {
  it('splitpay.payment.completed → marks order paid', async () => {
    repo.findOrderById.mockResolvedValue({ id: ORDER_ID, status: 'pending', total_cents: 1000, buyer_user_id: USER_ID })
    repo.updateStatus.mockResolvedValue({ id: ORDER_ID, status: 'paid' })
    repo.recordStatusChange.mockResolvedValue()
    repo.findItemsByOrderId.mockResolvedValue([])
    await service.handleEvent({
      type: 'splitpay.payment.completed',
      payload: { appId: APP_ID, tenantId: TENANT_ID, orderId: ORDER_ID },
    })
    expect(repo.updateStatus).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, ORDER_ID, 'paid')
  })

  it('shipping.shipment.delivered → marks order delivered', async () => {
    repo.findOrderById.mockResolvedValue({ id: ORDER_ID, status: 'paid', total_cents: 0, buyer_user_id: USER_ID })
    repo.updateStatus.mockResolvedValue({ id: ORDER_ID, status: 'delivered' })
    repo.recordStatusChange.mockResolvedValue()
    repo.findItemsByOrderId.mockResolvedValue([])
    await service.handleEvent({
      type: 'shipping.shipment.delivered',
      payload: { appId: APP_ID, tenantId: TENANT_ID, orderId: ORDER_ID },
    })
    expect(repo.updateStatus).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, ORDER_ID, 'delivered')
  })

  it('swallows downstream errors', async () => {
    repo.findOrderById.mockRejectedValue(new Error('boom'))
    await expect(service.handleEvent({
      type: 'splitpay.payment.completed',
      payload: { appId: APP_ID, tenantId: TENANT_ID, orderId: ORDER_ID },
    })).resolves.toBeUndefined()
  })

  it('ignores unrelated event types', async () => {
    await service.handleEvent({ type: 'menu.published', payload: {} })
    expect(repo.updateStatus).not.toHaveBeenCalled()
  })
})
