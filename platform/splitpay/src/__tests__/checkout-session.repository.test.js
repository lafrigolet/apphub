// checkout-session.repository — SQL shape de splitpay_core.checkout_sessions.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/checkout-session.repository.js'

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

const ctx = { tenantId: 't1', subTenantId: 'st1', appId: 'aikikan' }

describe('insert', () => {
  it('INSERT con params en orden y status=open', async () => {
    const c = mockClient([{ id: 's1' }])
    const r = await repo.insert(c, ctx, {
      mode: 'payment', stripeSessionId: 'cs_1', currency: 'eur',
      splitRuleId: 'rule-1', metadata: { k: 'v' }, idempotencyKey: 'idem-1',
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO splitpay_core\.checkout_sessions/)
    expect(sql).toMatch(/'open'/)
    expect(params).toEqual(['t1', 'st1', 'aikikan', 'payment', 'cs_1', 'eur', 'rule-1', { k: 'v' }, 'idem-1'])
    expect(r).toEqual({ id: 's1' })
  })

  it('campos opcionales ausentes → null / {}', async () => {
    const c = mockClient([{ id: 's1' }])
    await repo.insert(c, { tenantId: 't1' }, { mode: 'payment', stripeSessionId: 'cs', currency: 'usd' })
    const params = c.query.mock.calls[0][1]
    expect(params[1]).toBeNull() // sub_tenant_id
    expect(params[2]).toBeNull() // app_id
    expect(params[6]).toBeNull() // split_rule_id
    expect(params[7]).toEqual({}) // metadata
    expect(params[8]).toBeNull() // idempotency_key
  })
})

describe('findByStripeSessionId', () => {
  it('SELECT por stripe_session_id sin filtro tenant', async () => {
    const c = mockClient([{ id: 's1' }])
    const r = await repo.findByStripeSessionId(c, 'cs_1')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE stripe_session_id = \$1/)
    expect(params).toEqual(['cs_1'])
    expect(r).toEqual({ id: 's1' })
  })

  it('sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.findByStripeSessionId(c, 'cs_x')).toBeNull()
  })
})

describe('markCompleted', () => {
  it('UPDATE con COALESCE y params completos', async () => {
    const c = mockClient([{ id: 's1', status: 'completed' }])
    const r = await repo.markCompleted(c, 'cs_1', {
      paymentIntentId: 'pi_1', subscriptionId: 'sub_1', customerId: 'cus_1', amount: 5000,
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/status = 'completed'/)
    expect(params).toEqual(['cs_1', 'pi_1', 'sub_1', 'cus_1', 5000])
    expect(r.status).toBe('completed')
  })

  it('fields ausentes → null para cada COALESCE', async () => {
    const c = mockClient([{ id: 's1' }])
    await repo.markCompleted(c, 'cs_1', {})
    const params = c.query.mock.calls[0][1]
    expect(params).toEqual(['cs_1', null, null, null, null])
  })

  it('sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.markCompleted(c, 'cs_x', {})).toBeNull()
  })
})

describe('listForTenant', () => {
  it('SELECT con filtro tenant + LIMIT default 50', async () => {
    const c = mockClient([{ id: 's1' }, { id: 's2' }])
    const r = await repo.listForTenant(c, ctx)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE tenant_id = \$1/)
    expect(params).toEqual(['t1', 50])
    expect(r).toHaveLength(2)
  })

  it('limit explícito', async () => {
    const c = mockClient([])
    await repo.listForTenant(c, ctx, 10)
    expect(c.query.mock.calls[0][1]).toEqual(['t1', 10])
  })
})
