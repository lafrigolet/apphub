// orders.service — modificaciones post-creación + handleEvent.
// Foco en código NO cubierto por orders.service.test.js / state-machine.test.js:
//
// changeShippingAddress:
//   - order no existe → 404.
//   - order en status no-mutable (shipped, delivered, cancelled, refunded) → 409.
//   - happy: replace + INSERT order_modifications con type='shipping_address_changed' +
//     publish 'order.modified'.
//
// addOrderNote:
//   - order no existe → 404.
//   - INSERT modification con type='note_added', before=null, after={note}.
//   - NO publica order.modified (las notas son internas, no notifican al comprador).
//
// listModifications:
//   - 404 si order no existe.
//   - delega al repo.
//
// handleEvent:
//   - splitpay.payment.completed → changeStatus(..., 'paid').
//   - shipping.shipment.delivered → changeStatus(..., 'delivered').
//   - tipos desconocidos → no-op.
//   - errores en changeStatus se loguean sin propagar.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTenantTransaction: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn() }))
vi.mock('../repositories/orders.repository.js')

import {
  changeShippingAddress, addOrderNote, listModifications, handleEvent,
} from '../services/orders.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/orders.repository.js'

const ctx = { appId: 'shop', tenantId: 't1', subTenantId: null, userId: 'staff-1', role: 'admin' }
const ORDER = 'ord-1'

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn({ query: vi.fn().mockResolvedValue({ rows: [] }) }))
})

// ── changeShippingAddress ───────────────────────────────────────────

describe('changeShippingAddress', () => {
  it('order no existe → NotFoundError 404', async () => {
    repo.findOrderById.mockResolvedValue(null)
    await expect(changeShippingAddress(ctx, 'ghost', { line1: 'X' }, 'reason'))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it.each([['shipped'], ['delivered'], ['cancelled'], ['refunded']])(
    'order en status="%s" → ConflictError 409',
    async (status) => {
      repo.findOrderById.mockResolvedValue({ id: ORDER, status, buyer_user_id: 'b1' })
      await expect(changeShippingAddress(ctx, ORDER, { line1: 'X' }))
        .rejects.toMatchObject({
          statusCode: 409, message: expect.stringContaining(`status ${status}`),
        })
      expect(repo.replaceShippingAddress).not.toHaveBeenCalled()
    },
  )

  it.each([['pending'], ['paid']])('order mutable "%s" → happy', async (status) => {
    repo.findOrderById.mockResolvedValue({ id: ORDER, status, buyer_user_id: 'b1' })
    repo.findShippingAddress.mockResolvedValue({ line1: 'Old St' })
    repo.insertModification.mockResolvedValue({ id: 'mod-1' })
    await changeShippingAddress(ctx, ORDER, { line1: 'New St', city: 'Madrid' }, 'buyer requested')
    expect(repo.replaceShippingAddress).toHaveBeenCalledWith(
      expect.anything(), ctx.appId, ctx.tenantId, ORDER, { line1: 'New St', city: 'Madrid' },
    )
  })

  it('happy: INSERT modification con before + after + actor + type', async () => {
    repo.findOrderById.mockResolvedValue({ id: ORDER, status: 'paid', buyer_user_id: 'b1' })
    repo.findShippingAddress.mockResolvedValue({ line1: 'Old' })
    repo.insertModification.mockResolvedValue({ id: 'mod-1' })
    await changeShippingAddress(ctx, ORDER, { line1: 'New' }, 'typo fix')
    expect(repo.insertModification).toHaveBeenCalledWith(expect.anything(), {
      appId: ctx.appId, tenantId: ctx.tenantId, orderId: ORDER,
      type: 'shipping_address_changed',
      before: { line1: 'Old' }, after: { line1: 'New' },
      reason: 'typo fix',
      actorUserId: ctx.userId, actorRole: ctx.role,
    })
  })

  it('publish order.modified con modificationType + modificationId', async () => {
    repo.findOrderById.mockResolvedValue({ id: ORDER, status: 'pending', buyer_user_id: 'b1' })
    repo.findShippingAddress.mockResolvedValue(null)
    repo.insertModification.mockResolvedValue({ id: 'mod-42' })
    await changeShippingAddress(ctx, ORDER, { line1: 'X' })
    expect(publish).toHaveBeenCalledWith({
      type: 'order.modified',
      payload: {
        appId: ctx.appId, tenantId: ctx.tenantId, orderId: ORDER,
        buyerUserId: 'b1',
        modificationType: 'shipping_address_changed', modificationId: 'mod-42',
      },
    })
  })
})

// ── addOrderNote ────────────────────────────────────────────────────

describe('addOrderNote', () => {
  it('order no existe → NotFoundError', async () => {
    repo.findOrderById.mockResolvedValue(null)
    await expect(addOrderNote(ctx, 'ghost', 'Some note')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('happy: INSERT modification type=note_added; before=null, after={note}', async () => {
    repo.findOrderById.mockResolvedValue({ id: ORDER, status: 'paid' })
    repo.insertModification.mockResolvedValue({ id: 'mod-1' })
    await addOrderNote(ctx, ORDER, 'Customer called about delay')
    expect(repo.insertModification).toHaveBeenCalledWith(expect.anything(), {
      appId: ctx.appId, tenantId: ctx.tenantId, orderId: ORDER,
      type: 'note_added',
      before: null, after: { note: 'Customer called about delay' },
      actorUserId: ctx.userId, actorRole: ctx.role,
    })
  })

  it('NO publica order.modified (notas son internas)', async () => {
    repo.findOrderById.mockResolvedValue({ id: ORDER, status: 'paid' })
    repo.insertModification.mockResolvedValue({ id: 'mod-1' })
    await addOrderNote(ctx, ORDER, 'note')
    expect(publish).not.toHaveBeenCalled()
  })

  it('notas se aceptan en CUALQUIER status (incluyendo terminales)', async () => {
    repo.findOrderById.mockResolvedValue({ id: ORDER, status: 'cancelled' })
    repo.insertModification.mockResolvedValue({ id: 'mod-1' })
    await expect(addOrderNote(ctx, ORDER, 'audit trail')).resolves.toBeDefined()
  })
})

// ── listModifications ──────────────────────────────────────────────

describe('listModifications', () => {
  it('order no existe → NotFoundError', async () => {
    repo.findOrderById.mockResolvedValue(null)
    await expect(listModifications(ctx, 'ghost')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('happy: delega al repo', async () => {
    repo.findOrderById.mockResolvedValue({ id: ORDER })
    repo.listModifications.mockResolvedValue([{ id: 'mod-1' }, { id: 'mod-2' }])
    const r = await listModifications(ctx, ORDER)
    expect(r).toHaveLength(2)
  })
})

// ── handleEvent ──────────────────────────────────────────────────────

describe('handleEvent', () => {
  it('splitpay.payment.completed → changeStatus(..., paid)', async () => {
    repo.findOrderById.mockResolvedValue({ id: ORDER, status: 'pending', buyer_user_id: 'b1', total_cents: 1000, currency: 'eur' })
    repo.updateStatus.mockResolvedValue({})
    repo.findItemsByOrderId.mockResolvedValue([])
    await handleEvent({
      type: 'splitpay.payment.completed',
      payload: { appId: 'shop', tenantId: 't1', orderId: ORDER },
    })
    expect(repo.updateStatus).toHaveBeenCalledWith(expect.anything(), 'shop', 't1', ORDER, 'paid')
  })

  it('shipping.shipment.delivered → changeStatus(..., delivered)', async () => {
    repo.findOrderById.mockResolvedValue({ id: ORDER, status: 'shipped', buyer_user_id: 'b1', total_cents: 1000, currency: 'eur' })
    repo.updateStatus.mockResolvedValue({})
    repo.findItemsByOrderId.mockResolvedValue([])
    await handleEvent({
      type: 'shipping.shipment.delivered',
      payload: { appId: 'shop', tenantId: 't1', orderId: ORDER },
    })
    expect(repo.updateStatus).toHaveBeenCalledWith(expect.anything(), 'shop', 't1', ORDER, 'delivered')
  })

  it('eventos desconocidos → no-op', async () => {
    await handleEvent({ type: 'random.event', payload: {} })
    expect(repo.findOrderById).not.toHaveBeenCalled()
  })

  it('event sin orderId → no-op', async () => {
    await handleEvent({ type: 'splitpay.payment.completed', payload: { appId: 'a' } })
    expect(repo.findOrderById).not.toHaveBeenCalled()
  })

  it('error en changeStatus se loguea pero NO crashea consumer', async () => {
    repo.findOrderById.mockRejectedValue(new Error('DB down'))
    await expect(handleEvent({
      type: 'splitpay.payment.completed',
      payload: { appId: 'a', tenantId: 't', orderId: ORDER },
    })).resolves.toBeUndefined()
  })
})
