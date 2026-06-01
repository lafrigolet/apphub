// payment.repository — SQL shape de payments.transactions + paginación por cursor.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/payment.repository.js'

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

const row = {
  id: 'p1', tenant_id: 't1', sub_tenant_id: null, stripe_payment_intent_id: 'pi_1',
  amount: 5000, currency: 'eur', status: 'succeeded', split_rule_id: 'rule-1',
  merchant_account_id: 'acct_1', platform_fee: 500, metadata: { k: 'v' },
  created_at: 'C', updated_at: 'U',
}
const ctx = { tenantId: 't1', subTenantId: null }

describe('insertPayment', () => {
  it('INSERT con params + metadata stringificada', async () => {
    const c = mockClient([row])
    const r = await repo.insertPayment(c, ctx, {
      stripePaymentIntentId: 'pi_1', amount: 5000, currency: 'eur', status: 'pending',
      splitRuleId: 'rule-1', merchantAccountId: 'acct_1', platformFee: 500, metadata: { k: 'v' },
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO payments\.transactions/)
    expect(params[9]).toBe(JSON.stringify({ k: 'v' }))
    expect(r).toMatchObject({ id: 'p1', stripePaymentIntentId: 'pi_1' })
  })
})

describe('findPaymentById', () => {
  it('encontrado → payment con metadata', async () => {
    const c = mockClient([row])
    const r = await repo.findPaymentById(c, ctx, 'p1')
    expect(c.query.mock.calls[0][1]).toEqual(['p1', 't1'])
    expect(r.metadata).toEqual({ k: 'v' })
  })

  it('metadata null → {} en rowToPayment', async () => {
    const c = mockClient([{ ...row, metadata: null }])
    const r = await repo.findPaymentById(c, ctx, 'p1')
    expect(r.metadata).toEqual({})
  })

  it('no encontrado → NotFoundError', async () => {
    const c = mockClient([])
    await expect(repo.findPaymentById(c, ctx, 'nope')).rejects.toThrow(/Payment/)
  })
})

describe('findPaymentByStripeId', () => {
  it('encontrado → payment', async () => {
    const c = mockClient([row])
    const r = await repo.findPaymentByStripeId(c, 'pi_1')
    expect(c.query.mock.calls[0][1]).toEqual(['pi_1'])
    expect(r.stripePaymentIntentId).toBe('pi_1')
  })

  it('no encontrado → null', async () => {
    const c = mockClient([])
    expect(await repo.findPaymentByStripeId(c, 'pi_x')).toBeNull()
  })
})

describe('updatePaymentStatus', () => {
  it('UPDATE status por stripe id', async () => {
    const c = mockClient([])
    await repo.updatePaymentStatus(c, 'pi_1', 'succeeded')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET status = \$1/)
    expect(params).toEqual(['succeeded', 'pi_1'])
  })
})

describe('listPayments', () => {
  it('sin cursor → sin cursorClause, LIMIT default 20', async () => {
    const c = mockClient([row])
    await repo.listPayments(c, ctx)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).not.toMatch(/created_at </)
    expect(params).toEqual(['t1', 20])
  })

  it('con cursor → añade cursorClause y param extra', async () => {
    const c = mockClient([row])
    await repo.listPayments(c, ctx, 5, 'cursor-id')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/created_at < \(SELECT created_at/)
    expect(params).toEqual(['t1', 5, 'cursor-id'])
  })
})
