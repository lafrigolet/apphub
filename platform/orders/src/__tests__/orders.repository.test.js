// orders.repository — SQL shape de platform_orders.* (orders, items, addresses,
// status_history, modifications). Valida scoping (app_id+tenant_id), proyección,
// defaults COALESCE, serialización JSON de before/after, el builder dinámico de
// filtros en listOrders y el comportamiento null/loop de los helpers.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/orders.repository.js'

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

const APP = 'mk'
const TEN = 't1'
const OID = 'o1'

describe('insertOrder', () => {
  it('INSERT scoped con defaults (tax/shipping 0, metadata {})', async () => {
    const c = mockClient([{ id: OID }])
    const r = await repo.insertOrder(c, {
      appId: APP, tenantId: TEN, buyerUserId: 'b1', status: 'pending',
      currency: 'EUR', subtotalCents: 1000, totalCents: 1000,
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_orders\.orders/)
    expect(params).toEqual([
      APP, TEN, null, 'b1', 'pending', 'EUR', 1000, 0, 0, 1000, null, {},
    ])
    expect(r).toEqual({ id: OID })
  })

  it('respeta subTenantId, tax, shipping, idempotencyKey, metadata', async () => {
    const c = mockClient([{ id: OID }])
    await repo.insertOrder(c, {
      appId: APP, tenantId: TEN, subTenantId: 's1', buyerUserId: 'b1', status: 'pending',
      currency: 'USD', subtotalCents: 1000, taxCents: 100, shippingCents: 50,
      totalCents: 1150, idempotencyKey: 'k1', metadata: { src: 'web' },
    })
    expect(c.query.mock.calls[0][1]).toEqual([
      APP, TEN, 's1', 'b1', 'pending', 'USD', 1000, 100, 50, 1150, 'k1', { src: 'web' },
    ])
  })
})

describe('insertItems', () => {
  it('inserta cada item con defaults (vendorTenantId null, metadata {})', async () => {
    const c = mockClient([])
    await repo.insertItems(c, OID, APP, TEN, [
      { sku: 'A', productName: 'Apple', qty: 2, unitPriceCents: 100 },
      { sku: 'B', productName: 'Banana', qty: 1, unitPriceCents: 50, vendorTenantId: 'v1', metadata: { x: 1 } },
    ])
    expect(c.query).toHaveBeenCalledTimes(2)
    expect(c.query.mock.calls[0][0]).toMatch(/INSERT INTO platform_orders\.order_items/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, OID, 'A', 'Apple', 2, 100, null, {}])
    expect(c.query.mock.calls[1][1]).toEqual([APP, TEN, OID, 'B', 'Banana', 1, 50, 'v1', { x: 1 }])
  })

  it('lista vacía → ninguna query', async () => {
    const c = mockClient([])
    await repo.insertItems(c, OID, APP, TEN, [])
    expect(c.query).not.toHaveBeenCalled()
  })
})

describe('insertModification', () => {
  it('serializa before/after a JSON cuando no son null', async () => {
    const c = mockClient([{ id: 'mod1' }])
    const r = await repo.insertModification(c, {
      appId: APP, tenantId: TEN, orderId: OID, type: 'note_added',
      before: { a: 1 }, after: { b: 2 }, reason: 'r', actorUserId: 'u1', actorRole: 'staff',
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_orders\.order_modifications/)
    expect(params).toEqual([
      APP, TEN, OID, 'note_added', JSON.stringify({ a: 1 }), JSON.stringify({ b: 2 }),
      'r', 'u1', 'staff',
    ])
    expect(r).toEqual({ id: 'mod1' })
  })

  it('before/after null → mantiene null (no "null" string)', async () => {
    const c = mockClient([{ id: 'mod1' }])
    await repo.insertModification(c, {
      appId: APP, tenantId: TEN, orderId: OID, type: 'note_added', before: null, after: null,
    })
    const params = c.query.mock.calls[0][1]
    expect(params[4]).toBeNull()
    expect(params[5]).toBeNull()
    expect(params[6]).toBeNull() // reason
    expect(params[7]).toBeNull() // actorUserId
    expect(params[8]).toBeNull() // actorRole
  })
})

describe('listModifications', () => {
  it('SELECT scoped + ORDER BY created_at DESC', async () => {
    const c = mockClient([{ id: 'mod1' }])
    const r = await repo.listModifications(c, APP, TEN, OID)
    expect(c.query.mock.calls[0][0]).toMatch(/ORDER BY created_at DESC/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, OID])
    expect(r).toEqual([{ id: 'mod1' }])
  })
})

describe('findShippingAddress', () => {
  it('filtra kind=shipping LIMIT 1; row → objeto', async () => {
    const c = mockClient([{ kind: 'shipping' }])
    const r = await repo.findShippingAddress(c, APP, TEN, OID)
    expect(c.query.mock.calls[0][0]).toMatch(/kind = 'shipping'/)
    expect(r).toEqual({ kind: 'shipping' })
  })

  it('sin row → null', async () => {
    expect(await repo.findShippingAddress(mockClient([]), APP, TEN, OID)).toBeNull()
  })
})

describe('replaceShippingAddress', () => {
  it('DELETE shipping previo + INSERT nuevo con kind shipping', async () => {
    const c = mockClient([])
    await repo.replaceShippingAddress(c, APP, TEN, OID, { line1: 'A', city: 'X' })
    expect(c.query).toHaveBeenCalledTimes(2)
    expect(c.query.mock.calls[0][0]).toMatch(/DELETE FROM platform_orders\.order_addresses/)
    expect(c.query.mock.calls[1][0]).toMatch(/INSERT INTO platform_orders\.order_addresses/)
    // kind shipping en posición 4
    expect(c.query.mock.calls[1][1][3]).toBe('shipping')
    expect(c.query.mock.calls[1][1][5]).toBe('A') // line1
  })
})

describe('insertAddress', () => {
  it('INSERT con todos los campos null por defecto', async () => {
    const c = mockClient([])
    await repo.insertAddress(c, OID, APP, TEN, { kind: 'billing' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_orders\.order_addresses/)
    expect(params).toEqual([APP, TEN, OID, 'billing', null, null, null, null, null, null, null, null])
  })

  it('respeta campos provistos', async () => {
    const c = mockClient([])
    await repo.insertAddress(c, OID, APP, TEN, {
      kind: 'shipping', fullName: 'Ana', line1: 'L1', line2: 'L2', city: 'C',
      region: 'R', postalCode: 'P', country: 'ES', phone: '600',
    })
    expect(c.query.mock.calls[0][1]).toEqual([
      APP, TEN, OID, 'shipping', 'Ana', 'L1', 'L2', 'C', 'R', 'P', 'ES', '600',
    ])
  })
})

describe('recordStatusChange', () => {
  it('INSERT con actor/reason; actor null → user/role null', async () => {
    const c = mockClient([])
    await repo.recordStatusChange(c, OID, APP, TEN, 'pending', 'paid', null, null)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_orders\.order_status_history/)
    expect(params).toEqual([APP, TEN, OID, 'pending', 'paid', null, null, null])
  })

  it('actor + reason provistos', async () => {
    const c = mockClient([])
    await repo.recordStatusChange(c, OID, APP, TEN, 'paid', 'shipped', { userId: 'u1', role: 'staff' }, 'sent')
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, OID, 'paid', 'shipped', 'u1', 'staff', 'sent'])
  })
})

describe('findOrderById / findOrderByIdempotencyKey', () => {
  it('findOrderById row → objeto; sin row → null', async () => {
    expect(await repo.findOrderById(mockClient([{ id: OID }]), APP, TEN, OID)).toEqual({ id: OID })
    expect(await repo.findOrderById(mockClient([]), APP, TEN, OID)).toBeNull()
  })

  it('findOrderByIdempotencyKey filtra idempotency_key=$3', async () => {
    const c = mockClient([{ id: OID }])
    const r = await repo.findOrderByIdempotencyKey(c, APP, TEN, 'k1')
    expect(c.query.mock.calls[0][0]).toMatch(/idempotency_key=\$3/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'k1'])
    expect(r).toEqual({ id: OID })
    expect(await repo.findOrderByIdempotencyKey(mockClient([]), APP, TEN, 'gh')).toBeNull()
  })
})

describe('findItemsByOrderId / findAddressesByOrderId / findHistoryByOrderId', () => {
  it('findItemsByOrderId scoped por order_id', async () => {
    const c = mockClient([{ sku: 'A' }])
    const r = await repo.findItemsByOrderId(c, APP, TEN, OID)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, OID])
    expect(r).toEqual([{ sku: 'A' }])
  })

  it('findAddressesByOrderId scoped por order_id', async () => {
    const c = mockClient([{ kind: 'shipping' }])
    const r = await repo.findAddressesByOrderId(c, APP, TEN, OID)
    expect(c.query.mock.calls[0][0]).toMatch(/FROM platform_orders\.order_addresses WHERE/)
    expect(r).toEqual([{ kind: 'shipping' }])
  })

  it('findHistoryByOrderId ORDER BY ts ASC', async () => {
    const c = mockClient([{ to_status: 'pending' }])
    const r = await repo.findHistoryByOrderId(c, APP, TEN, OID)
    expect(c.query.mock.calls[0][0]).toMatch(/ORDER BY ts ASC/)
    expect(r).toEqual([{ to_status: 'pending' }])
  })
})

describe('listOrders — builder dinámico', () => {
  it('sin filtros → solo app/tenant + defaults limit/offset', async () => {
    const c = mockClient([{ id: OID }])
    await repo.listOrders(c, APP, TEN)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE app_id = \$1 AND tenant_id = \$2/)
    expect(sql).toMatch(/ORDER BY created_at DESC/)
    expect(params).toEqual([APP, TEN, 50, 0])
  })

  it('con buyerUserId + status → filtros y limit/offset al final', async () => {
    const c = mockClient([])
    await repo.listOrders(c, APP, TEN, { buyerUserId: 'b1', status: 'paid', limit: 10, offset: 5 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/buyer_user_id = \$3/)
    expect(sql).toMatch(/status = \$4/)
    expect(params).toEqual([APP, TEN, 'b1', 'paid', 10, 5])
  })

  it('solo status → buyer omitido, status en $3', async () => {
    const c = mockClient([])
    await repo.listOrders(c, APP, TEN, { status: 'shipped' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/status = \$3/)
    expect(sql).not.toMatch(/buyer_user_id/)
    expect(params).toEqual([APP, TEN, 'shipped', 50, 0])
  })
})

describe('updateStatus', () => {
  it('UPDATE status scoped; row → objeto', async () => {
    const c = mockClient([{ id: OID, status: 'paid' }])
    const r = await repo.updateStatus(c, APP, TEN, OID, 'paid')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET status = \$4, updated_at = now\(\)/)
    expect(params).toEqual([APP, TEN, OID, 'paid'])
    expect(r).toEqual({ id: OID, status: 'paid' })
  })

  it('sin row → null', async () => {
    expect(await repo.updateStatus(mockClient([]), APP, TEN, OID, 'paid')).toBeNull()
  })
})

describe('updatePaymentIntent', () => {
  it('UPDATE stripe_payment_intent_id scoped', async () => {
    const c = mockClient([])
    await repo.updatePaymentIntent(c, APP, TEN, OID, 'pi_123')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET stripe_payment_intent_id = \$4/)
    expect(params).toEqual([APP, TEN, OID, 'pi_123'])
  })
})
