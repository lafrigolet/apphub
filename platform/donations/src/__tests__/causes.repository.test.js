// causes.repository — SQL shape de platform_donations.causes.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/causes.repository.js'

function mockClient(rows = [], rowCount) {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount: rowCount ?? rows.length }) }
}

describe('list', () => {
  it('onlyActive default → WHERE active = TRUE; ORDER BY position, created_at', async () => {
    const c = mockClient([{ id: 'cz1' }])
    const out = await repo.list(c)
    const [sql] = c.query.mock.calls[0]
    expect(sql).toMatch(/FROM platform_donations\.causes/)
    expect(sql).toMatch(/WHERE active = TRUE/)
    expect(sql).toMatch(/ORDER BY position, created_at/)
    expect(out).toEqual([{ id: 'cz1' }])
  })
  it('onlyActive:false → sin WHERE', async () => {
    const c = mockClient([])
    await repo.list(c, { onlyActive: false })
    expect(c.query.mock.calls[0][0]).not.toMatch(/WHERE active/)
  })
})

describe('findById', () => {
  it('WHERE id=$1 LIMIT 1', async () => {
    const c = mockClient([{ id: 'cz1' }])
    expect(await repo.findById(c, 'cz1')).toEqual({ id: 'cz1' })
    expect(c.query.mock.calls[0][1]).toEqual(['cz1'])
  })
  it('sin row → null', async () => {
    expect(await repo.findById(mockClient([]), 'ghost')).toBeNull()
  })
})

describe('findByCode', () => {
  it('scope app_id + tenant_id + code', async () => {
    const c = mockClient([{ id: 'cz1' }])
    await repo.findByCode(c, 'aikikan', 't1', 'CODE')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE app_id = \$1 AND tenant_id = \$2 AND code = \$3/)
    expect(params).toEqual(['aikikan', 't1', 'CODE'])
  })
  it('sin row → null', async () => {
    expect(await repo.findByCode(mockClient([]), 'a', 't', 'c')).toBeNull()
  })
})

describe('insert', () => {
  it('INSERT 14 params; COALESCE active/position; defaults; suggested_amounts', async () => {
    const c = mockClient([{ id: 'cz1' }])
    await repo.insert(c, {
      appId: 'aikikan', tenantId: 't1', subTenantId: null, code: 'CODE', name: 'Cause',
      description: 'desc', targetCents: 10000, currency: 'usd', imageObjectId: 'img',
      active: true, position: 2, startsAt: '2026-01-01', endsAt: '2026-12-31',
      suggestedAmountsCents: [1000, 2500],
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_donations\.causes/)
    expect(sql).toMatch(/COALESCE\(\$10, TRUE\), COALESCE\(\$11, 0\)/)
    expect(params).toEqual([
      'aikikan', 't1', null, 'CODE', 'Cause', 'desc', 10000, 'usd', 'img',
      true, 2, '2026-01-01', '2026-12-31', [1000, 2500],
    ])
  })
  it('opcionales ausentes → null + currency EUR default', async () => {
    const c = mockClient([{ id: 'cz1' }])
    await repo.insert(c, { appId: 'a', tenantId: 't', code: 'C', name: 'N' })
    const params = c.query.mock.calls[0][1]
    expect(params).toEqual(['a', 't', null, 'C', 'N', null, null, 'EUR', null, undefined, undefined, null, null, null])
  })
})

describe('update', () => {
  it('COALESCE en todos los campos; WHERE id=$1', async () => {
    const c = mockClient([{ id: 'cz1' }])
    await repo.update(c, 'cz1', { name: 'New', active: false, position: 3 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/name\s+= COALESCE\(\$2, name\)/)
    expect(sql).toMatch(/WHERE id = \$1/)
    expect(params).toEqual(['cz1', 'New', null, null, null, false, 3, null, null, null])
  })
  it('patch vacío → todos null; row inexistente → null', async () => {
    const c = mockClient([])
    expect(await repo.update(c, 'ghost', {})).toBeNull()
    expect(c.query.mock.calls[0][1]).toEqual(['ghost', null, null, null, null, null, null, null, null, null])
  })
})

describe('softDelete', () => {
  it('SET active = FALSE; rowCount>0 → true', async () => {
    const c = mockClient([], 1)
    expect(await repo.softDelete(c, 'cz1')).toBe(true)
    expect(c.query.mock.calls[0][0]).toMatch(/SET active = FALSE/)
    expect(c.query.mock.calls[0][1]).toEqual(['cz1'])
  })
  it('rowCount 0 → false', async () => {
    expect(await repo.softDelete(mockClient([], 0), 'ghost')).toBe(false)
  })
})

describe('incrementRaised', () => {
  it('raised_cents += $2', async () => {
    const c = mockClient([])
    await repo.incrementRaised(c, 'cz1', 500)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/raised_cents = raised_cents \+ \$2/)
    expect(params).toEqual(['cz1', 500])
  })
})
