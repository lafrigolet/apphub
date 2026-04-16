import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NotFoundError } from '../../src/utils/errors.js'

// Repositories receive a `client` argument — no module mocks needed

import {
  insertPayment,
  findPaymentById,
  findPaymentByStripeId,
  updatePaymentStatus,
  listPayments,
} from '../../src/repositories/payment.repository.js'

import {
  insertConnectAccount,
  findConnectAccountByStripeId,
  findConnectAccountById,
  updateConnectAccountStatus,
  listConnectAccounts,
} from '../../src/repositories/connect-account.repository.js'

import {
  createSplitRule,
  findSplitRuleById,
  listSplitRules,
  deactivateSplitRule,
} from '../../src/repositories/split-rule.repository.js'

const ctx = { tenantId: 'tenant-abc', subTenantId: null }

const paymentRow = {
  id: 'pay-uuid-1',
  tenant_id: 'tenant-abc',
  sub_tenant_id: null,
  stripe_payment_intent_id: 'pi_test_123',
  amount: 10000,
  currency: 'eur',
  status: 'requires_payment_method',
  split_rule_id: 'rule-uuid-1',
  merchant_account_id: 'acct_123',
  platform_fee: 1500,
  metadata: {},
  created_at: new Date('2025-01-01'),
  updated_at: new Date('2025-01-01'),
}

const accountRow = {
  id: 'acc-uuid-1',
  tenant_id: 'tenant-abc',
  sub_tenant_id: null,
  stripe_account_id: 'acct_test_123',
  email: 'merchant@example.com',
  status: 'pending',
  payouts_enabled: false,
  charges_enabled: false,
  created_at: new Date('2025-01-01'),
  updated_at: new Date('2025-01-01'),
}

const splitRuleRow = {
  id: 'rule-uuid-1',
  tenant_id: 'tenant-abc',
  sub_tenant_id: null,
  name: 'Test Rule',
  platform_fee_percent: '15',
  recipients: JSON.stringify([{ accountId: 'acct_123', label: 'Merchant', percentage: 85 }]),
  active: true,
  created_at: new Date('2025-01-01'),
  updated_at: new Date('2025-01-01'),
}

let mockClient

beforeEach(() => {
  mockClient = { query: vi.fn() }
})

// ── payment.repository ───────────────────────────────────────────────────────

describe('payment.repository', () => {
  describe('insertPayment', () => {
    it('inserts and returns mapped payment', async () => {
      mockClient.query.mockResolvedValue({ rows: [paymentRow] })

      const result = await insertPayment(mockClient, ctx, {
        stripePaymentIntentId: 'pi_test_123',
        amount: 10000,
        currency: 'eur',
        status: 'requires_payment_method',
        splitRuleId: 'rule-uuid-1',
        merchantAccountId: 'acct_123',
        platformFee: 1500,
        metadata: {},
      })

      expect(result.id).toBe('pay-uuid-1')
      expect(result.tenantId).toBe('tenant-abc')
      expect(result.stripePaymentIntentId).toBe('pi_test_123')
      expect(result.amount).toBe(10000)
    })
  })

  describe('findPaymentById', () => {
    it('returns mapped payment when found', async () => {
      mockClient.query.mockResolvedValue({ rows: [paymentRow] })

      const result = await findPaymentById(mockClient, ctx, 'pay-uuid-1')

      expect(result.id).toBe('pay-uuid-1')
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = $1'),
        ['pay-uuid-1', 'tenant-abc'],
      )
    })

    it('throws NotFoundError when not found', async () => {
      mockClient.query.mockResolvedValue({ rows: [] })

      await expect(findPaymentById(mockClient, ctx, 'missing-uuid')).rejects.toThrow(NotFoundError)
    })
  })

  describe('findPaymentByStripeId', () => {
    it('returns mapped payment when found', async () => {
      mockClient.query.mockResolvedValue({ rows: [paymentRow] })

      const result = await findPaymentByStripeId(mockClient, 'pi_test_123')

      expect(result.stripePaymentIntentId).toBe('pi_test_123')
    })

    it('returns null when not found', async () => {
      mockClient.query.mockResolvedValue({ rows: [] })

      const result = await findPaymentByStripeId(mockClient, 'pi_unknown')

      expect(result).toBeNull()
    })
  })

  describe('updatePaymentStatus', () => {
    it('executes update query', async () => {
      mockClient.query.mockResolvedValue({ rowCount: 1 })

      await updatePaymentStatus(mockClient, 'pi_test_123', 'succeeded')

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('SET status = $1'),
        ['succeeded', 'pi_test_123'],
      )
    })
  })

  describe('listPayments', () => {
    it('returns mapped payments without cursor', async () => {
      mockClient.query.mockResolvedValue({ rows: [paymentRow] })

      const result = await listPayments(mockClient, ctx, 20, undefined)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('pay-uuid-1')
    })

    it('includes cursor clause when cursor is provided', async () => {
      mockClient.query.mockResolvedValue({ rows: [] })

      await listPayments(mockClient, ctx, 20, 'some-cursor-id')

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('AND created_at <'),
        expect.arrayContaining(['some-cursor-id']),
      )
    })
  })
})

// ── connect-account.repository ───────────────────────────────────────────────

describe('connect-account.repository', () => {
  describe('insertConnectAccount', () => {
    it('inserts and returns mapped account', async () => {
      mockClient.query.mockResolvedValue({ rows: [accountRow] })

      const result = await insertConnectAccount(mockClient, ctx, {
        stripeAccountId: 'acct_test_123',
        email: 'merchant@example.com',
      })

      expect(result.id).toBe('acc-uuid-1')
      expect(result.stripeAccountId).toBe('acct_test_123')
    })
  })

  describe('findConnectAccountByStripeId', () => {
    it('returns mapped account when found', async () => {
      mockClient.query.mockResolvedValue({ rows: [accountRow] })

      const result = await findConnectAccountByStripeId(mockClient, 'acct_test_123')

      expect(result.stripeAccountId).toBe('acct_test_123')
    })

    it('returns null when not found', async () => {
      mockClient.query.mockResolvedValue({ rows: [] })

      const result = await findConnectAccountByStripeId(mockClient, 'acct_unknown')

      expect(result).toBeNull()
    })
  })

  describe('findConnectAccountById', () => {
    it('returns mapped account when found', async () => {
      mockClient.query.mockResolvedValue({ rows: [accountRow] })

      const result = await findConnectAccountById(mockClient, ctx, 'acc-uuid-1')

      expect(result.id).toBe('acc-uuid-1')
    })

    it('throws NotFoundError when not found', async () => {
      mockClient.query.mockResolvedValue({ rows: [] })

      await expect(findConnectAccountById(mockClient, ctx, 'missing')).rejects.toThrow(NotFoundError)
    })
  })

  describe('updateConnectAccountStatus', () => {
    it('executes update query', async () => {
      mockClient.query.mockResolvedValue({ rowCount: 1 })

      await updateConnectAccountStatus(mockClient, 'acct_test_123', 'active', true, true)

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('SET status = $1'),
        ['active', true, true, 'acct_test_123'],
      )
    })
  })

  describe('listConnectAccounts', () => {
    it('returns mapped accounts', async () => {
      mockClient.query.mockResolvedValue({ rows: [accountRow] })

      const result = await listConnectAccounts(mockClient, ctx)

      expect(result).toHaveLength(1)
      expect(result[0].tenantId).toBe('tenant-abc')
    })
  })
})

// ── split-rule.repository ────────────────────────────────────────────────────

describe('split-rule.repository', () => {
  describe('createSplitRule', () => {
    it('inserts and returns mapped split rule', async () => {
      mockClient.query.mockResolvedValue({ rows: [splitRuleRow] })

      const result = await createSplitRule(mockClient, ctx, {
        name: 'Test Rule',
        platformFeePercent: 15,
        recipients: [{ accountId: 'acct_123', label: 'Merchant', percentage: 85 }],
      })

      expect(result.id).toBe('rule-uuid-1')
      expect(result.platformFeePercent).toBe(15)
      expect(result.recipients).toHaveLength(1)
    })
  })

  describe('findSplitRuleById', () => {
    it('returns mapped split rule when found', async () => {
      mockClient.query.mockResolvedValue({ rows: [splitRuleRow] })

      const result = await findSplitRuleById(mockClient, ctx, 'rule-uuid-1')

      expect(result.id).toBe('rule-uuid-1')
      expect(result.active).toBe(true)
    })

    it('throws NotFoundError when not found', async () => {
      mockClient.query.mockResolvedValue({ rows: [] })

      await expect(findSplitRuleById(mockClient, ctx, 'missing')).rejects.toThrow(NotFoundError)
    })
  })

  describe('listSplitRules', () => {
    it('returns mapped split rules with string recipients', async () => {
      mockClient.query.mockResolvedValue({ rows: [splitRuleRow] })

      const result = await listSplitRules(mockClient, ctx)

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Test Rule')
      expect(result[0].recipients).toHaveLength(1)
    })

    it('handles already-parsed recipients', async () => {
      mockClient.query.mockResolvedValue({
        rows: [{
          ...splitRuleRow,
          recipients: [{ accountId: 'acct_123', label: 'Merchant', percentage: 85 }],
        }],
      })

      const result = await listSplitRules(mockClient, ctx)

      expect(result[0].recipients).toHaveLength(1)
    })
  })

  describe('deactivateSplitRule', () => {
    it('deactivates existing rule without throwing', async () => {
      mockClient.query.mockResolvedValue({ rowCount: 1 })

      await expect(deactivateSplitRule(mockClient, ctx, 'rule-uuid-1')).resolves.toBeUndefined()
    })

    it('throws NotFoundError when rule not found', async () => {
      mockClient.query.mockResolvedValue({ rowCount: 0 })

      await expect(deactivateSplitRule(mockClient, ctx, 'missing')).rejects.toThrow(NotFoundError)
    })
  })
})
