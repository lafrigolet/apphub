// pos.repository — SQL shape de platform_pos.
// Valida tabla, scoping (app_id/tenant_id), proyección, params parametrizados,
// branches opcionales (filtros de listBills, closed_at por status).
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/pos.repository.js'

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

const APP = 'resto'
const TEN = 't1'
const BILL = 'bill1'

describe('insertBill', () => {
  it('INSERT en bills con defaults via COALESCE', async () => {
    const c = mockClient([{ id: BILL }])
    await repo.insertBill(c, { appId: APP, tenantId: TEN })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_pos\.bills/)
    expect(params[0]).toBe(APP)
    expect(params[1]).toBe(TEN)
    expect(params[2]).toBeNull()    // subTenantId
    expect(params[3]).toBeNull()    // tableId
    expect(params[4]).toBeNull()    // tableCode
    expect(params[5]).toBeNull()    // serverUserId
    expect(params[6]).toBe('EUR')   // currency default
    expect(params[7]).toBeNull()    // notes
    expect(params[8]).toEqual({})   // metadata default
  })

  it('respeta valores explícitos', async () => {
    const c = mockClient([{ id: BILL }])
    await repo.insertBill(c, {
      appId: APP, tenantId: TEN, subTenantId: 's1', tableId: 'tab1', tableCode: 'T1',
      serverUserId: 'u1', currency: 'USD', notes: 'n', metadata: { k: 1 },
    })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 's1', 'tab1', 'T1', 'u1', 'USD', 'n', { k: 1 }])
  })
})

describe('findBillById', () => {
  it('SELECT scoped; sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.findBillById(c, APP, TEN, BILL)).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/FROM platform_pos\.bills WHERE app_id=\$1 AND tenant_id=\$2 AND id=\$3/)
    expect(params).toEqual([APP, TEN, BILL])
  })
})

describe('listBills', () => {
  it('sin filtros → solo app/tenant + LIMIT default 100', async () => {
    const c = mockClient([])
    await repo.listBills(c, APP, TEN)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).not.toMatch(/status =/)
    expect(sql).not.toMatch(/table_id =/)
    expect(sql).toMatch(/ORDER BY opened_at DESC LIMIT \$3/)
    expect(params).toEqual([APP, TEN, 100])
  })

  it('con status + tableId + limit → filtros encadenados con índices correctos', async () => {
    const c = mockClient([])
    await repo.listBills(c, APP, TEN, { status: 'open', tableId: 'tab1', limit: 10 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/status = \$3/)
    expect(sql).toMatch(/table_id = \$4/)
    expect(sql).toMatch(/LIMIT \$5/)
    expect(params).toEqual([APP, TEN, 'open', 'tab1', 10])
  })
})

describe('insertBillItem', () => {
  it('INSERT con modifiers serializados a JSON y defaults', async () => {
    const c = mockClient([{ id: 'it1' }])
    await repo.insertBillItem(c, {
      appId: APP, tenantId: TEN, billId: BILL, sku: 'SKU', name: 'Burger',
      qty: 2, unitPriceCents: 900,
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_pos\.bill_items/)
    expect(params[7]).toBe('[]')      // modifiers default serializado
    expect(params[8]).toBe('main')    // course default
    expect(params[9]).toBeNull()      // notes
  })

  it('serializa modifiers explícitos', async () => {
    const c = mockClient([{}])
    await repo.insertBillItem(c, {
      appId: APP, tenantId: TEN, billId: BILL, sku: 'S', name: 'N', qty: 1,
      unitPriceCents: 100, modifiers: [{ x: 1 }], course: 'dessert', notes: 'sin sal',
    })
    const params = c.query.mock.calls[0][1]
    expect(params[7]).toBe(JSON.stringify([{ x: 1 }]))
    expect(params[8]).toBe('dessert')
    expect(params[9]).toBe('sin sal')
  })
})

describe('listItemsByBill', () => {
  it('SELECT scoped por bill; ORDER BY created_at', async () => {
    const c = mockClient([{ id: 'it1' }])
    const r = await repo.listItemsByBill(c, APP, TEN, BILL)
    expect(c.query.mock.calls[0][0]).toMatch(/FROM platform_pos\.bill_items/)
    expect(c.query.mock.calls[0][0]).toMatch(/ORDER BY created_at/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, BILL])
    expect(r).toEqual([{ id: 'it1' }])
  })
})

describe('insertPayment', () => {
  it('INSERT con tipCents default 0 y externalRef null', async () => {
    const c = mockClient([{ id: 'p1' }])
    await repo.insertPayment(c, { appId: APP, tenantId: TEN, billId: BILL, method: 'card', amountCents: 1000 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_pos\.bill_payments/)
    expect(params).toEqual([APP, TEN, BILL, 'card', 1000, 0, null])
  })

  it('respeta tipCents y externalRef', async () => {
    const c = mockClient([{}])
    await repo.insertPayment(c, { appId: APP, tenantId: TEN, billId: BILL, method: 'cash', amountCents: 500, tipCents: 50, externalRef: 'ext1' })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, BILL, 'cash', 500, 50, 'ext1'])
  })
})

describe('listPaymentsByBill', () => {
  it('SELECT scoped; ORDER BY paid_at', async () => {
    const c = mockClient([])
    await repo.listPaymentsByBill(c, APP, TEN, BILL)
    expect(c.query.mock.calls[0][0]).toMatch(/ORDER BY paid_at/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, BILL])
  })
})

describe('setBillTotals', () => {
  it('UPDATE totales scoped; sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.setBillTotals(c, APP, TEN, BILL, { subtotal: 1000, tax: 100, tip: 50, total: 1150 })).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET subtotal_cents=\$4, tax_cents=\$5, tip_cents=\$6, total_cents=\$7/)
    expect(params).toEqual([APP, TEN, BILL, 1000, 100, 50, 1150])
  })
})

describe('setBillStatus', () => {
  it('status terminal (paid) → closed_at=now()', async () => {
    const c = mockClient([{ id: BILL, status: 'paid' }])
    await repo.setBillStatus(c, APP, TEN, BILL, 'paid')
    expect(c.query.mock.calls[0][0]).toMatch(/closed_at=now\(\)/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, BILL, 'paid'])
  })

  it('status closed y cancelled también → closed_at=now()', async () => {
    const c1 = mockClient([{}])
    await repo.setBillStatus(c1, APP, TEN, BILL, 'closed')
    expect(c1.query.mock.calls[0][0]).toMatch(/closed_at=now\(\)/)
    const c2 = mockClient([{}])
    await repo.setBillStatus(c2, APP, TEN, BILL, 'cancelled')
    expect(c2.query.mock.calls[0][0]).toMatch(/closed_at=now\(\)/)
  })

  it('status no terminal (split) → closed_at=NULL; row inexistente → null', async () => {
    const c = mockClient([])
    expect(await repo.setBillStatus(c, APP, TEN, BILL, 'split')).toBeNull()
    expect(c.query.mock.calls[0][0]).toMatch(/closed_at=NULL/)
  })
})

describe('insertSplit', () => {
  it('INSERT en bill_splits', async () => {
    const c = mockClient([{ id: 'sp1' }])
    await repo.insertSplit(c, { appId: APP, tenantId: TEN, parentBillId: BILL, shareIndex: 0, amountCents: 500 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_pos\.bill_splits/)
    expect(params).toEqual([APP, TEN, BILL, 0, 500])
  })
})

describe('listSplits', () => {
  it('SELECT scoped por parent_bill_id; ORDER BY share_index', async () => {
    const c = mockClient([{ id: 'sp1' }])
    await repo.listSplits(c, APP, TEN, BILL)
    expect(c.query.mock.calls[0][0]).toMatch(/parent_bill_id=\$3/)
    expect(c.query.mock.calls[0][0]).toMatch(/ORDER BY share_index/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, BILL])
  })
})

describe('markSplitPaid', () => {
  it('UPDATE paid=TRUE con payment_id; sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.markSplitPaid(c, APP, TEN, 'sp1', 'p1')).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET paid=TRUE, payment_id=\$4/)
    expect(params).toEqual([APP, TEN, 'sp1', 'p1'])
  })
})

describe('cancelBill', () => {
  it('UPDATE a cancelled con actor + motivo; sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.cancelBill(c, APP, TEN, BILL, 'u9', 'motivo')).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET status='cancelled', closed_at=now\(\), cancelled_by=\$4, cancel_reason=\$5/)
    expect(params).toEqual([APP, TEN, BILL, 'u9', 'motivo'])
  })

  it('actor/motivo nulos por defecto', async () => {
    const c = mockClient([{ id: BILL }])
    await repo.cancelBill(c, APP, TEN, BILL)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, BILL, null, null])
  })
})

describe('listUnfiredItems', () => {
  it('SELECT scoped con fired_at IS NULL', async () => {
    const c = mockClient([{ id: 'it1' }])
    await repo.listUnfiredItems(c, APP, TEN, BILL)
    expect(c.query.mock.calls[0][0]).toMatch(/fired_at IS NULL/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, BILL])
  })
})

describe('markItemsFired', () => {
  it('con itemIds → UPDATE filtrado por ANY($4)', async () => {
    const c = mockClient([{ id: 'it1' }])
    await repo.markItemsFired(c, APP, TEN, BILL, ['it1'])
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/id = ANY\(\$4::uuid\[\]\) AND fired_at IS NULL/)
    expect(params).toEqual([APP, TEN, BILL, ['it1']])
  })

  it('sin itemIds → UPDATE de todos los no disparados', async () => {
    const c = mockClient([{ id: 'it1' }])
    await repo.markItemsFired(c, APP, TEN, BILL)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET fired_at=now\(\)/)
    expect(sql).not.toMatch(/ANY/)
    expect(params).toEqual([APP, TEN, BILL])
  })
})

describe('insertSplitItem / listSplitItems', () => {
  it('insertSplitItem INSERT scoped', async () => {
    const c = mockClient([{ id: 'si1' }])
    await repo.insertSplitItem(c, { appId: APP, tenantId: TEN, splitId: 'sp1', billItemId: 'it1' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_pos\.bill_split_items/)
    expect(params).toEqual([APP, TEN, 'sp1', 'it1'])
  })

  it('listSplitItems JOIN por parent_bill_id', async () => {
    const c = mockClient([{ id: 'si1' }])
    await repo.listSplitItems(c, APP, TEN, BILL)
    expect(c.query.mock.calls[0][0]).toMatch(/JOIN platform_pos\.bill_splits/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, BILL])
  })
})

describe('getSettings / upsertSettings', () => {
  it('getSettings scoped con sub_tenant_id IS NOT DISTINCT FROM', async () => {
    const c = mockClient([])
    expect(await repo.getSettings(c, APP, TEN, null)).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/sub_tenant_id IS NOT DISTINCT FROM \$3/)
    expect(params).toEqual([APP, TEN, null])
  })

  it('upsertSettings ON CONFLICT con tip_suggestions serializado', async () => {
    const c = mockClient([{ id: 's1' }])
    await repo.upsertSettings(c, { appId: APP, tenantId: TEN, tipSuggestions: [10, 15], tipAllowCustom: false, defaultTaxRate: 0.21 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/ON CONFLICT \(app_id, tenant_id, sub_tenant_id\) DO UPDATE/)
    expect(params[0]).toBe(APP)
    expect(params[3]).toBe(JSON.stringify([10, 15]))
    expect(params[4]).toBe(false)
    expect(params[5]).toBe(0.21)
  })

  it('upsertSettings con tipSuggestions undefined → null param', async () => {
    const c = mockClient([{ id: 's1' }])
    await repo.upsertSettings(c, { appId: APP, tenantId: TEN })
    expect(c.query.mock.calls[0][1][3]).toBeNull()
  })
})
