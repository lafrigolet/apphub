// donation-subscriptions.repository — SQL shape de
// platform_donations.donation_subscriptions.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/donation-subscriptions.repository.js'

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

describe('upsertByStripeId', () => {
  it('INSERT ... ON CONFLICT (stripe_subscription_id) DO UPDATE; 15 params', async () => {
    const c = mockClient([{ id: 's1' }])
    await repo.upsertByStripeId(c, {
      appId: 'aikikan', tenantId: 't1', subTenantId: null, causeId: 'cz1',
      donorUserId: 'u1', donorEmail: 'd@x.com', donorName: 'Don', donorNif: 'X1',
      amountCents: 1000, currency: 'usd', status: 'active',
      stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1',
      currentPeriodEnd: '2026-02-01', cancelAtPeriodEnd: true,
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_donations\.donation_subscriptions/)
    expect(sql).toMatch(/ON CONFLICT \(stripe_subscription_id\) DO UPDATE/)
    expect(sql).toMatch(/COALESCE\(\$15, FALSE\)/)
    expect(params).toEqual([
      'aikikan', 't1', null, 'cz1', 'u1', 'd@x.com', 'Don', 'X1',
      1000, 'usd', 'active', 'sub_1', 'cus_1', '2026-02-01', true,
    ])
  })
  it('opcionales ausentes → defaults (EUR, false, null)', async () => {
    const c = mockClient([{ id: 's1' }])
    await repo.upsertByStripeId(c, {
      appId: 'a', tenantId: 't', donorEmail: 'd@x', amountCents: 100, status: 'active',
      stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1',
    })
    const params = c.query.mock.calls[0][1]
    expect(params[9]).toBe('EUR')   // currency
    expect(params[14]).toBe(false)  // cancelAtPeriodEnd
    expect(params[13]).toBeNull()   // currentPeriodEnd
  })
})

describe('findById / findByStripeId', () => {
  it('findById WHERE id=$1', async () => {
    const c = mockClient([{ id: 's1' }])
    expect(await repo.findById(c, 's1')).toEqual({ id: 's1' })
    expect(c.query.mock.calls[0][1]).toEqual(['s1'])
  })
  it('findById sin row → null', async () => {
    expect(await repo.findById(mockClient([]), 'g')).toBeNull()
  })
  it('findByStripeId WHERE stripe_subscription_id=$1', async () => {
    const c = mockClient([{ id: 's1' }])
    await repo.findByStripeId(c, 'sub_1')
    expect(c.query.mock.calls[0][0]).toMatch(/WHERE stripe_subscription_id = \$1/)
    expect(c.query.mock.calls[0][1]).toEqual(['sub_1'])
  })
  it('findByStripeId sin row → null', async () => {
    expect(await repo.findByStripeId(mockClient([]), 'sub')).toBeNull()
  })
})

describe('listForDonor', () => {
  it('WHERE donor_user_id=$1; ORDER created_at DESC', async () => {
    const c = mockClient([{ id: 's1' }])
    const out = await repo.listForDonor(c, 'u1')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE donor_user_id = \$1/)
    expect(sql).toMatch(/ORDER BY created_at DESC/)
    expect(params).toEqual(['u1'])
    expect(out).toEqual([{ id: 's1' }])
  })
})

describe('markCancelled', () => {
  it("status='cancelled'; stamp cancelled_at; WHERE id=$1", async () => {
    const c = mockClient([{ id: 's1', status: 'cancelled' }])
    await repo.markCancelled(c, 's1')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET status = 'cancelled', cancelled_at = now\(\)/)
    expect(sql).toMatch(/WHERE id = \$1/)
    expect(params).toEqual(['s1'])
  })
  it('sin row → null', async () => {
    expect(await repo.markCancelled(mockClient([]), 'g')).toBeNull()
  })
})
