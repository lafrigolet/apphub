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
      splitRuleId: 'rule-1', merchantAccountId: 'acct_1', platformFee: 500,
      transferGroup: 'pi_idem-1', metadata: { k: 'v' },
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO payments\.transactions/)
    expect(params[9]).toBe('pi_idem-1')                  // transfer_group
    expect(params[10]).toBe(JSON.stringify({ k: 'v' }))  // metadata
    expect(r).toMatchObject({ id: 'p1', stripePaymentIntentId: 'pi_1' })
  })
})

describe('insertRefund', () => {
  it('INSERT en payments.refunds con reversals JSON + scoping de tenant', async () => {
    const c = mockClient([{ id: 'rf1' }])
    const r = await repo.insertRefund(c, ctx, {
      transactionId: 'p1', stripeRefundId: 're_1', amount: 5000, currency: 'eur',
      reason: 'fraudulent', reversals: [{ transferId: 'tr_A', amount: 3000 }],
      idempotencyKey: 'idem-1',
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO payments\.refunds/)
    expect(sql).toMatch(/ON CONFLICT \(stripe_refund_id\) DO NOTHING/)
    expect(params[0]).toBe('t1')                                       // tenant_id
    expect(params[2]).toBe('p1')                                       // transaction_id
    expect(params[3]).toBe('re_1')                                     // stripe_refund_id
    expect(params[7]).toBe(JSON.stringify([{ transferId: 'tr_A', amount: 3000 }]))
    expect(r).toEqual({ id: 'rf1' })
  })

  it('ON CONFLICT (duplicado) → devuelve null', async () => {
    const c = mockClient([])
    const r = await repo.insertRefund(c, ctx, {
      transactionId: 'p1', stripeRefundId: 're_dup', amount: 1, currency: 'eur',
      idempotencyKey: 'idem-2',
    })
    expect(r).toBeNull()
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

describe('listPaymentsForExport (priority #6)', () => {
  it('sin rango: WHERE tenant + ORDER BY created_at ASC + LIMIT default', async () => {
    const c = mockClient([row])
    await repo.listPaymentsForExport(c, ctx)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE tenant_id = \$1/)
    expect(sql).toMatch(/ORDER BY created_at ASC/)
    expect(params).toEqual(['t1', 10000])
  })

  it('con from + to añade condiciones y params en orden', async () => {
    const c = mockClient([])
    await repo.listPaymentsForExport(c, ctx, { from: '2026-01-01', to: '2026-02-01', limit: 500 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/created_at >= \$2/)
    expect(sql).toMatch(/created_at <= \$3/)
    expect(params).toEqual(['t1', '2026-01-01', '2026-02-01', 500])
  })

  it('mapea filas a objetos de pago (rowToPayment)', async () => {
    const c = mockClient([row])
    const r = await repo.listPaymentsForExport(c, ctx)
    expect(r[0]).toMatchObject({ id: 'p1', stripePaymentIntentId: 'pi_1' })
  })
})
