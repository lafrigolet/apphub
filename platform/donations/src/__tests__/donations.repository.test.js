// donations.repository — SQL shape de platform_donations.donations.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/donations.repository.js'

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

describe('insert', () => {
  it('INSERT 17 params en orden; defaults currency/status/anonymous', async () => {
    const c = mockClient([{ id: 'd1' }])
    await repo.insert(c, {
      appId: 'aikikan', tenantId: 't1', subTenantId: null, causeId: 'cz1',
      donorUserId: 'u1', donorEmail: 'd@x.com', donorName: 'Don', donorNif: 'X1',
      donorAddress: 'Calle', donorPostalCode: '28001', donorCountry: 'ES',
      amountCents: 5000, currency: 'usd', status: 'pending', kind: 'one_time',
      anonymous: true, message: 'hi',
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_donations\.donations/)
    expect(params).toEqual([
      'aikikan', 't1', null, 'cz1', 'u1', 'd@x.com', 'Don', 'X1',
      'Calle', '28001', 'ES', 5000, 'usd', 'pending', 'one_time', true, 'hi',
    ])
  })
  it('opcionales ausentes → defaults (EUR, pending, false, null)', async () => {
    const c = mockClient([{ id: 'd1' }])
    await repo.insert(c, { appId: 'a', tenantId: 't', donorEmail: 'd@x', amountCents: 100, kind: 'one_time' })
    const params = c.query.mock.calls[0][1]
    expect(params[12]).toBe('EUR')   // currency
    expect(params[13]).toBe('pending') // status
    expect(params[15]).toBe(false)   // anonymous
  })
})

describe('findById / findBySessionId', () => {
  it('findById WHERE id=$1', async () => {
    const c = mockClient([{ id: 'd1' }])
    expect(await repo.findById(c, 'd1')).toEqual({ id: 'd1' })
    expect(c.query.mock.calls[0][1]).toEqual(['d1'])
  })
  it('findById sin row → null', async () => {
    expect(await repo.findById(mockClient([]), 'g')).toBeNull()
  })
  it('findBySessionId WHERE stripe_session_id=$1', async () => {
    const c = mockClient([{ id: 'd1' }])
    await repo.findBySessionId(c, 'cs_123')
    expect(c.query.mock.calls[0][0]).toMatch(/WHERE stripe_session_id = \$1/)
    expect(c.query.mock.calls[0][1]).toEqual(['cs_123'])
  })
  it('findBySessionId sin row → null', async () => {
    expect(await repo.findBySessionId(mockClient([]), 'cs')).toBeNull()
  })
})

describe('attachSession', () => {
  it('UPDATE stripe_session_id=$2 WHERE id=$1', async () => {
    const c = mockClient([{ id: 'd1' }])
    await repo.attachSession(c, 'd1', 'cs_123')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET stripe_session_id = \$2/)
    expect(params).toEqual(['d1', 'cs_123'])
  })
  it('sin row → null', async () => {
    expect(await repo.attachSession(mockClient([]), 'g', 's')).toBeNull()
  })
})

describe('markPaid', () => {
  it("status='paid'; COALESCE pi/paidAt; guard WHERE status IN pending/failed", async () => {
    const c = mockClient([{ id: 'd1', status: 'paid' }])
    await repo.markPaid(c, 'd1', { paymentIntentId: 'pi_1', paidAt: '2026-01-01' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/status\s+= 'paid'/)
    expect(sql).toMatch(/WHERE id = \$1 AND status IN \('pending','failed'\)/)
    expect(params).toEqual(['d1', 'pi_1', '2026-01-01'])
  })
  it('sin paymentIntent/paidAt → null params; no row → null', async () => {
    const c = mockClient([])
    expect(await repo.markPaid(c, 'd1', {})).toBeNull()
    expect(c.query.mock.calls[0][1]).toEqual(['d1', null, null])
  })
})

describe('markRefunded', () => {
  it("status='refunded'; reason=$2; guard WHERE status='paid'", async () => {
    const c = mockClient([{ id: 'd1' }])
    await repo.markRefunded(c, 'd1', 'fraude')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/status\s+= 'refunded'/)
    expect(sql).toMatch(/WHERE id = \$1 AND status = 'paid'/)
    expect(params).toEqual(['d1', 'fraude'])
  })
  it('reason ausente → null; no row → null', async () => {
    const c = mockClient([])
    expect(await repo.markRefunded(c, 'd1')).toBeNull()
    expect(c.query.mock.calls[0][1]).toEqual(['d1', null])
  })
})

describe('listForDonor', () => {
  it('WHERE donor_user_id=$1; ORDER paid_at DESC NULLS LAST; LIMIT default 100', async () => {
    const c = mockClient([{ id: 'd1' }])
    const out = await repo.listForDonor(c, 'u1')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE donor_user_id = \$1/)
    expect(sql).toMatch(/ORDER BY paid_at DESC NULLS LAST, created_at DESC/)
    expect(params).toEqual(['u1', 100])
    expect(out).toEqual([{ id: 'd1' }])
  })
  it('limit custom', async () => {
    const c = mockClient([])
    await repo.listForDonor(c, 'u1', { limit: 10 })
    expect(c.query.mock.calls[0][1]).toEqual(['u1', 10])
  })
})

describe('listAdmin', () => {
  it('sin filtros → no WHERE; LIMIT/OFFSET defaults', async () => {
    const c = mockClient([])
    await repo.listAdmin(c, {})
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).not.toMatch(/WHERE/)
    expect(params).toEqual([200, 0])
  })
  it('todos los filtros → WHERE compuesto con cause_id/status/paid_at >=/<=', async () => {
    const c = mockClient([])
    await repo.listAdmin(c, {
      causeId: 'cz1', status: 'paid', fromDate: '2026-01-01', toDate: '2026-12-31',
      limit: 50, offset: 5,
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE cause_id = \$1 AND status = \$2 AND paid_at >= \$3 AND paid_at <= \$4/)
    expect(params).toEqual(['cz1', 'paid', '2026-01-01', '2026-12-31', 50, 5])
  })
  it('sin args → defaults', async () => {
    const c = mockClient([])
    await repo.listAdmin(c)
    expect(c.query.mock.calls[0][1]).toEqual([200, 0])
  })
})

describe('listByNifAndYear', () => {
  it('WHERE donor_nif NOT NULL + status paid + EXTRACT YEAR=$1', async () => {
    const c = mockClient([{ donor_nif: 'X1' }])
    const out = await repo.listByNifAndYear(c, 2025)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE donor_nif IS NOT NULL/)
    expect(sql).toMatch(/AND status = 'paid'/)
    expect(sql).toMatch(/EXTRACT\(YEAR FROM paid_at\) = \$1/)
    expect(sql).toMatch(/ORDER BY donor_nif, paid_at/)
    expect(params).toEqual([2025])
    expect(out).toEqual([{ donor_nif: 'X1' }])
  })
})
