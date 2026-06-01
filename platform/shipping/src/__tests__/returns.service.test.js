// returns.service — FSM completo + gates de rol + eventos publicados.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({ pool: { connect: vi.fn() }, withTenantTransaction: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn() }))
vi.mock('../repositories/returns.repository.js')

import * as service from '../services/returns.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/returns.repository.js'
import { ConflictError, NotFoundError, ValidationError, ForbiddenError } from '@apphub/platform-sdk/errors'

const APP = 'shop'
const TEN = 't1'
const RID = 'r1'
const staffCtx = { appId: APP, tenantId: TEN, subTenantId: null, userId: 'staff1', role: 'staff' }
const buyerCtx = { appId: APP, tenantId: TEN, subTenantId: null, userId: 'buyer1', role: 'user' }

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
})

describe('createReturn', () => {
  it('sin items → ValidationError', async () => {
    await expect(service.createReturn(buyerCtx, { orderId: 'o1', items: [] }))
      .rejects.toThrow(ValidationError)
  })

  it('persiste return + items y publica return.requested', async () => {
    repo.insertReturn.mockResolvedValue({ id: RID, order_id: 'o1', buyer_user_id: 'buyer1' })
    repo.insertReturnItem.mockResolvedValue({ id: 'i1' })
    repo.findReturnById.mockResolvedValue({ id: RID, order_id: 'o1', buyer_user_id: 'buyer1' })
    repo.listReturnItems.mockResolvedValue([{ id: 'i1' }])
    const r = await service.createReturn(buyerCtx, {
      orderId: 'o1', reason: 'broken', items: [{ sku: 'A', qty: 1 }, { sku: 'B', qty: 2 }],
    })
    expect(repo.insertReturnItem).toHaveBeenCalledTimes(2)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'return.requested' }))
    expect(r.items).toEqual([{ id: 'i1' }])
  })
})

describe('listReturns / getReturn', () => {
  it('listReturns delega', async () => {
    repo.listReturns.mockResolvedValue([{ id: RID }])
    const r = await service.listReturns(staffCtx, { status: 'requested' })
    expect(r).toEqual([{ id: RID }])
    expect(repo.listReturns).toHaveBeenCalledWith(expect.anything(), APP, TEN, { status: 'requested' })
  })
  it('getReturn → loadFull', async () => {
    repo.findReturnById.mockResolvedValue({ id: RID })
    repo.listReturnItems.mockResolvedValue([])
    const r = await service.getReturn(staffCtx, RID)
    expect(r.id).toBe(RID)
  })
  it('getReturn → NotFoundError cuando no existe', async () => {
    repo.findReturnById.mockResolvedValue(null)
    await expect(service.getReturn(staffCtx, RID)).rejects.toThrow(NotFoundError)
  })
})

describe('approve / reject (transition + role gates)', () => {
  it('approve no-staff → ForbiddenError', async () => {
    await expect(service.approveReturn(buyerCtx, RID)).rejects.toThrow(ForbiddenError)
  })
  it('approve requested→approved publica return.approved', async () => {
    repo.findReturnById.mockResolvedValue({ id: RID, status: 'requested', order_id: 'o1', buyer_user_id: 'b1' })
    repo.updateReturn.mockResolvedValue({ id: RID })
    repo.listReturnItems.mockResolvedValue([])
    await service.approveReturn(staffCtx, RID, 'ok')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'return.approved' }))
  })
  it('transition no permitida → ConflictError', async () => {
    repo.findReturnById.mockResolvedValue({ id: RID, status: 'refunded', order_id: 'o1' })
    await expect(service.approveReturn(staffCtx, RID)).rejects.toThrow(ConflictError)
  })
  it('transition return inexistente → NotFoundError', async () => {
    repo.findReturnById.mockResolvedValue(null)
    await expect(service.approveReturn(staffCtx, RID)).rejects.toThrow(NotFoundError)
  })
  it('reject no-staff → ForbiddenError', async () => {
    await expect(service.rejectReturn(buyerCtx, RID)).rejects.toThrow(ForbiddenError)
  })
  it('reject requested→rejected', async () => {
    repo.findReturnById.mockResolvedValue({ id: RID, status: 'requested', order_id: 'o1' })
    repo.updateReturn.mockResolvedValue({ id: RID })
    repo.listReturnItems.mockResolvedValue([])
    await service.rejectReturn(staffCtx, RID, 'no')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'return.rejected' }))
  })
})

describe('cancelReturn', () => {
  it('return inexistente → NotFoundError', async () => {
    repo.findReturnById.mockResolvedValue(null)
    await expect(service.cancelReturn(buyerCtx, RID)).rejects.toThrow(NotFoundError)
  })
  it('otro buyer no-staff → ForbiddenError', async () => {
    repo.findReturnById.mockResolvedValue({ id: RID, status: 'requested', buyer_user_id: 'someone-else' })
    await expect(service.cancelReturn(buyerCtx, RID)).rejects.toThrow(ForbiddenError)
  })
  it('estado no cancelable → ConflictError', async () => {
    repo.findReturnById.mockResolvedValue({ id: RID, status: 'refunded', buyer_user_id: 'buyer1' })
    await expect(service.cancelReturn(buyerCtx, RID)).rejects.toThrow(ConflictError)
  })
  it('buyer dueño cancela → publica return.cancelled', async () => {
    repo.findReturnById.mockResolvedValue({ id: RID, status: 'requested', buyer_user_id: 'buyer1', order_id: 'o1' })
    repo.updateReturn.mockResolvedValue({ id: RID })
    repo.listReturnItems.mockResolvedValue([])
    await service.cancelReturn(buyerCtx, RID, 'changed mind')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'return.cancelled' }))
  })
  it('staff puede cancelar return de otro', async () => {
    repo.findReturnById.mockResolvedValue({ id: RID, status: 'approved', buyer_user_id: 'other', order_id: 'o1' })
    repo.updateReturn.mockResolvedValue({ id: RID })
    repo.listReturnItems.mockResolvedValue([])
    await expect(service.cancelReturn(staffCtx, RID)).resolves.toBeDefined()
  })
})

describe('issueReturnLabel / markShipped', () => {
  it('issueLabel no-staff → ForbiddenError', async () => {
    await expect(service.issueReturnLabel(buyerCtx, RID)).rejects.toThrow(ForbiddenError)
  })
  it('issueLabel approved→label_issued', async () => {
    repo.findReturnById.mockResolvedValue({ id: RID, status: 'approved', order_id: 'o1' })
    repo.updateReturn.mockResolvedValue({ id: RID })
    repo.listReturnItems.mockResolvedValue([])
    await service.issueReturnLabel(staffCtx, RID, { carrier: 'ups', trackingCode: 'TC' })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'return.label_issued' }))
  })
  it('markShipped label_issued→shipped (no role gate)', async () => {
    repo.findReturnById.mockResolvedValue({ id: RID, status: 'label_issued', order_id: 'o1' })
    repo.updateReturn.mockResolvedValue({ id: RID })
    repo.listReturnItems.mockResolvedValue([])
    await service.markShipped(buyerCtx, RID, 'TC')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'return.shipped' }))
  })
})

describe('receiveReturn', () => {
  it('no-staff → ForbiddenError', async () => {
    await expect(service.receiveReturn(buyerCtx, RID)).rejects.toThrow(ForbiddenError)
  })
  it('return inexistente → NotFoundError', async () => {
    repo.findReturnById.mockResolvedValue(null)
    await expect(service.receiveReturn(staffCtx, RID)).rejects.toThrow(NotFoundError)
  })
  it('estado no permitido → ConflictError', async () => {
    repo.findReturnById.mockResolvedValue({ id: RID, status: 'requested', order_id: 'o1' })
    await expect(service.receiveReturn(staffCtx, RID)).rejects.toThrow(ConflictError)
  })
  it('item inexistente → NotFoundError', async () => {
    repo.findReturnById.mockResolvedValue({ id: RID, status: 'shipped', order_id: 'o1' })
    repo.findReturnItemById.mockResolvedValue(null)
    await expect(service.receiveReturn(staffCtx, RID, { items: [{ id: 'i9' }] }))
      .rejects.toThrow(NotFoundError)
  })
  it('item de otro return → ValidationError', async () => {
    repo.findReturnById.mockResolvedValue({ id: RID, status: 'shipped', order_id: 'o1' })
    repo.findReturnItemById.mockResolvedValue({ id: 'i1', return_id: 'OTHER', qty: 5 })
    await expect(service.receiveReturn(staffCtx, RID, { items: [{ id: 'i1' }] }))
      .rejects.toThrow(ValidationError)
  })
  it('qtyReceived > qty → ValidationError', async () => {
    repo.findReturnById.mockResolvedValue({ id: RID, status: 'shipped', order_id: 'o1' })
    repo.findReturnItemById.mockResolvedValue({ id: 'i1', return_id: RID, qty: 2 })
    await expect(service.receiveReturn(staffCtx, RID, { items: [{ id: 'i1', qtyReceived: 5 }] }))
      .rejects.toThrow(ValidationError)
  })
  it('happy: marca recibido + publica return.received', async () => {
    repo.findReturnById.mockResolvedValue({ id: RID, status: 'shipped', order_id: 'o1' })
    repo.findReturnItemById.mockResolvedValue({ id: 'i1', return_id: RID, qty: 5 })
    repo.setReturnItemReceived.mockResolvedValue({ id: 'i1' })
    repo.updateReturn.mockResolvedValue({ id: RID })
    repo.listReturnItems.mockResolvedValue([{ sku: 'A', qty_received: 1, condition: 'new' }])
    await service.receiveReturn(staffCtx, RID, { items: [{ id: 'i1', qtyReceived: 1, condition: 'new' }] })
    expect(repo.setReturnItemReceived).toHaveBeenCalled()
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'return.received' }))
  })
  it('sin items en body → usa default (qty existente no se valida)', async () => {
    repo.findReturnById.mockResolvedValue({ id: RID, status: 'shipped', order_id: 'o1' })
    repo.updateReturn.mockResolvedValue({ id: RID })
    repo.listReturnItems.mockResolvedValue([])
    await service.receiveReturn(staffCtx, RID)
    expect(repo.setReturnItemReceived).not.toHaveBeenCalled()
  })
  it('item sin qtyReceived → usa existing.qty (rama `?? existing.qty`)', async () => {
    repo.findReturnById.mockResolvedValue({ id: RID, status: 'shipped', order_id: 'o1' })
    repo.findReturnItemById.mockResolvedValue({ id: 'i1', return_id: RID, qty: 3 })
    repo.setReturnItemReceived.mockResolvedValue({ id: 'i1' })
    repo.updateReturn.mockResolvedValue({ id: RID })
    repo.listReturnItems.mockResolvedValue([])
    await service.receiveReturn(staffCtx, RID, { items: [{ id: 'i1', condition: 'new' }] })
    // qty default = existing.qty = 3
    expect(repo.setReturnItemReceived).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.anything(), 'i1', 3, 'new',
    )
  })
  it('estado desconocido (no en TRANSITIONS) → ConflictError (rama `?? false`)', async () => {
    repo.findReturnById.mockResolvedValue({ id: RID, status: 'frobnicate', order_id: 'o1' })
    await expect(service.receiveReturn(staffCtx, RID)).rejects.toThrow(ConflictError)
  })
})

describe('restockReturn', () => {
  it('no-staff → ForbiddenError', async () => {
    await expect(service.restockReturn(buyerCtx, RID)).rejects.toThrow(ForbiddenError)
  })
  it('return inexistente → NotFoundError', async () => {
    repo.findReturnById.mockResolvedValue(null)
    await expect(service.restockReturn(staffCtx, RID)).rejects.toThrow(NotFoundError)
  })
  it('estado no permitido → ConflictError', async () => {
    repo.findReturnById.mockResolvedValue({ id: RID, status: 'requested', order_id: 'o1' })
    await expect(service.restockReturn(staffCtx, RID)).rejects.toThrow(ConflictError)
  })
  it('happy: solo new/open_box → publica restocked + inventory.restock.requested per-sku', async () => {
    repo.findReturnById.mockResolvedValue({ id: RID, status: 'received', order_id: 'o1' })
    repo.listReturnItems.mockResolvedValue([
      { sku: 'A', qty_received: 2, condition: 'new' },
      { sku: 'B', qty_received: 1, condition: 'damaged' },
      { sku: 'C', qty_received: 0, condition: 'new' },
    ])
    repo.updateReturn.mockResolvedValue({ id: RID })
    await service.restockReturn(staffCtx, RID)
    const types = publish.mock.calls.map((c) => c[0].type)
    expect(types).toContain('return.restocked')
    expect(types.filter((t) => t === 'inventory.restock.requested')).toHaveLength(1)
  })
  it('item con condition null + qty>0 → excluido (rama `condition ?? \'\'`)', async () => {
    repo.findReturnById.mockResolvedValue({ id: RID, status: 'received', order_id: 'o1' })
    repo.listReturnItems.mockResolvedValue([
      { sku: 'A', qty_received: 2, condition: null },   // condition null → '' → no restockable
    ])
    repo.updateReturn.mockResolvedValue({ id: RID })
    await service.restockReturn(staffCtx, RID)
    const types = publish.mock.calls.map((c) => c[0].type)
    expect(types).toContain('return.restocked')
    expect(types).not.toContain('inventory.restock.requested')
  })
})

describe('refundReturn', () => {
  it('no-staff → ForbiddenError', async () => {
    await expect(service.refundReturn(buyerCtx, RID, { amountCents: 100 })).rejects.toThrow(ForbiddenError)
  })
  it('return inexistente → NotFoundError', async () => {
    repo.findReturnById.mockResolvedValue(null)
    await expect(service.refundReturn(staffCtx, RID, { amountCents: 100 })).rejects.toThrow(NotFoundError)
  })
  it('estado no permitido → ConflictError', async () => {
    repo.findReturnById.mockResolvedValue({ id: RID, status: 'requested', order_id: 'o1' })
    await expect(service.refundReturn(staffCtx, RID, { amountCents: 100 })).rejects.toThrow(ConflictError)
  })
  it('amountCents <= 0 → ValidationError', async () => {
    repo.findReturnById.mockResolvedValue({ id: RID, status: 'received', order_id: 'o1' })
    await expect(service.refundReturn(staffCtx, RID, { amountCents: 0 })).rejects.toThrow(ValidationError)
  })
  it('happy: publica refund.requested + refunded', async () => {
    repo.findReturnById.mockResolvedValue({ id: RID, status: 'received', order_id: 'o1' })
    repo.updateReturn.mockResolvedValue({ id: RID })
    repo.listReturnItems.mockResolvedValue([])
    await service.refundReturn(staffCtx, RID, { amountCents: 1500, currency: 'EUR' })
    const types = publish.mock.calls.map((c) => c[0].type)
    expect(types).toContain('return.refund.requested')
    expect(types).toContain('return.refunded')
  })
  it('refundReturn sin args → ValidationError (amountCents undefined)', async () => {
    repo.findReturnById.mockResolvedValue({ id: RID, status: 'received', order_id: 'o1' })
    await expect(service.refundReturn(staffCtx, RID)).rejects.toThrow(ValidationError)
  })
  it('refund sin currency → currency null en updateReturn y evento (rama `?? null`)', async () => {
    repo.findReturnById.mockResolvedValue({ id: RID, status: 'received', order_id: 'o1' })
    repo.updateReturn.mockResolvedValue({ id: RID })
    repo.listReturnItems.mockResolvedValue([])
    await service.refundReturn(staffCtx, RID, { amountCents: 1500 })   // sin currency
    expect(repo.updateReturn).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.anything(), RID,
      expect.objectContaining({ refundCurrency: null }),
    )
    const refundEvt = publish.mock.calls.map((c) => c[0]).find((e) => e.type === 'return.refund.requested')
    expect(refundEvt.payload.currency).toBeNull()
  })
})
