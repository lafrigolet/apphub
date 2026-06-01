// inventory.repository — SQL shape de platform_inventory.{inventory_items,stock_movements}.
// Valida proyección, scoping (app_id + tenant_id), params parametrizados,
// las cláusulas de guarda de stock (reserve/commit) y los defaults COALESCE del upsert.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/inventory.repository.js'

const APP = 'shop'
const TEN = 't1'

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

describe('findBySku', () => {
  it('WHERE app_id+tenant_id+sku; sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.findBySku(c, APP, TEN, 'SKU1')).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/FROM platform_inventory\.inventory_items/)
    expect(sql).toMatch(/WHERE app_id = \$1 AND tenant_id = \$2 AND sku = \$3/)
    expect(params).toEqual([APP, TEN, 'SKU1'])
  })

  it('devuelve la fila cuando existe', async () => {
    const c = mockClient([{ sku: 'SKU1' }])
    expect(await repo.findBySku(c, APP, TEN, 'SKU1')).toEqual({ sku: 'SKU1' })
  })
})

describe('listByTenant', () => {
  it('defaults limit/offset; ORDER BY sku', async () => {
    const c = mockClient([{ sku: 'A' }])
    await repo.listByTenant(c, APP, TEN)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/ORDER BY sku/)
    expect(sql).toMatch(/LIMIT \$3 OFFSET \$4/)
    expect(params).toEqual([APP, TEN, 100, 0])
  })

  it('respeta limit/offset explícitos', async () => {
    const c = mockClient([])
    await repo.listByTenant(c, APP, TEN, { limit: 10, offset: 5 })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 10, 5])
  })
})

describe('upsert', () => {
  it('INSERT ... ON CONFLICT DO UPDATE; serializa optionValues a jsonb', async () => {
    const c = mockClient([{ sku: 'SKU1' }])
    await repo.upsert(c, {
      appId: APP, tenantId: TEN, sku: 'SKU1', qtyOnHand: 5,
      lowStockThreshold: 2, parentSku: 'P', optionValues: { size: 'M' }, displayName: 'D',
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_inventory\.inventory_items/)
    expect(sql).toMatch(/ON CONFLICT \(app_id, tenant_id, sku\) DO UPDATE/)
    expect(params).toEqual([APP, TEN, 'SKU1', 5, 2, 'P', JSON.stringify({ size: 'M' }), 'D'])
  })

  it('optionValues ausente → null param (no JSON.stringify)', async () => {
    const c = mockClient([{ sku: 'SKU1' }])
    await repo.upsert(c, { appId: APP, tenantId: TEN, sku: 'SKU1', qtyOnHand: 0 })
    const params = c.query.mock.calls[0][1]
    expect(params[5]).toBeNull() // parentSku
    expect(params[6]).toBeNull() // optionValues
    expect(params[7]).toBeNull() // displayName
  })
})

describe('listVariants', () => {
  it('filtra por parent_sku, ORDER BY sku', async () => {
    const c = mockClient([{ sku: 'P-M' }])
    const r = await repo.listVariants(c, APP, TEN, 'P')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE app_id=\$1 AND tenant_id=\$2 AND parent_sku=\$3/)
    expect(params).toEqual([APP, TEN, 'P'])
    expect(r).toEqual([{ sku: 'P-M' }])
  })
})

describe('findByParentAndOptions', () => {
  it('compara option_values::text con $4::text; sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.findByParentAndOptions(c, APP, TEN, 'P', { size: 'M' })).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/option_values::text = \$4::text/)
    expect(params).toEqual([APP, TEN, 'P', JSON.stringify({ size: 'M' })])
  })

  it('optionValues nulo → serializa {}', async () => {
    const c = mockClient([{ sku: 'P-M' }])
    await repo.findByParentAndOptions(c, APP, TEN, 'P', null)
    expect(c.query.mock.calls[0][1][3]).toBe(JSON.stringify({}))
  })
})

describe('adjustOnHand', () => {
  it('UPDATE qty_on_hand + delta; row → fila, sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.adjustOnHand(c, APP, TEN, 'SKU1', 3)).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET qty_on_hand = qty_on_hand \+ \$4/)
    expect(params).toEqual([APP, TEN, 'SKU1', 3])
  })
})

describe('reserve', () => {
  it('UPDATE con guarda qty_on_hand - qty_reserved >= $4', async () => {
    const c = mockClient([{ sku: 'SKU1' }])
    const r = await repo.reserve(c, APP, TEN, 'SKU1', 2)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET qty_reserved = qty_reserved \+ \$4/)
    expect(sql).toMatch(/AND qty_on_hand - qty_reserved >= \$4/)
    expect(params).toEqual([APP, TEN, 'SKU1', 2])
    expect(r).toEqual({ sku: 'SKU1' })
  })

  it('stock insuficiente (sin row) → null', async () => {
    const c = mockClient([])
    expect(await repo.reserve(c, APP, TEN, 'SKU1', 2)).toBeNull()
  })
})

describe('release', () => {
  it('UPDATE GREATEST(qty_reserved - $4, 0)', async () => {
    const c = mockClient([{ sku: 'SKU1' }])
    await repo.release(c, APP, TEN, 'SKU1', 2)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET qty_reserved = GREATEST\(qty_reserved - \$4, 0\)/)
    expect(params).toEqual([APP, TEN, 'SKU1', 2])
  })

  it('sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.release(c, APP, TEN, 'SKU1', 2)).toBeNull()
  })
})

describe('commit', () => {
  it('decrementa on_hand y reserved con guarda qty_on_hand >= $4', async () => {
    const c = mockClient([{ sku: 'SKU1' }])
    await repo.commit(c, APP, TEN, 'SKU1', 2)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET qty_on_hand\s+= qty_on_hand\s+- \$4/)
    expect(sql).toMatch(/AND qty_on_hand >= \$4/)
    expect(params).toEqual([APP, TEN, 'SKU1', 2])
  })

  it('insuficiente (sin row) → null', async () => {
    const c = mockClient([])
    expect(await repo.commit(c, APP, TEN, 'SKU1', 2)).toBeNull()
  })
})

describe('recordMovement', () => {
  it('INSERT en stock_movements con defaults null para ref/actor', async () => {
    const c = mockClient([])
    await repo.recordMovement(c, { appId: APP, tenantId: TEN, sku: 'SKU1', delta: -2, reason: 'commit' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_inventory\.stock_movements/)
    expect(params).toEqual([APP, TEN, 'SKU1', -2, 'commit', null, null, null])
  })

  it('respeta refType/refId/actorUserId explícitos', async () => {
    const c = mockClient([])
    await repo.recordMovement(c, {
      appId: APP, tenantId: TEN, sku: 'SKU1', delta: 0, reason: 'reserve',
      refType: 'order', refId: 'ord1', actorUserId: 'u1',
    })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'SKU1', 0, 'reserve', 'order', 'ord1', 'u1'])
  })
})
