// connect-account.repository — SQL shape de payments.connect_accounts + rowToAccount.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/connect-account.repository.js'

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

const row = {
  id: 'ca1', tenant_id: 't1', sub_tenant_id: 'st1', stripe_account_id: 'acct_1',
  email: 'm@x.com', status: 'pending', payouts_enabled: false, charges_enabled: false,
  created_at: 'C', updated_at: 'U',
}
const ctx = { tenantId: 't1', subTenantId: 'st1' }

describe('insertConnectAccount', () => {
  it('INSERT con params + mapea a camelCase', async () => {
    const c = mockClient([row])
    const r = await repo.insertConnectAccount(c, ctx, { stripeAccountId: 'acct_1', email: 'm@x.com' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO payments\.connect_accounts/)
    expect(params).toEqual(['t1', 'st1', 'acct_1', 'm@x.com'])
    expect(r).toMatchObject({ id: 'ca1', stripeAccountId: 'acct_1', payoutsEnabled: false })
  })
})

describe('findConnectAccountByStripeId', () => {
  it('encontrado → account', async () => {
    const c = mockClient([row])
    const r = await repo.findConnectAccountByStripeId(c, 'acct_1')
    expect(c.query.mock.calls[0][1]).toEqual(['acct_1'])
    expect(r.stripeAccountId).toBe('acct_1')
  })

  it('no encontrado → null', async () => {
    const c = mockClient([])
    expect(await repo.findConnectAccountByStripeId(c, 'acct_x')).toBeNull()
  })
})

describe('findConnectAccountById', () => {
  it('encontrado → account', async () => {
    const c = mockClient([row])
    const r = await repo.findConnectAccountById(c, ctx, 'ca1')
    expect(c.query.mock.calls[0][1]).toEqual(['ca1', 't1'])
    expect(r.id).toBe('ca1')
  })

  it('no encontrado → NotFoundError', async () => {
    const c = mockClient([])
    await expect(repo.findConnectAccountById(c, ctx, 'nope')).rejects.toThrow(/Connect account/)
  })
})

describe('updateConnectAccountStatus', () => {
  it('UPDATE con params en orden', async () => {
    const c = mockClient([])
    await repo.updateConnectAccountStatus(c, 'acct_1', 'active', true, true)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/UPDATE payments\.connect_accounts/)
    expect(params).toEqual(['active', true, true, 'acct_1'])
  })
})

describe('listConnectAccounts', () => {
  it('filtra por tenant + ORDER BY created_at DESC', async () => {
    const c = mockClient([row, row])
    const r = await repo.listConnectAccounts(c, ctx)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/ORDER BY created_at DESC/)
    expect(params).toEqual(['t1'])
    expect(r).toHaveLength(2)
  })
})
