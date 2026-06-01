// returns.repository — SQL shape de platform_shipping.returns + return_items.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/returns.repository.js'

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

const APP = 'shop'
const TEN = 't1'

describe('insertReturn', () => {
  it('status default requested vía COALESCE; reason null', async () => {
    const c = mockClient([{ id: 'r1' }])
    await repo.insertReturn(c, APP, TEN, { orderId: 'o1', buyerUserId: 'u1' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_shipping\.returns/)
    expect(sql).toMatch(/COALESCE\(\$5,'requested'\)/)
    expect(params).toEqual([APP, TEN, 'o1', 'u1', undefined, null])
  })
  it('respeta status y reason', async () => {
    const c = mockClient([{ id: 'r1' }])
    await repo.insertReturn(c, APP, TEN, { orderId: 'o1', buyerUserId: 'u1', status: 'approved', reason: 'broken' })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'o1', 'u1', 'approved', 'broken'])
  })
})

describe('insertReturnItem', () => {
  it('defaults null + metadata {}', async () => {
    const c = mockClient([{ id: 'i1' }])
    await repo.insertReturnItem(c, APP, TEN, 'r1', { sku: 'SKU', qty: 2 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_shipping\.return_items/)
    expect(params).toEqual([APP, TEN, 'r1', 'SKU', 2, null, null, null, {}])
  })
  it('respeta reason/condition/unitPriceCents/metadata', async () => {
    const c = mockClient([{ id: 'i1' }])
    await repo.insertReturnItem(c, APP, TEN, 'r1', {
      sku: 'SKU', qty: 1, reason: 'r', condition: 'new', unitPriceCents: 500, metadata: { k: 1 },
    })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'r1', 'SKU', 1, 'r', 'new', 500, { k: 1 }])
  })
})

describe('findReturnById / findReturnItemById', () => {
  it('findReturnById null cuando no existe', async () => {
    const c = mockClient([])
    expect(await repo.findReturnById(c, APP, TEN, 'r9')).toBeNull()
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'r9'])
  })
  it('findReturnById devuelve fila', async () => {
    const c = mockClient([{ id: 'r1' }])
    expect(await repo.findReturnById(c, APP, TEN, 'r1')).toEqual({ id: 'r1' })
  })
  it('findReturnItemById null cuando no existe', async () => {
    const c = mockClient([])
    expect(await repo.findReturnItemById(c, APP, TEN, 'i9')).toBeNull()
  })
  it('findReturnItemById devuelve fila', async () => {
    const c = mockClient([{ id: 'i1' }])
    expect(await repo.findReturnItemById(c, APP, TEN, 'i1')).toEqual({ id: 'i1' })
  })
})

describe('listReturnItems', () => {
  it('ordena por created_at', async () => {
    const c = mockClient([])
    await repo.listReturnItems(c, APP, TEN, 'r1')
    expect(c.query.mock.calls[0][0]).toMatch(/ORDER BY created_at/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'r1'])
  })
})

describe('listReturns', () => {
  it('sin filtros → limit default 50', async () => {
    const c = mockClient([])
    await repo.listReturns(c, APP, TEN)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/ORDER BY created_at DESC/)
    expect(params).toEqual([APP, TEN, 50])
  })
  it('todos los filtros + limit custom', async () => {
    const c = mockClient([])
    await repo.listReturns(c, APP, TEN, { buyerUserId: 'u1', orderId: 'o1', status: 'approved', limit: 10 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/buyer_user_id = \$3/)
    expect(sql).toMatch(/order_id      = \$4/)
    expect(sql).toMatch(/status        = \$5/)
    expect(params).toEqual([APP, TEN, 'u1', 'o1', 'approved', 10])
  })
})

describe('updateReturn', () => {
  it('mapea campos + updated_at; ignora campos no listados', async () => {
    const c = mockClient([{ id: 'r1' }])
    await repo.updateReturn(c, APP, TEN, 'r1', {
      status: 'approved', refundAmountCents: 500, ignoreMe: 'x', approvedAt: 'now',
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/status = \$4/)
    expect(sql).toMatch(/refund_amount_cents = \$5/)
    expect(sql).toMatch(/approved_at = \$6/)
    expect(sql).toMatch(/updated_at = now\(\)/)
    expect(sql).not.toMatch(/ignoreMe/)
    expect(params).toEqual([APP, TEN, 'r1', 'approved', 500, 'now'])
  })
  it('sin campos → solo updated_at', async () => {
    const c = mockClient([{ id: 'r1' }])
    await repo.updateReturn(c, APP, TEN, 'r1', {})
    expect(c.query.mock.calls[0][0]).toMatch(/SET updated_at = now\(\)/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'r1'])
  })
  it('null cuando no devuelve fila', async () => {
    const c = mockClient([])
    expect(await repo.updateReturn(c, APP, TEN, 'r1', { status: 'x' })).toBeNull()
  })
})

describe('setReturnItemReceived', () => {
  it('qty + condition COALESCE; null si no existe', async () => {
    const c = mockClient([])
    expect(await repo.setReturnItemReceived(c, APP, TEN, 'i1', 2, 'new')).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/qty_received = \$4/)
    expect(sql).toMatch(/condition = COALESCE\(\$5, condition\)/)
    expect(params).toEqual([APP, TEN, 'i1', 2, 'new'])
  })
  it('condition omitido → null', async () => {
    const c = mockClient([{ id: 'i1' }])
    await repo.setReturnItemReceived(c, APP, TEN, 'i1', 1)
    expect(c.query.mock.calls[0][1][4]).toBeNull()
  })
})
