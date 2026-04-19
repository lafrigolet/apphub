import { describe, it, expect, vi } from 'vitest'
import * as txRepo from '../repositories/transaction.repository.js'

const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const USER_ID = '11111111-1111-1111-1111-111111111111'
const TX_ID = '88888888-8888-8888-8888-888888888888'
const PROVIDER_TX_ID = 'cs_test_stripe_session_id'
const BONUS_TYPE_ID = '77777777-7777-7777-7777-777777777777'

function makeClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }), release: vi.fn() }
}

const tx = {
  id: TX_ID, user_id: USER_ID, provider: 'stripe',
  provider_tx_id: PROVIDER_TX_ID, amount_eur: 80, status: 'pending', tenant_id: TENANT_ID,
}

describe('transaction.repository', () => {
  describe('createTransaction', () => {
    it('inserts transaction in pending status with tenant columns', async () => {
      const client = makeClient([tx])
      const result = await txRepo.createTransaction(client, {
        id: TX_ID, userId: USER_ID, bonusTypeId: BONUS_TYPE_ID, provider: 'stripe',
        providerTxId: PROVIDER_TX_ID, amountEur: 80, tenantId: TENANT_ID, subTenantId: null,
      })
      expect(result).toEqual(tx)
      const [sql, params] = client.query.mock.calls[0]
      expect(sql).toContain("'pending'")
      expect(sql).toContain('tenant_id')
      expect(sql).toContain('sub_tenant_id')
      expect(params).toContain(TENANT_ID)
    })
  })

  describe('completeTransaction', () => {
    it('sets status to completed by provider_tx_id', async () => {
      const completed = { ...tx, status: 'completed' }
      const client = makeClient([completed])
      const result = await txRepo.completeTransaction(client, PROVIDER_TX_ID)
      expect(result).toEqual(completed)
      const [sql, params] = client.query.mock.calls[0]
      expect(sql).toContain("status = 'completed'")
      expect(sql).toContain('completed_at = now()')
      expect(params).toEqual([PROVIDER_TX_ID])
    })

    it('returns null when transaction not found', async () => {
      const client = makeClient([])
      expect(await txRepo.completeTransaction(client, 'unknown')).toBeNull()
    })
  })

  describe('listByUser', () => {
    it('returns transactions for user scoped to tenant, ordered by date desc', async () => {
      const client = makeClient([tx])
      const result = await txRepo.listByUser(client, USER_ID, TENANT_ID)
      expect(result).toEqual([tx])
      const [sql, params] = client.query.mock.calls[0]
      expect(sql).toContain('ORDER BY created_at DESC')
      expect(params).toEqual([USER_ID, TENANT_ID])
    })
  })

  describe('refundTransaction', () => {
    it('sets status to refunded scoped to tenant', async () => {
      const refunded = { ...tx, status: 'refunded' }
      const client = makeClient([refunded])
      const result = await txRepo.refundTransaction(client, TX_ID, TENANT_ID)
      expect(result).toEqual(refunded)
      const [sql, params] = client.query.mock.calls[0]
      expect(sql).toContain("SET status = 'refunded'")
      expect(sql).toContain('tenant_id = $2')
      expect(params).toEqual([TX_ID, TENANT_ID])
    })

    it('returns null when transaction not found', async () => {
      expect(await txRepo.refundTransaction(makeClient([]), 'x', TENANT_ID)).toBeNull()
    })
  })

  describe('findByProviderTxId', () => {
    it('looks up transaction by Stripe session id', async () => {
      const client = makeClient([tx])
      const result = await txRepo.findByProviderTxId(client, PROVIDER_TX_ID)
      expect(result).toEqual(tx)
      const [sql, params] = client.query.mock.calls[0]
      expect(sql).toContain('WHERE provider_tx_id = $1')
      expect(params).toEqual([PROVIDER_TX_ID])
    })

    it('returns null when not found', async () => {
      expect(await txRepo.findByProviderTxId(makeClient([]), 'unknown')).toBeNull()
    })
  })
})
