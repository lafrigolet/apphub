import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/lib/db.js', () => ({
  pool: { connect: vi.fn() },
  withTenant: vi.fn(),
}))

vi.mock('../../src/lib/stripe.js', () => ({
  stripe: {
    paymentIntents: { create: vi.fn() },
    transfers: {
      create: vi.fn(),
      list: vi.fn(),
      createReversal: vi.fn(),
    },
    refunds: { create: vi.fn() },
  },
}))

vi.mock('../../src/lib/redis.js', () => ({
  checkIdempotency: vi.fn(),
  storeIdempotency: vi.fn(),
}))

vi.mock('../../src/repositories/payment.repository.js', () => ({
  insertPayment: vi.fn(),
  findPaymentById: vi.fn(),
  findPaymentByStripeId: vi.fn(),
  updatePaymentStatus: vi.fn(),
  listPayments: vi.fn(),
}))

vi.mock('../../src/repositories/split-rule.repository.js', () => ({
  findSplitRuleById: vi.fn(),
}))

import {
  createPaymentIntent,
  createAdditionalTransfers,
  getPayment,
  listPayments,
  createRefund,
} from '../../src/services/payment.service.js'
import * as db from '../../src/lib/db.js'
import { stripe } from '../../src/lib/stripe.js'
import * as redis from '../../src/lib/redis.js'
import * as paymentRepo from '../../src/repositories/payment.repository.js'
import * as splitRuleRepo from '../../src/repositories/split-rule.repository.js'
import { StripeError } from '../../src/utils/errors.js'

const ctx = { tenantId: 'tenant-abc', subTenantId: null }

const mockSplitRule = {
  id: 'rule-uuid-1',
  tenantId: 'tenant-abc',
  platformFeePercent: 15,
  recipients: [{ accountId: 'acct_merchant', label: 'Merchant', percentage: 85 }],
}

const mockPayment = {
  id: 'pay-uuid-1',
  tenantId: 'tenant-abc',
  stripePaymentIntentId: 'pi_test_123',
  amount: 10000,
  currency: 'eur',
  status: 'requires_payment_method',
  splitRuleId: 'rule-uuid-1',
  merchantAccountId: 'acct_merchant',
  platformFee: 1500,
  metadata: {},
}

let mockClient

beforeEach(() => {
  vi.clearAllMocks()
  mockClient = { query: vi.fn(), release: vi.fn() }
  vi.mocked(db.pool.connect).mockResolvedValue(mockClient)
  vi.mocked(redis.checkIdempotency).mockResolvedValue(null)
  vi.mocked(redis.storeIdempotency).mockResolvedValue(undefined)
})

// ── createPaymentIntent ───────────────────────────────────────────────────────

describe('createPaymentIntent', () => {
  it('returns cached result when idempotency key already exists', async () => {
    const cached = { clientSecret: 'cached_secret', paymentId: 'cached-id' }
    vi.mocked(redis.checkIdempotency).mockResolvedValue(JSON.stringify(cached))

    const result = await createPaymentIntent(ctx, {
      amount: 10000,
      currency: 'eur',
      splitRuleId: 'rule-uuid-1',
      merchantAccountId: 'acct_merchant',
      idempotencyKey: 'existing-key',
    })

    expect(result).toEqual(cached)
    expect(db.pool.connect).not.toHaveBeenCalled()
  })

  it('creates payment intent and persists payment record', async () => {
    vi.mocked(splitRuleRepo.findSplitRuleById).mockResolvedValue(mockSplitRule)
    vi.mocked(stripe.paymentIntents.create).mockResolvedValue({
      id: 'pi_test_123',
      client_secret: 'pi_test_secret',
      status: 'requires_payment_method',
    })
    vi.mocked(paymentRepo.insertPayment).mockResolvedValue(mockPayment)

    const result = await createPaymentIntent(ctx, {
      amount: 10000,
      currency: 'eur',
      splitRuleId: 'rule-uuid-1',
      merchantAccountId: 'acct_merchant',
      idempotencyKey: 'key-001',
    })

    expect(result.clientSecret).toBe('pi_test_secret')
    expect(result.paymentId).toBe('pay-uuid-1')
    expect(redis.storeIdempotency).toHaveBeenCalledWith('key-001', result)
    expect(mockClient.release).toHaveBeenCalled()
  })

  it('logs info and returns for multi-recipient split', async () => {
    const multiRule = {
      ...mockSplitRule,
      recipients: [
        { accountId: 'acct_primary', label: 'Primary', percentage: 60 },
        { accountId: 'acct_secondary', label: 'Secondary', percentage: 25 },
      ],
    }
    vi.mocked(splitRuleRepo.findSplitRuleById).mockResolvedValue(multiRule)
    vi.mocked(stripe.paymentIntents.create).mockResolvedValue({
      id: 'pi_multi_123',
      client_secret: 'pi_multi_secret',
      status: 'requires_payment_method',
    })
    vi.mocked(paymentRepo.insertPayment).mockResolvedValue({ ...mockPayment, id: 'pay-multi-1' })

    const result = await createPaymentIntent(ctx, {
      amount: 10000,
      currency: 'eur',
      splitRuleId: 'rule-uuid-1',
      merchantAccountId: 'acct_primary',
      idempotencyKey: 'key-multi',
    })

    expect(result.paymentId).toBe('pay-multi-1')
  })

  it('throws StripeError when split rule has no recipients', async () => {
    vi.mocked(splitRuleRepo.findSplitRuleById).mockResolvedValue({ ...mockSplitRule, recipients: [] })

    await expect(createPaymentIntent(ctx, {
      amount: 10000,
      currency: 'eur',
      splitRuleId: 'rule-uuid-1',
      merchantAccountId: 'acct_merchant',
      idempotencyKey: 'key-002',
    })).rejects.toThrow(StripeError)

    expect(mockClient.release).toHaveBeenCalled()
  })

  it('throws StripeError when Stripe payment intent creation fails', async () => {
    vi.mocked(splitRuleRepo.findSplitRuleById).mockResolvedValue(mockSplitRule)
    vi.mocked(stripe.paymentIntents.create).mockRejectedValue(new Error('Stripe down'))

    await expect(createPaymentIntent(ctx, {
      amount: 10000,
      currency: 'eur',
      splitRuleId: 'rule-uuid-1',
      merchantAccountId: 'acct_merchant',
      idempotencyKey: 'key-003',
    })).rejects.toThrow(StripeError)

    expect(mockClient.release).toHaveBeenCalled()
  })
})

// ── createAdditionalTransfers ─────────────────────────────────────────────────

describe('createAdditionalTransfers', () => {
  it('returns early when payment is not found', async () => {
    vi.mocked(paymentRepo.findPaymentByStripeId).mockResolvedValue(null)

    await createAdditionalTransfers('pi_unknown', 'ch_test')

    expect(stripe.transfers.create).not.toHaveBeenCalled()
    expect(mockClient.release).toHaveBeenCalled()
  })

  it('returns early when split rule is not found', async () => {
    vi.mocked(paymentRepo.findPaymentByStripeId).mockResolvedValue(mockPayment)
    mockClient.query.mockResolvedValue({ rows: [] })

    await createAdditionalTransfers('pi_test_123', 'ch_test')

    expect(stripe.transfers.create).not.toHaveBeenCalled()
  })

  it('returns early when no additional recipients exist', async () => {
    vi.mocked(paymentRepo.findPaymentByStripeId).mockResolvedValue(mockPayment)
    mockClient.query.mockResolvedValue({
      rows: [{
        recipients: JSON.stringify([{ accountId: 'acct_primary', label: 'Primary', percentage: 85 }]),
        platform_fee_percent: '15',
      }],
    })

    await createAdditionalTransfers('pi_test_123', 'ch_test')

    expect(stripe.transfers.create).not.toHaveBeenCalled()
  })

  it('creates transfers for additional recipients', async () => {
    vi.mocked(paymentRepo.findPaymentByStripeId).mockResolvedValue(mockPayment)
    mockClient.query.mockResolvedValue({
      rows: [{
        recipients: JSON.stringify([
          { accountId: 'acct_primary', label: 'Primary', percentage: 60 },
          { accountId: 'acct_secondary', label: 'Secondary', percentage: 25 },
        ]),
        platform_fee_percent: '15',
      }],
    })
    vi.mocked(stripe.transfers.create).mockResolvedValue({ id: 'tr_test_1' })

    await createAdditionalTransfers('pi_test_123', 'ch_test_456')

    expect(stripe.transfers.create).toHaveBeenCalledWith(
      expect.objectContaining({ destination: 'acct_secondary' }),
      expect.any(Object),
    )
    expect(mockClient.release).toHaveBeenCalled()
  })

  it('logs error but continues when a transfer creation fails', async () => {
    vi.mocked(paymentRepo.findPaymentByStripeId).mockResolvedValue(mockPayment)
    mockClient.query.mockResolvedValue({
      rows: [{
        recipients: JSON.stringify([
          { accountId: 'acct_primary', label: 'Primary', percentage: 60 },
          { accountId: 'acct_secondary', label: 'Secondary', percentage: 25 },
        ]),
        platform_fee_percent: '15',
      }],
    })
    vi.mocked(stripe.transfers.create).mockRejectedValue(new Error('Transfer failed'))

    await expect(createAdditionalTransfers('pi_test_123', 'ch_test_456')).resolves.toBeUndefined()
    expect(mockClient.release).toHaveBeenCalled()
  })
})

// ── getPayment ────────────────────────────────────────────────────────────────

describe('getPayment', () => {
  it('returns payment from repository', async () => {
    vi.mocked(paymentRepo.findPaymentById).mockResolvedValue(mockPayment)

    const result = await getPayment(ctx, 'pay-uuid-1')

    expect(result).toEqual(mockPayment)
    expect(mockClient.release).toHaveBeenCalled()
  })
})

// ── listPayments ──────────────────────────────────────────────────────────────

describe('listPayments', () => {
  it('returns data with hasMore=false when items are within the limit', async () => {
    vi.mocked(paymentRepo.listPayments).mockResolvedValue([mockPayment])

    const result = await listPayments(ctx, 20)

    expect(result.data).toHaveLength(1)
    expect(result.hasMore).toBe(false)
    expect(result.cursor).toBeNull()
    expect(mockClient.release).toHaveBeenCalled()
  })

  it('returns hasMore=true and cursor when items exceed the limit', async () => {
    const payments = Array.from({ length: 21 }, (_, i) => ({ ...mockPayment, id: `pay-${i}` }))
    vi.mocked(paymentRepo.listPayments).mockResolvedValue(payments)

    const result = await listPayments(ctx, 20)

    expect(result.data).toHaveLength(20)
    expect(result.hasMore).toBe(true)
    expect(result.cursor).toBe('pay-19')
  })
})

// ── createRefund ──────────────────────────────────────────────────────────────

describe('createRefund', () => {
  it('returns cached result when idempotency key already exists', async () => {
    const cached = { refundId: 'ref_cached' }
    vi.mocked(redis.checkIdempotency).mockResolvedValue(JSON.stringify(cached))

    const result = await createRefund(ctx, { paymentId: 'pay-uuid-1', idempotencyKey: 'ref-existing' })

    expect(result).toEqual(cached)
    expect(db.pool.connect).not.toHaveBeenCalled()
  })

  it('creates refund when there are no transfers to reverse', async () => {
    vi.mocked(paymentRepo.findPaymentById).mockResolvedValue(mockPayment)
    vi.mocked(stripe.transfers.list).mockResolvedValue({ data: [] })
    vi.mocked(stripe.refunds.create).mockResolvedValue({ id: 'ref_test_1' })

    const result = await createRefund(ctx, { paymentId: 'pay-uuid-1', idempotencyKey: 'ref-001' })

    expect(result.refundId).toBe('ref_test_1')
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled()
    expect(mockClient.release).toHaveBeenCalled()
  })

  it('creates refund and proportionally reverses each transfer', async () => {
    vi.mocked(paymentRepo.findPaymentById).mockResolvedValue(mockPayment)
    vi.mocked(stripe.transfers.list).mockResolvedValue({
      data: [{ id: 'tr_test_1', amount: 8500 }],
    })
    vi.mocked(stripe.refunds.create).mockResolvedValue({ id: 'ref_test_2' })
    vi.mocked(stripe.transfers.createReversal).mockResolvedValue({ id: 'trrev_test_1' })

    const result = await createRefund(ctx, {
      paymentId: 'pay-uuid-1',
      amount: 5000,
      idempotencyKey: 'ref-002',
    })

    expect(result.refundId).toBe('ref_test_2')
    expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
      'tr_test_1',
      expect.any(Object),
      expect.any(Object),
    )
  })

  it('throws StripeError when Stripe refund creation fails', async () => {
    vi.mocked(paymentRepo.findPaymentById).mockResolvedValue(mockPayment)
    vi.mocked(stripe.transfers.list).mockResolvedValue({ data: [] })
    vi.mocked(stripe.refunds.create).mockRejectedValue(new Error('Refund failed'))

    await expect(createRefund(ctx, {
      paymentId: 'pay-uuid-1',
      idempotencyKey: 'ref-003',
    })).rejects.toThrow(StripeError)

    expect(mockClient.release).toHaveBeenCalled()
  })

  it('logs error but returns successfully when transfer reversal fails', async () => {
    vi.mocked(paymentRepo.findPaymentById).mockResolvedValue(mockPayment)
    vi.mocked(stripe.transfers.list).mockResolvedValue({
      data: [{ id: 'tr_fail_1', amount: 8500 }],
    })
    vi.mocked(stripe.refunds.create).mockResolvedValue({ id: 'ref_test_3' })
    vi.mocked(stripe.transfers.createReversal).mockRejectedValue(new Error('Reversal failed'))

    const result = await createRefund(ctx, {
      paymentId: 'pay-uuid-1',
      amount: 5000,
      idempotencyKey: 'ref-004',
    })

    expect(result.refundId).toBe('ref_test_3')
  })
})
