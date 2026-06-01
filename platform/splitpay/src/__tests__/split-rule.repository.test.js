// split-rule.repository — SQL shape de payments.split_rules + rowToSplitRule.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/split-rule.repository.js'

function mockClient(rows = [], rowCount = rows.length) {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount }) }
}

const row = {
  id: 'r1', tenant_id: 't1', sub_tenant_id: null, name: 'Default',
  platform_fee_percent: '10.00', recipients: [{ accountId: 'a1', percentage: 90, label: 'A' }],
  active: true, created_at: 'C', updated_at: 'U',
}
const ctx = { tenantId: 't1', subTenantId: null }

describe('createSplitRule', () => {
  it('INSERT con recipients stringificados + parsea platform_fee_percent', async () => {
    const c = mockClient([row])
    const r = await repo.createSplitRule(c, ctx, {
      name: 'Default', platformFeePercent: 10,
      recipients: [{ accountId: 'a1', percentage: 90, label: 'A' }],
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO payments\.split_rules/)
    expect(params[4]).toBe(JSON.stringify([{ accountId: 'a1', percentage: 90, label: 'A' }]))
    expect(r.platformFeePercent).toBe(10)
  })
})

describe('findSplitRuleById', () => {
  it('encontrado → rule', async () => {
    const c = mockClient([row])
    const r = await repo.findSplitRuleById(c, ctx, 'r1')
    expect(c.query.mock.calls[0][1]).toEqual(['r1', 't1'])
    expect(r.id).toBe('r1')
  })

  it('recipients como string JSON → parsea', async () => {
    const c = mockClient([{ ...row, recipients: JSON.stringify(row.recipients) }])
    const r = await repo.findSplitRuleById(c, ctx, 'r1')
    expect(r.recipients[0].accountId).toBe('a1')
  })

  it('no encontrado → NotFoundError', async () => {
    const c = mockClient([])
    await expect(repo.findSplitRuleById(c, ctx, 'nope')).rejects.toThrow(/Split rule/)
  })
})

describe('listSplitRules', () => {
  it('filtra activos + ORDER BY created_at DESC', async () => {
    const c = mockClient([row])
    const r = await repo.listSplitRules(c, ctx)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/active = true/)
    expect(params).toEqual(['t1'])
    expect(r).toHaveLength(1)
  })
})

describe('deactivateSplitRule', () => {
  it('UPDATE active=false', async () => {
    const c = mockClient([], 1)
    await repo.deactivateSplitRule(c, ctx, 'r1')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET active = false/)
    expect(params).toEqual(['r1', 't1'])
  })

  it('rowCount 0 → NotFoundError', async () => {
    const c = mockClient([], 0)
    await expect(repo.deactivateSplitRule(c, ctx, 'nope')).rejects.toThrow(/Split rule/)
  })
})
